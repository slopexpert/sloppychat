import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '$lib/client/state.svelte';
import type { Conversation, Message, ProviderDTO } from '$lib/shared/types';

/**
 * What the composer keeps and what it throws away. A file belongs to the chat it
 * was attached to, so a switch must leave it behind, and a send that the app
 * refuses must not eat what the user typed: the composer clears its box only when
 * the message went.
 */

/** Conversations the mocked api serves, keyed by id. */
const chats = new Map<string, Conversation>();

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
			addMessage: vi.fn(async (id: string, input: { text: string }) => ({
				message: {
					id: `m-${input.text}`,
					conversationId: id,
					role: 'user',
					text: input.text,
					images: [],
					createdAt: new Date(0).toISOString()
				}
			})),
			getConversation: vi.fn(async (id: string) => ({
				conversation: chats.get(id),
				messages: [],
				queued: []
			})),
			listConversations: vi.fn(async () => ({ conversations: [...chats.values()] })),
			deleteConversation: vi.fn(async () => ({ ok: true as const })),
			updateConversation: vi.fn(async (id: string) => ({ conversation: chats.get(id) })),
			getSettings: vi.fn(async () => undefined),
			listProviders: vi.fn(async () => ({ providers: [] })),
			refreshContext: vi.fn(async () => undefined),
			// The turn is not what these tests are about, so it ends at once.
			stopTurn: vi.fn(async () => ({ stopped: true }))
		},
		postStream: vi.fn(async (_url: string, _body: unknown, _signal: AbortSignal, onEvent: (e: never) => void) => {
			onEvent({ type: 'done', finishReason: 'stop', messageId: 'a1' } as never);
		}),
		getStream: vi.fn(async () => undefined),
		readEventStream: vi.fn()
	};
});

const { AppState: Runtime } = await import('$lib/client/state.svelte');
const { api } = await import('$lib/client/api');

function chat(id: string, patch: Partial<Conversation> = {}): Conversation {
	const item: Conversation = {
		id,
		title: `Chat ${id}`,
		providerId: 'p1',
		model: 'mock-model',
		system: null,
		params: {},
		createdAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString(),
		...patch
	};
	chats.set(id, item);
	return item;
}

const provider: ProviderDTO = {
	id: 'p1',
	name: 'Mock',
	baseUrl: 'http://127.0.0.1:1/v1',
	kind: 'openai',
	defaultModel: 'mock-model',
	enabled: true,
	sort: 0,
	createdAt: new Date(0).toISOString(),
	hasKey: false
};

function freshState(conversation: Conversation): AppState {
	const state = new Runtime();
	state.ready = true;
	state.conversation = conversation;
	state.providers = [provider];
	return state;
}

beforeEach(() => {
	chats.clear();
});

describe('attachments of one chat', () => {
	it('stay behind when another chat opens', async () => {
		const first = chat('c1');
		const second = chat('c2');
		const state = freshState(first);
		state.pendingImages = [{ id: 'i1', mime: 'image/png' }];
		state.pendingDocuments = [
			{ document: { id: 'd1', name: 'notes.md', pages: 0, chars: 5 }, images: [], sendImages: false }
		];

		await state.open(second.id);

		expect(state.pendingImages, 'the next chat starts with an empty box').toEqual([]);
		expect(state.pendingDocuments).toEqual([]);

		await state.open(first.id);

		expect(state.pendingImages.map((image) => image.id)).toEqual(['i1']);
		expect(state.pendingDocuments.map((item) => item.document.id)).toEqual(['d1']);
	});

	it('are dropped with the chat', async () => {
		const first = chat('c1');
		const second = chat('c2');
		const state = freshState(first);
		state.conversations = [first, second];
		state.pendingImages = [{ id: 'i1', mime: 'image/png' }];

		await state.deleteConversation(first.id);

		expect(state.conversation?.id, 'another chat takes the view').toBe('c2');
		expect(state.pendingAttachments.c1).toBeUndefined();
	});
});

describe('a message list that arrives late', () => {
	it('stays off the chat that is open now', async () => {
		const first = chat('c1');
		const second = chat('c2');
		const state = freshState(first);
		const older: Message = {
			id: 'm1',
			conversationId: 'c1',
			role: 'user',
			text: 'from the chat that was open',
			images: [],
			createdAt: new Date(0).toISOString()
		};
		// The reply for the first chat takes its time, and the user moves on.
		let release: (() => void) | undefined;
		vi.mocked(api.getConversation).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = () => resolve({ conversation: first, messages: [older], queued: [] });
				})
		);

		const late = state.refreshMessages();
		await state.open(second.id);
		release?.();
		await late;

		expect(state.conversation?.id).toBe('c2');
		expect(state.messages, 'the chat that is open keeps its own list').toEqual([]);
	});
});

describe('a send the app refuses', () => {
	it('says it sent nothing when the chat has no provider', async () => {
		const state = freshState(chat('c1'));
		state.providers = [];

		expect(await state.send('hello')).toBe(false);
		expect(state.toasts.length, 'the user is told why').toBeGreaterThan(0);
	});

	it('says it sent nothing when no model is picked', async () => {
		const state = freshState(chat('c1', { model: null }));
		// Nothing remembers a model either, so the chat really has none to send with.
		state.providers = [{ ...provider, defaultModel: null }];

		expect(await state.send('hello')).toBe(false);
	});

	it('says it sent nothing when the box holds nothing', async () => {
		const state = freshState(chat('c1'));

		expect(await state.send('   ')).toBe(false);
	});

	it('says it sent nothing when no chat is open', async () => {
		const state = freshState(chat('c1'));
		state.conversation = null;

		expect(await state.send('hello')).toBe(false);
	});

	it('says it sent the message once the server takes it', async () => {
		const state = freshState(chat('c1'));

		expect(await state.send('hello')).toBe(true);
		expect(state.pendingImages, 'the box is empty for the next message').toEqual([]);
	});
});
