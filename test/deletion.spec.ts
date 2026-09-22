import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { StreamEvent } from '$lib/shared/types';

/**
 * Deleting a chat that is still answering. The turn must stop with the rows it
 * writes into, so a late write cannot reach a chat that no longer exists.
 *
 * The provider is mocked, so the test holds a stream open while it deletes. The
 * store reads the database path when the module loads, so the data directory is
 * set before the first server import.
 */

process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-deletion-'));

interface Reply {
	content: string;
	toolCalls?: { id: string; name: string; argsText: string }[];
}

let replies: Reply[] = [];
let calls = 0;
let pauseNext = false;
let releaseStream: (() => void) | undefined;

vi.mock('$lib/server/tokens', () => ({
	tokenSupport: vi.fn(async () => ({
		counter: 'vllm',
		tokenIds: true,
		perToken: false,
		continueFinal: true
	})),
	countPrompt: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/openai', () => ({
	streamChat: vi.fn(async () => {
		if (pauseNext) {
			pauseNext = false;
			await new Promise<void>((resolve) => {
				releaseStream = resolve;
			});
		}
		const reply = replies[calls] ?? { content: 'ANSWER' };
		calls++;
		return {
			content: reply.content,
			reasoning: '',
			toolCalls: reply.toolCalls ?? [],
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
			finishReason: reply.toolCalls?.length ? 'tool_calls' : 'stop'
		};
	}),
	toUpstreamMessages: vi.fn(() => [{ role: 'user', content: 'hello' }])
}));

const store = await import('$lib/server/store');
const hub = await import('$lib/server/hub');
const { DELETE } = await import('../src/routes/api/conversations/[id]/+server');

/** Any rejected promise the turn leaves behind. */
let rejections: unknown[];
const onRejection = (reason: unknown): void => {
	rejections.push(reason);
};
/** What the hub logged for a turn that failed outside its own body. */
let logged: unknown[];
let errorSpy: ReturnType<typeof vi.spyOn>;

/** Waits until the turn of a conversation is idle. */
async function settle(conversationId: string): Promise<void> {
	for (let step = 0; step < 300 && hub.isTurnRunning(conversationId); step++) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	await new Promise((resolve) => setTimeout(resolve, 60));
}

/** Waits until the mocked provider holds an open stream. */
async function waitForStream(): Promise<void> {
	for (let step = 0; step < 200 && !releaseStream; step++) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(releaseStream, 'the provider holds the stream').toBeTruthy();
}

function chat(text: string): string {
	const provider = store.createProvider({ name: 'Mock', baseUrl: 'http://127.0.0.1:1/v1' });
	const conversation = store.createConversation({ providerId: provider.id, model: 'mock-model' });
	store.appendMessage({ conversationId: conversation.id, role: 'user', text });
	return conversation.id;
}

/** Calls the delete route the way the browser does. */
async function deleteRoute(conversationId: string): Promise<void> {
	const response = await (DELETE as (event: RequestEvent) => Promise<Response>)(
		{ params: { id: conversationId } } as RequestEvent
	);
	expect(response.status).toBe(200);
}

beforeEach(() => {
	replies = [];
	calls = 0;
	pauseNext = false;
	releaseStream = undefined;
	rejections = [];
	logged = [];
	process.on('unhandledRejection', onRejection);
	errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		if (typeof args[0] === 'string' && args[0].startsWith('[turn]')) logged.push(args);
	});
	const settings = store.getSettings();
	store.saveSettings({ tools: { ...settings.tools, modes: { read_skill: 'on' }, maxRounds: 6 } });
});

afterEach(() => {
	process.off('unhandledRejection', onRejection);
	errorSpy.mockRestore();
	// A logged turn failure means a write hit a chat that was already gone.
	expect(logged, 'the hub logged no turn failure').toEqual([]);
	for (const conversation of store.listConversations()) store.deleteConversation(conversation.id);
});

describe('deleting a chat while it answers', () => {
	it('stops the turn the delete route finds running', async () => {
		pauseNext = true;
		const conversationId = chat('tell me');
		const events: StreamEvent[] = [];

		expect(hub.startTurn({ conversationId })).toBe(true);
		const subscription = hub.subscribe(conversationId, { send: (event) => events.push(event), close() {} });
		expect(subscription, 'a client can watch the turn').toBeTruthy();
		await waitForStream();

		await deleteRoute(conversationId);

		releaseStream?.();
		await settle(conversationId);

		expect(events, 'the watch sees the turn stop').toContainEqual({
			type: 'done',
			finishReason: 'aborted',
			messageId: expect.any(String)
		});
		expect(hub.isTurnRunning(conversationId)).toBe(false);
		expect(store.getConversation(conversationId)).toBeUndefined();
		expect(store.listMessages(conversationId)).toEqual([]);
		expect(rejections, 'the stopped turn leaves no rejection').toEqual([]);
	});

	it('stops a tool round the delete catches, so no row is written after it', async () => {
		pauseNext = true;
		replies = [{ content: '', toolCalls: [{ id: 'call_1', name: 'read_skill', argsText: '{}' }] }];
		const conversationId = chat('read the skill');

		hub.startTurn({ conversationId });
		await waitForStream();

		await deleteRoute(conversationId);
		releaseStream?.();
		await settle(conversationId);

		expect(calls, 'the turn asks the provider once').toBe(1);
		expect(store.getConversation(conversationId)).toBeUndefined();
		expect(rejections).toEqual([]);
	});

	it('does not drain the waiting message into a deleted chat', async () => {
		pauseNext = true;
		const conversationId = chat('tell me');

		hub.startTurn({ conversationId });
		await waitForStream();
		store.queueMessage({ conversationId, text: 'and then?' });

		await deleteRoute(conversationId);
		releaseStream?.();
		await new Promise((resolve) => setTimeout(resolve, 120));

		expect(hub.isTurnRunning(conversationId)).toBe(false);
		expect(store.listQueued(conversationId)).toEqual([]);
		expect(rejections).toEqual([]);
	});
});
