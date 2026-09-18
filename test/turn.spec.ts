import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The turn loop belongs to the server: the model asks for a tool, the server
 * runs the tool, and the answer arrives with no page attached. The provider is
 * mocked, so the test drives the loop itself.
 *
 * The store reads the database path when the module loads, so the data
 * directory must be set before the first server import.
 */

process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-turn-'));

interface Reply {
	content: string;
	toolCalls?: { id: string; name: string; argsText: string }[];
}

/** The answers of the provider, in order, and the number of calls. */
let replies: Reply[] = [];
let calls = 0;

vi.mock('$lib/server/openai', () => ({
	streamChat: vi.fn(async () => {
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

/** Waits until the turn of a conversation is idle. */
async function settle(conversationId: string): Promise<void> {
	for (let step = 0; step < 300 && hub.isTurnRunning(conversationId); step++) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	// One more turn of the event loop, so a continuation that the end of this
	// turn started becomes visible to the test.
	await new Promise((resolve) => setTimeout(resolve, 50));
}

function startConversation(): string {
	const provider = store.createProvider({ name: 'Mock', baseUrl: 'http://127.0.0.1:1/v1' });
	const conversation = store.createConversation({ providerId: provider.id, model: 'mock-model' });
	store.appendMessage({ conversationId: conversation.id, role: 'user', text: 'search please' });
	return conversation.id;
}

beforeEach(() => {
	replies = [];
	calls = 0;
});

describe('a turn that needs a tool', () => {
	/**
	 * Expected to fail before step 3 of specs/plan.md: the browser runs the tool,
	 * so the turn stops after the call. Remove `.fails` with the repair.
	 */
	it.fails('runs the tool on the server and answers in the same turn', async () => {
		replies = [
			{ content: '', toolCalls: [{ id: 'call_1', name: 'web_search', argsText: '{"query":"mock"}' }] },
			{ content: 'ANSWER' }
		];
		const conversationId = startConversation();

		hub.startTurn({ conversationId });
		await settle(conversationId);

		expect(store.listMessages(conversationId).map((message) => message.role)).toEqual([
			'user',
			'assistant',
			'tool',
			'assistant'
		]);
		expect(store.listMessages(conversationId).at(-1)?.text).toBe('ANSWER');
	});

	it('stops after the call while the browser runs the tools', async () => {
		replies = [
			{ content: '', toolCalls: [{ id: 'call_1', name: 'web_search', argsText: '{"query":"mock"}' }] },
			{ content: 'ANSWER' }
		];
		const conversationId = startConversation();

		hub.startTurn({ conversationId });
		await settle(conversationId);

		const messages = store.listMessages(conversationId);
		expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
		expect(messages.at(-1)?.toolCalls?.[0]?.id).toBe('call_1');
		expect(calls, 'the provider is asked one time only').toBe(1);
	});
});
