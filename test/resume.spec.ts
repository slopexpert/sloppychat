import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Message, StreamEvent } from '$lib/shared/types';

/**
 * After a reload, a closed tab or on a second device, the page has to pick up a
 * turn that is already running and finish anything the conversation still needs.
 */

const calls = {
	streams: [] as { url: string; body?: unknown; method: 'GET' | 'POST' }[]
};

/** Events the mocked attach stream replays, and what the POST streams do. */
let attachScript: StreamEvent[] = [];
let postScript: StreamEvent[] = [];
/** Lets a test look at the store between two events. */
let afterEvent: (() => void) | undefined;

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
			stopTurn: vi.fn(),
			addMessage: vi.fn(),
			search: vi.fn(),
			fetchPage: vi.fn()
		},
		getStream: vi.fn(
			async (url: string, signal: AbortSignal, onEvent: (event: StreamEvent) => void) => {
				calls.streams.push({ url, method: 'GET' });
				for (const event of attachScript) {
					onEvent(event);
					afterEvent?.();
				}
				// A turn that is still running holds the attach stream open, so a test can
				// see the state the way a live page sees it mid turn.
				if (!attachScript.some((event) => event.type === 'done' || event.type === 'idle')) {
					await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
				}
			}
		),
		postStream: vi.fn(
			async (url: string, body: unknown, _signal: AbortSignal, onEvent: (event: StreamEvent) => void) => {
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
					afterEvent?.();
				}
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

function freshState(withMessages: Message[]) {
	state.messages = withMessages;
	const app = new AppState();
	app.ready = true;
	app.conversation = conversation();
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

beforeEach(() => {
	calls.streams = [];
	attachScript = [];
	postScript = [];
	state.messages = [];
});

describe('resuming after a reload', () => {
	it('attaches to a running turn and shows what has arrived so far', async () => {
		attachScript = [
			{ type: 'snapshot', messageId: 'a1', text: 'half an answer', reasoning: 'thinking', toolCalls: [], running: true },
			{ type: 'text', text: ' and the rest' },
			{ type: 'done', finishReason: 'stop', messageId: 'a1' }
		];
		// The database as the server would have it once the turn finished.
		const app = freshState([
			message({ role: 'user', text: 'hi' }),
			message({ role: 'assistant', id: 'a1', text: 'half an answer and the rest' })
		]);
		const live: string[] = [];
		afterEvent = () => live.push(app.messages.at(-1)?.text ?? '');
		await app.resume();
		afterEvent = undefined;

		expect(calls.streams).toHaveLength(1);
		expect(calls.streams[0].method).toBe('GET');
		expect(calls.streams[0].url).toContain('/api/chat/stream');
		// The snapshot first, then the delta appended to it, event by event.
		expect(live[0]).toBe('half an answer');
		expect(live[1]).toBe('half an answer and the rest');
		expect(app.turnRunning).toBe(false);
		expect(app.running).toBe(false);
	});

	it('does not start a second turn when one just finished', async () => {
		attachScript = [
			{ type: 'snapshot', messageId: 'a1', text: 'done already', reasoning: '', toolCalls: [], running: false },
			{ type: 'idle' }
		];
		const app = freshState([
			message({ role: 'user', text: 'hi' }),
			message({ role: 'assistant', text: 'done already' })
		]);
		await app.resume();
		expect(calls.streams.map((call) => call.method)).toEqual(['GET']);
	});

	it('starts the turn again when a tool call was never answered', async () => {
		// The tools run on the server now, so a call without an answer means the
		// turn died. The server closes the call and carries on.
		attachScript = [
			{ type: 'snapshot', messageId: null, text: '', reasoning: '', toolCalls: [], running: false },
			{ type: 'idle' }
		];
		postScript = [{ type: 'start', messageId: 'a2' }, { type: 'done', finishReason: 'stop', messageId: 'a2' }];
		const app = freshState([
			message({ role: 'user', text: 'use a tool' }),
			message({
				role: 'assistant',
				id: 'a1',
				text: '',
				toolCalls: [{ id: 'call_1', name: 'not-a-real-tool', args: {} }]
			})
		]);
		await app.resume();

		const posted = calls.streams.find((call) => call.method === 'POST');
		expect(posted?.url).toBe('/api/chat');
	});

	it('asks for the answer after a tool result, and never runs the tool again', async () => {
		attachScript = [
			{ type: 'snapshot', messageId: null, text: '', reasoning: '', toolCalls: [], running: false },
			{ type: 'idle' }
		];
		postScript = [{ type: 'start', messageId: 'a2' }, { type: 'done', finishReason: 'stop', messageId: 'a2' }];
		const app = freshState([
			message({ role: 'user', text: 'use a tool' }),
			message({
				role: 'assistant',
				id: 'a1',
				text: '',
				toolCalls: [{ id: 'call_1', name: 'not-a-real-tool', args: {} }]
			}),
			message({ role: 'tool', toolCallId: 'call_1', toolName: 'not-a-real-tool', text: 'Error' })
		]);
		await app.resume();

		const urls = calls.streams.map((call) => call.url);
		// The tool row is the last message, so the answer for it is still missing.
		expect(urls).toContain('/api/chat');
		expect(urls).not.toContain('/api/chat/tools');
	});

	it('continues a conversation whose answer never happened', async () => {
		attachScript = [
			{ type: 'snapshot', messageId: null, text: '', reasoning: '', toolCalls: [], running: false },
			{ type: 'idle' }
		];
		postScript = [{ type: 'start', messageId: 'a2' }, { type: 'done', finishReason: 'stop', messageId: 'a2' }];
		const app = freshState([message({ role: 'user', text: 'never answered' })]);
		await app.resume();

		const posted = calls.streams.find((call) => call.method === 'POST');
		expect(posted?.url).toBe('/api/chat');
	});

	it('leaves an interrupted answer alone', async () => {
		attachScript = [
			{ type: 'snapshot', messageId: null, text: '', reasoning: '', toolCalls: [], running: false },
			{ type: 'idle' }
		];
		const app = freshState([
			message({ role: 'user', text: 'hi' }),
			message({ role: 'assistant', text: 'cut off', usage: { completion: 3, interrupted: true } })
		]);
		await app.resume();
		expect(calls.streams.filter((call) => call.method === 'POST')).toHaveLength(0);
	});

	it('measures the prefill when this page arrives mid prefill', async () => {
		attachScript = [
			{ type: 'snapshot', messageId: 'a1', text: '', reasoning: '', toolCalls: [], running: true }
		];
		const app = freshState([
			message({ role: 'user', text: 'a long prompt to read' }),
			message({ role: 'assistant', id: 'a1', text: '' })
		]);
		// open() fills the list before it resumes, so the prompt is known here.
		app.messages = state.messages;
		const resuming = app.resume();
		await new Promise((resolve) => setTimeout(resolve, 0));
		// Nothing has arrived, so this is still the prefill phase.
		expect(app.prefilling).toBe(true);
		// The rate needs a moment of data before it means anything.
		await new Promise((resolve) => setTimeout(resolve, 350));
		expect(app.prefillRate).toBeGreaterThan(0);
		app.detach();
		await resuming;
		expect(app.prefilling).toBe(false);
	});

	it('stops measuring the prefill when the turn it watched ends', async () => {
		// The page arrived while the prompt was still reading, then the turn ended.
		attachScript = [
			{ type: 'snapshot', messageId: 'a1', text: '', reasoning: '', toolCalls: [], running: true },
			{ type: 'done', finishReason: 'stop', messageId: 'a1' }
		];
		const app = freshState([message({ role: 'user', text: 'a long prompt to read' })]);
		await app.resume();

		expect(app.prefilling, 'watching ended, so the ticking ends with it').toBe(false);
		expect(app.prefillRate).toBeUndefined();
	});

	it('adopts the id from a snapshot that precedes any start event', async () => {
		// The row exists already, the start event was sent before this client arrived.
		attachScript = [
			{ type: 'snapshot', messageId: 'a9', text: 'part', reasoning: '', toolCalls: [], running: true },
			{ type: 'text', text: ' done' },
			{ type: 'done', finishReason: 'stop', messageId: 'a9' }
		];
		const app = freshState([
			message({ role: 'user', text: 'hi' }),
			// The database as the server would have it once the turn finished.
			message({ role: 'assistant', id: 'a9', text: 'part done' })
		]);
		const live: (string | undefined)[] = [];
		afterEvent = () => live.push(app.messages.find((entry) => entry.id === 'a9')?.text);
		await app.resume();
		afterEvent = undefined;
		// The snapshot gave the id, the delta was appended to that same row.
		expect(live[0]).toBe('part');
		expect(live[1]).toBe('part done');
		expect(app.messages.filter((entry) => entry.id === 'a9')).toHaveLength(1);
	});

	it('detaching leaves the turn running on the server', async () => {
		attachScript = [{ type: 'snapshot', messageId: 'a1', text: 'part', reasoning: '', toolCalls: [], running: true }];
		const app = freshState([message({ role: 'user', text: 'hi' })]);
		const resuming = app.resume();
		await Promise.resolve();
		app.detach();
		await resuming;
		// No stop was sent, the server keeps going.
		const { api } = await import('$lib/client/api');
		expect(api.stopTurn).not.toHaveBeenCalled();
	});
});
