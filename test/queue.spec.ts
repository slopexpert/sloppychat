import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Message, StreamEvent } from '$lib/shared/types';

/**
 * Follow up messages typed while a turn streams must be queued and then sent in
 * order. The api module is mocked so the test drives the state machine directly:
 * each streamed turn stays open until the test releases it.
 */

const calls = {
	added: [] as string[],
	streams: [] as string[]
};

let releaseStream: (() => void) | undefined;
let failNextStream = false;

vi.mock('$lib/client/api', () => {
	class ApiError extends Error {
		constructor(
			message: string,
			readonly status: number
		) {
			super(message);
		}
	}
	return {
		ApiError,
		api: {
			addMessage: vi.fn(async (_id: string, input: { text: string }) => {
				calls.added.push(input.text);
				const message: Message = {
					id: `m${calls.added.length}`,
					conversationId: 'c1',
					role: 'user',
					text: input.text,
					images: [],
					createdAt: new Date(0).toISOString()
				};
				return { message };
			}),
			getConversation: vi.fn(async () => ({ conversation: conversation(), messages: [] })),
			listConversations: vi.fn(async () => ({ conversations: [conversation()] })),
			stopTurn: vi.fn(async () => ({ stopped: true })),
			getSettings: vi.fn(),
			listProviders: vi.fn()
		},
		postStream: vi.fn(
			async (url: string, _body: unknown, _signal: AbortSignal, onEvent: (e: StreamEvent) => void) => {
				calls.streams.push(url);
				const id = `a${calls.streams.length}`;
				onEvent({ type: 'start', messageId: id });
				onEvent({ type: 'text', text: 'partial' });
				// Every turn stays open until the test releases it, so failures can be
				// triggered while a follow up is already queued.
				await new Promise<void>((resolve, reject) => {
					releaseStream = () => {
						if (failNextStream) {
							failNextStream = false;
							reject(new Error('provider exploded'));
							return;
						}
						resolve();
					};
				});
				onEvent({ type: 'done', finishReason: 'stop', messageId: id });
			}
		),
		readEventStream: vi.fn()
	};
});

function conversation(): Conversation {
	return {
		id: 'c1',
		title: 'Test chat',
		providerId: 'p1',
		model: 'mock-model',
		system: null,
		params: {},
		createdAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString()
	};
}

const { AppState } = await import('$lib/client/state.svelte');
const { api } = await import('$lib/client/api');
const stopTurn = api.stopTurn as unknown as ReturnType<typeof vi.fn>;

function freshState() {
	const state = new AppState();
	state.ready = true;
	state.conversation = conversation();
	state.providers = [
		{
			id: 'p1',
			name: 'Mock',
			baseUrl: 'http://127.0.0.1:1/v1',
			kind: 'openai',
			defaultModel: 'mock-model',
			enabled: true,
			sort: 0,
			createdAt: new Date(0).toISOString(),
			hasKey: false
		}
	];
	return state;
}

async function tick(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Waits until the given number of turns have reached the provider. */
async function waitForStreams(count: number): Promise<void> {
	for (let i = 0; i < 100 && calls.streams.length < count; i++) await tick();
	expect(calls.streams.length, 'streams started').toBeGreaterThanOrEqual(count);
	// One more turn of the loop so the state settles after the stream starts.
	await tick();
}

/** Lets the open turn finish and waits for the follow up work it triggers. */
async function release(): Promise<void> {
	const resolve = releaseStream;
	releaseStream = undefined;
	resolve?.();
	for (let i = 0; i < 5; i++) await tick();
}

beforeEach(() => {
	stopTurn.mockClear();
	calls.added = [];
	calls.streams = [];
	releaseStream = undefined;
	failNextStream = false;
});

describe('follow up queue', () => {
	it('sends a message straight away when nothing is running', async () => {
		const state = freshState();
		const sending = state.send('first');
		await waitForStreams(1);
		expect(calls.added).toEqual(['first']);
		expect(state.queued).toHaveLength(0);
		await release();
		await sending;
		expect(state.running).toBe(false);
	});

	it('queues a message typed while the answer streams', async () => {
		const state = freshState();
		const sending = state.send('first');
		await waitForStreams(1);
		await state.send('second');
		expect(calls.added).toEqual(['first']);
		expect(state.queued.map((item) => item.text)).toEqual(['second']);
		await release();
		await sending;
	});

	it('sends the queued message once the running turn finishes', async () => {
		const state = freshState();
		const sending = state.send('first');
		await waitForStreams(1);
		await state.send('second');
		await release();
		await sending;
		await waitForStreams(2);
		expect(calls.added).toEqual(['first', 'second']);
		expect(state.queued).toHaveLength(0);
		expect(state.running).toBe(true);
		await release();
		expect(state.running).toBe(false);
	});

	it('keeps several follow ups in order', async () => {
		const state = freshState();
		const sending = state.send('first');
		await waitForStreams(1);
		await state.send('second');
		await state.send('third');
		expect(state.queued.map((item) => item.text)).toEqual(['second', 'third']);
		await release();
		await sending;
		await waitForStreams(2);
		expect(calls.added).toEqual(['first', 'second']);
		expect(state.queued.map((item) => item.text)).toEqual(['third']);
		await release();
		await waitForStreams(3);
		expect(calls.added).toEqual(['first', 'second', 'third']);
		await release();
		expect(state.running).toBe(false);
	});

	it('lets a queued item be removed before it is sent', async () => {
		const state = freshState();
		const sending = state.send('first');
		await waitForStreams(1);
		await state.send('second');
		state.removeQueued(state.queued[0].id);
		expect(state.queued).toHaveLength(0);
		await release();
		await sending;
		expect(calls.added).toEqual(['first']);
		expect(calls.streams).toHaveLength(1);
	});

	it('drops the queue when the user stops, and stops the turn on the server', async () => {
		const state = freshState();
		const sending = state.send('first');
		await waitForStreams(1);
		await state.send('second');
		state.stop();
		expect(stopTurn).toHaveBeenCalledWith('c1');
		expect(state.queued).toHaveLength(0);
		await release();
		await sending;
		expect(calls.added).toEqual(['first']);
		expect(calls.streams).toHaveLength(1);
	});

	it('refuses to send without a provider', async () => {
		const state = freshState();
		state.providers = [];
		await state.send('nope');
		expect(calls.added).toEqual([]);
		expect(state.queued).toHaveLength(0);
		expect(calls.streams).toHaveLength(0);
	});

	it('keeps the queue moving after a turn fails', async () => {
		const state = freshState();
		const sending = state.send('first');
		await waitForStreams(1);
		await state.send('second');
		expect(state.queued.map((item) => item.text)).toEqual(['second']);
		// The running turn fails, the queued follow up must still be sent.
		failNextStream = true;
		await release();
		await sending;
		await waitForStreams(2);
		expect(calls.added).toEqual(['first', 'second']);
		expect(state.queued).toHaveLength(0);
		await release();
		expect(state.running).toBe(false);
	});
});
