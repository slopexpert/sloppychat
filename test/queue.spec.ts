import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, QueuedMessage } from '$lib/shared/types';

/**
 * The queue lives on the server, and the server also decides where a new
 * message goes: straight into the history when the chat is idle, into the queue
 * while a turn owns it. The api module is mocked with that rule, so the test
 * drives the state machine directly and each turn stays open until released.
 */

const calls = {
	queued: [] as string[],
	removed: [] as string[],
	streams: [] as string[],
	added: [] as string[]
};

/** The queue the mocked conversation payload reports. */
let queued: QueuedMessage[] = [];
let releaseStream: (() => void) | undefined;
/** True while a mocked turn stream is open, which is what makes a message wait. */
let turnOpen = false;

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
			deleteQueued: vi.fn(async (_id: string, id: string) => {
				calls.removed.push(id);
				queued = queued.filter((item) => item.id !== id);
				return { ok: true as const };
			}),
			// What the messages route does: a running turn holds the message.
			addMessage: vi.fn(async (_id: string, input: { text: string }) => {
				if (turnOpen) {
					calls.queued.push(input.text);
					const item: QueuedMessage = {
						id: `q${calls.queued.length}`,
						text: input.text,
						images: [],
						documents: []
					};
					queued = [...queued, item];
					return { queued: item };
				}
				calls.added.push(input.text);
				return { message: { id: `m${calls.added.length}`, conversationId: 'c1', role: 'user', text: input.text, images: [], createdAt: new Date(0).toISOString() } };
			}),
			getConversation: vi.fn(async () => ({ conversation: conversation(), messages: [], queued })),
			listConversations: vi.fn(async () => ({ conversations: [conversation()] })),
			stopTurn: vi.fn(async () => ({ stopped: true })),
			getSettings: vi.fn(),
			listProviders: vi.fn()
		},
		postStream: vi.fn(
			async (url: string, _body: unknown, _signal: AbortSignal, onEvent: (event: never) => void) => {
				calls.streams.push(url);
				const id = `a${calls.streams.length}`;
				turnOpen = true;
				onEvent({ type: 'start', messageId: id } as never);
				onEvent({ type: 'text', text: 'partial' } as never);
				// The turn stays open until the test releases it, so a follow up can
				// arrive while it still runs.
				await new Promise<void>((resolve) => {
					releaseStream = resolve;
				});
				turnOpen = false;
				onEvent({ type: 'done', finishReason: 'stop', messageId: id } as never);
			}
		),
		getStream: vi.fn(async () => undefined),
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
	await tick();
}

beforeEach(() => {
	calls.queued = [];
	calls.removed = [];
	calls.streams = [];
	calls.added = [];
	queued = [];
	turnOpen = false;
	releaseStream = undefined;
	stopTurn.mockClear();
});

describe('the follow up queue on the server', () => {
	it('posts a follow up to the queue while the answer streams', async () => {
		const state = freshState();
		const first = state.send('first question');
		await waitForStreams(1);

		await state.send('follow up');

		expect(calls.queued).toEqual(['follow up']);
		expect(calls.added, 'a waiting message does not join the history yet').toEqual(['first question']);
		expect(state.queued.map((item) => item.text)).toEqual(['follow up']);
		await waitForStreams(1);
		expect(calls.streams, 'the follow up started no second turn').toHaveLength(1);

		releaseStream?.();
		await first;
	});

	it('draws the queue from the conversation payload', async () => {
		const state = freshState();
		queued = [{ id: 'q1', text: 'from the server', images: [], documents: [] }];

		await state.refreshMessages();

		expect(state.queued.map((item) => item.text)).toEqual(['from the server']);
	});

	it('removes one waiting message through the route', async () => {
		const state = freshState();
		queued = [
			{ id: 'q1', text: 'first', images: [], documents: [] },
			{ id: 'q2', text: 'second', images: [], documents: [] }
		];
		await state.refreshMessages();

		await state.removeQueued('q1');

		expect(calls.removed).toEqual(['q1']);
		expect(state.queued.map((item) => item.text)).toEqual(['second']);
	});

	it('empties the list when the user stops the turn', async () => {
		const state = freshState();
		queued = [{ id: 'q1', text: 'dropped', images: [], documents: [] }];
		await state.refreshMessages();
		expect(state.queued).toHaveLength(1);

		state.stop();
		await tick();

		expect(stopTurn).toHaveBeenCalledWith('c1');
		expect(state.queued).toEqual([]);
	});

	it('shows the waiting messages again when no turn was running', async () => {
		const state = freshState();
		queued = [{ id: 'q1', text: 'waits for a turn', images: [], documents: [] }];
		await state.refreshMessages();
		stopTurn.mockResolvedValueOnce({ stopped: false });

		state.stop();
		await tick();

		expect(state.queued.map((item) => item.text)).toEqual(['waits for a turn']);
	});
});
