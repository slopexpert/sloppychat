import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who decides where a new message goes. The turn runs on the server, so the
 * server also decides whether the message joins the history now or waits for
 * the turn in flight. A page cannot know: the turn may have ended a moment ago,
 * or another window may have started one.
 */

process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-send-'));

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
		return {
			content: 'ANSWER',
			reasoning: '',
			toolCalls: [],
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
			finishReason: 'stop'
		};
	}),
	toUpstreamMessages: vi.fn(() => [{ role: 'user', content: 'hello' }])
}));

const store = await import('$lib/server/store');
const hub = await import('$lib/server/hub');
const messages = await import('../src/routes/api/conversations/[id]/messages/+server');
const queue = await import('../src/routes/api/conversations/[id]/queue/+server');

/** Calls one route handler with a JSON body. */
async function call(
	post: (event: { params: { id: string }; request: Request }) => Promise<Response>,
	id: string,
	payload: Record<string, unknown>
): Promise<Response> {
	return post({
		params: { id },
		request: new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(payload) })
	});
}

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

beforeEach(async () => {
	pauseNext = false;
	releaseStream = undefined;
	for (const conversation of store.listConversations()) store.deleteConversation(conversation.id);
});

describe('a message that arrives during a turn', () => {
	it('waits in the queue instead of joining the history', async () => {
		pauseNext = true;
		const conversationId = chat('first question');
		hub.startTurn({ conversationId });
		await waitForStream();

		const response = await call(messages.POST as never, conversationId, { text: 'follow up' });

		expect(response.status, 'the server says the message waits').toBe(202);
		expect(
			store.listMessages(conversationId).map((message) => message.text),
			'the waiting message is not in the history'
		).toEqual(['first question', '']);
		expect(store.listQueued(conversationId).map((item) => item.text)).toEqual(['follow up']);

		releaseStream?.();
	});

	it('joins the history at once when the chat is idle', async () => {
		const conversationId = chat('first question');

		const response = await call(messages.POST as never, conversationId, { text: 'next' });

		expect(response.status).toBe(201);
		expect(store.listMessages(conversationId).map((message) => message.text)).toEqual([
			'first question',
			'next'
		]);
		expect(store.listQueued(conversationId)).toEqual([]);
	});

	it('is not parked by a queue post when nothing runs', async () => {
		const conversationId = chat('first question');

		const response = await call(queue.POST as never, conversationId, { text: 'nowhere to wait' });

		expect(response.status, 'no turn means nothing to wait for').toBe(409);
		expect(store.listQueued(conversationId)).toEqual([]);
	});
});

describe('stopping a chat that runs no turn', () => {
	it('leaves the waiting messages where they are', () => {
		const conversationId = chat('first question');
		store.queueMessage({ conversationId, text: 'queued before a restart' });

		expect(hub.stopTurn(conversationId), 'there was no turn to stop').toBe(false);
		expect(store.listQueued(conversationId).map((item) => item.text)).toEqual([
			'queued before a restart'
		]);
	});
});
