import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Message, StreamEvent } from '$lib/shared/types';

/**
 * One page watches one turn. A second stream for the same chat would deliver
 * every token twice, and a turn that keeps failing must not be started over
 * forever. The api module is mocked, so the test scripts the stream events and
 * holds one open when it needs a turn that is still in flight.
 */

const calls = {
	streams: [] as { url: string; body?: unknown; method: 'GET' | 'POST' }[]
};

/** Events the mocked streams replay, and the messages the store reads back. */
let attachScript: StreamEvent[] = [];
let postScript: StreamEvent[] = [];
/** Holds a POST stream open, so a second action lands during the turn. */
let holdPost = false;
let releasePost: (() => void) | undefined;
/** The POST count at which the mock stops answering, so a loop cannot spin. */
const POST_LIMIT = 20;

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
			getConversation: vi.fn(async () => ({ conversation: conversation(), messages: state.messages })),
			listConversations: vi.fn(async () => ({ conversations: [conversation()] })),
			updateConversation: vi.fn(async () => ({ conversation: conversation() })),
			setActiveBranch: vi.fn(async () => ({ conversation: conversation(), messages: state.messages })),
			addMessage: vi.fn(async (_id: string, input: { text: string }) => ({
				message: message({ role: 'user', text: input.text })
			})),
			countTokens: vi.fn(async () => ({ prompt: 0 })),
			getSettings: vi.fn(async () => ({})),
			stopTurn: vi.fn(),
			queueMessage: vi.fn(),
			deleteQueued: vi.fn(),
			search: vi.fn(),
			fetchPage: vi.fn()
		},
		getStream: vi.fn(
			async (url: string, _signal: AbortSignal, onEvent: (event: StreamEvent) => void) => {
				calls.streams.push({ url, method: 'GET' });
				for (const event of attachScript) onEvent(event);
			}
		),
		postStream: vi.fn(
			async (url: string, body: unknown, _signal: AbortSignal, onEvent: (event: StreamEvent) => void) => {
				// Yield a macrotask, so a page that restarts without a break cannot
				// starve the test timeout that reports the loop.
				await new Promise((resolve) => setTimeout(resolve, 0));
				const asked = calls.streams.filter((call) => call.method === 'POST').length;
				if (asked >= POST_LIMIT) throw new ApiError('the page asked too often', 429);
				calls.streams.push({ url, body, method: 'POST' });
				for (const event of postScript) {
					onEvent(event);
					// The answer row is in the database once the turn ends, so the page
					// is not owed a restart afterwards.
					if (event.type === 'done') {
						state.messages = [
							...state.messages,
							message({ role: 'assistant', id: event.messageId, text: 'answered' })
						];
					}
				}
				if (holdPost) await new Promise<void>((resolve) => (releasePost = resolve));
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

function message(overrides: Partial<Message> = {}): Message {
	return {
		id: `m${Math.random().toString(36).slice(2, 8)}`,
		conversationId: 'c1',
		role: 'user',
		text: '',
		images: [],
		createdAt: new Date(0).toISOString(),
		...overrides
	};
}

const { AppState } = await import('$lib/client/state.svelte');

/** The store reads its own message list through the mocked api. */
const state: { messages: Message[] } = { messages: [] };

function freshState(withMessages: Message[]): InstanceType<typeof AppState> {
	state.messages = withMessages;
	const app = new AppState();
	app.ready = true;
	app.conversation = conversation();
	app.messages = withMessages;
	app.providers = [
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
	return app;
}

/** The POST streams only. */
function posts(): number {
	return calls.streams.filter((call) => call.method === 'POST').length;
}

/** Waits for something the background restart path does on its own time. */
async function waitFor(ready: () => boolean): Promise<void> {
	for (let step = 0; step < 400 && !ready(); step++) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(ready(), 'the condition holds').toBe(true);
}

const IDLE: StreamEvent[] = [
	{ type: 'snapshot', messageId: null, text: '', reasoning: '', toolCalls: [], running: false },
	{ type: 'idle' }
];

/** A chat whose last answer is complete, so nothing waits for a restart. */
function answered(): Message[] {
	return [message({ role: 'user', text: 'hi' }), message({ role: 'assistant', id: 'a0', text: 'done' })];
}

beforeEach(() => {
	calls.streams = [];
	attachScript = [];
	postScript = [];
	holdPost = false;
	releasePost = undefined;
	state.messages = [];
});

afterEach(() => {
	releasePost?.();
	releasePost = undefined;
});

describe('one stream per page', () => {
	it('refuses a second turn started while this page already streams', async () => {
		holdPost = true;
		const app = freshState(answered());
		postScript = [{ type: 'start', messageId: 'a1' }];

		const held = app.continueAnswer('a0');
		await waitFor(() => posts() === 1);
		expect(app.running, 'the page holds one stream').toBe(true);

		await app.retry();

		expect(posts(), 'the second action attached no stream').toBe(1);
		releasePost?.();
		await held;
	});

	it('tells the user when an action cannot run yet', async () => {
		holdPost = true;
		const app = freshState(answered());
		postScript = [{ type: 'start', messageId: 'a1' }];

		const held = app.continueAnswer('a0');
		await waitFor(() => posts() === 1);
		await app.retry();

		expect(app.toasts.map((toast) => toast.text).join(' ')).toContain('in flight');
		releasePost?.();
		await held;
	});
});

describe('restarting a turn that failed', () => {
	it('stops at once when the server says a restart cannot help', async () => {
		attachScript = IDLE;
		postScript = [{ type: 'error', message: 'Provider Mock is disabled', fatal: true }];
		const app = freshState([message({ role: 'user', text: 'never answered' })]);

		await app.resume();
		await new Promise((resolve) => setTimeout(resolve, 900));

		expect(posts(), 'the page asks once').toBe(1);
	});

	it('tries a few times for a plain failure, then stops', async () => {
		attachScript = IDLE;
		postScript = [{ type: 'error', message: 'connection reset' }];
		const app = freshState([message({ role: 'user', text: 'never answered' })]);

		await app.resume();
		await waitFor(() => app.toasts.some((toast) => toast.text.includes('Stopped retrying')));

		expect(posts(), 'the page stops after a small budget').toBeLessThanOrEqual(3);
		expect(posts()).toBeGreaterThan(1);
	});

	it('starts over when the user sends, so a fixed provider answers', async () => {
		attachScript = IDLE;
		postScript = [{ type: 'error', message: 'Provider Mock is disabled', fatal: true }];
		const app = freshState([message({ role: 'user', text: 'never answered' })]);
		await app.resume();
		expect(posts()).toBe(1);

		// The user fixes the provider and sends, so the refusal must not stick.
		postScript = [
			{ type: 'start', messageId: 'a2' },
			{ type: 'done', finishReason: 'stop', messageId: 'a2' }
		];
		await app.send('again');
		await waitFor(() => posts() >= 2);

		expect(posts(), 'the send started a turn').toBe(2);
	});
});
