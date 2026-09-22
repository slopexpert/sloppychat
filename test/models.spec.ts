import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '$lib/shared/types';
import type { Conversation, ProviderDTO, Settings } from '$lib/shared/types';

/**
 * Model selection rules: lists are discovered on load, a new chat inherits what
 * is in view, and an empty chat is filled with the last model used.
 */

const provider = (id: string, defaultModel: string | null = null): ProviderDTO => ({
	id,
	name: `Provider ${id}`,
	baseUrl: `http://127.0.0.1/${id}/v1`,
	kind: 'openai',
	defaultModel,
	enabled: true,
	sort: 0,
	createdAt: new Date(0).toISOString(),
	hasKey: false
});

const conversation = (id: string, overrides: Partial<Conversation> = {}): Conversation => ({
	id,
	title: `Chat ${id}`,
	providerId: 'p1',
	model: null,
	system: null,
	params: {},
	createdAt: new Date(0).toISOString(),
	updatedAt: new Date(0).toISOString(),
	...overrides
});

const server = {
	settings: structuredClone(DEFAULT_SETTINGS) as Settings,
	providers: [provider('p1', 'default-model'), provider('p2', 'other-default')] as ProviderDTO[],
	conversations: [] as Conversation[],
	models: {} as Record<string, { id: string }[]>,
	modelsRequested: [] as string[],
	patched: [] as { id: string; patch: Partial<Conversation> }[],
	saved: [] as Partial<Settings>[],
	created: [] as Partial<Conversation>[],
	nextId: 0
};

vi.mock('$lib/client/api', () => {
	class ApiError extends Error {
		constructor(
			message: string,
			readonly status: number
		) {
			super(message);
		}
	}
	const find = (id: string) => server.conversations.find((item) => item.id === id)!;
	return {
		ApiError,
		api: {
			getSettings: vi.fn(async () => server.settings),
			saveSettings: vi.fn(async (patch: Partial<Settings>) => {
				server.saved.push(patch);
				server.settings = {
					...server.settings,
					...patch,
					defaults: { ...server.settings.defaults, ...patch.defaults },
					theme: { ...server.settings.theme, ...patch.theme }
				};
				return server.settings;
			}),
			listProviders: vi.fn(async () => ({ providers: server.providers })),
			listConversations: vi.fn(async () => ({ conversations: server.conversations })),
			getConversation: vi.fn(async (id: string) => ({ conversation: find(id), messages: [] })),
			createConversation: vi.fn(async (input: Partial<Conversation>) => {
				const created = conversation(`c${++server.nextId}`, input);
				server.created.push(input);
				server.conversations = [created, ...server.conversations];
				return { conversation: created };
			}),
			updateConversation: vi.fn(async (id: string, patch: Partial<Conversation>) => {
				server.patched.push({ id, patch });
				const updated = { ...find(id), ...patch };
				server.conversations = server.conversations.map((item) => (item.id === id ? updated : item));
				return { conversation: updated };
			}),
			deleteConversation: vi.fn(),
			listModels: vi.fn(async (id: string) => {
				server.modelsRequested.push(id);
				const models = server.models[id] ?? [];
				return { models, count: models.length };
			}),
			addMessage: vi.fn(),
			getImage: vi.fn()
		},
		postStream: vi.fn(),
		readEventStream: vi.fn()
	};
});

const { AppState } = await import('$lib/client/state.svelte');

/** Lets the background discovery promises settle. */
async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	server.settings = structuredClone(DEFAULT_SETTINGS);
	server.providers = [provider('p1', 'default-model'), provider('p2', 'other-default')];
	server.conversations = [];
	server.models = {};
	server.modelsRequested = [];
	server.patched = [];
	server.saved = [];
	server.created = [];
	server.nextId = 0;
});

describe('discovery on load', () => {
	it('asks every provider for its models', async () => {
		const state = new AppState();
		server.models = { p1: [{ id: 'm1' }], p2: [{ id: 'm2' }] };
		await state.init();
		await settle();
		expect(server.modelsRequested).toEqual(['p1', 'p2']);
		expect(state.models.p1?.map((model) => model.id)).toEqual(['m1']);
	});

	it('discovers models for a provider that was just added', async () => {
		const state = new AppState();
		await state.init();
		await settle();
		server.modelsRequested = [];
		server.providers = [...server.providers, provider('p3')];
		server.models.p3 = [{ id: 'm3' }];
		await state.reloadProviders();
		await settle();
		expect(server.modelsRequested).toContain('p3');
	});
});

describe('picking a model', () => {
	it('fills an empty chat with the provider default', async () => {
		server.conversations = [conversation('c1', { model: null })];
		const state = new AppState();
		await state.init();
		await settle();
		expect(state.conversation?.model).toBe('default-model');
		expect(server.patched).toContainEqual({ id: 'c1', patch: { model: 'default-model' } });
	});

	it('prefers the last used model over the provider default', async () => {
		server.settings.defaults = { providerId: 'p1', model: 'remembered' };
		server.models = { p1: [{ id: 'm1' }] };
		server.conversations = [conversation('c1', { model: null })];
		const state = new AppState();
		await state.init();
		await settle();
		expect(state.conversation?.model).toBe('remembered');
	});

	it('falls back to the first discovered model', async () => {
		server.providers = [provider('p1', null)];
		server.models = { p1: [{ id: 'alpha' }, { id: 'beta' }] };
		server.conversations = [conversation('c1', { model: null })];
		const state = new AppState();
		await state.init();
		await settle();
		expect(state.conversation?.model).toBe('alpha');
	});

	it('selects a model for a chat that has no provider either', async () => {
		server.providers = [provider('p1', 'default-model')];
		server.conversations = [conversation('c1', { providerId: null, model: null })];
		const state = new AppState();
		await state.init();
		await settle();
		expect(state.conversation?.model).toBe('default-model');
	});

	it('leaves a model that is already set alone', async () => {
		server.conversations = [conversation('c1', { model: 'chosen-by-hand' })];
		const state = new AppState();
		await state.init();
		await settle();
		expect(state.conversation?.model).toBe('chosen-by-hand');
		expect(server.patched).toEqual([]);
	});

	it('ignores a remembered model that belongs to another provider', async () => {
		server.settings.defaults = { providerId: 'p2', model: 'remembered-elsewhere' };
		server.providers = [provider('p1', null)];
		server.models = {};
		server.conversations = [conversation('c1', { providerId: 'p1', model: null })];
		const state = new AppState();
		await state.init();
		await settle();
		// p1 reports nothing and has no default, so nothing is invented.
		expect(state.conversation?.model).toBe(null);
	});
});

describe('new chats', () => {
	it('inherits the provider and model of the chat in view', async () => {
		server.conversations = [conversation('c1', { providerId: 'p2', model: 'other-default' })];
		const state = new AppState();
		await state.init();
		await settle();
		server.created = [];
		await state.newConversation();
		expect(server.created[0]).toMatchObject({ providerId: 'p2', model: 'other-default' });
		expect(state.conversation?.model).toBe('other-default');
	});

	it('keeps a chat that is already fresh instead of opening another', async () => {
		server.conversations = [conversation('c1', { title: 'New chat', model: 'default-model' })];
		const state = new AppState();
		await state.init();
		await settle();
		server.created = [];
		await state.newConversation();
		expect(server.created).toHaveLength(0);
		expect(state.conversation?.id).toBe('c1');
		// A file waiting in the box belongs to the chat that is open, so it stays.
		state.pendingDocuments = [
			{ document: { id: 'd1', name: 'src/app.ts', pages: 0, chars: 12 }, images: [], sendImages: false }
		];
		await state.newConversation();
		expect(server.created).toHaveLength(0);
		state.pendingDocuments = [];
		// A chat with a title of its own is a chat the reader wants to keep.
		state.conversation = { ...state.conversation!, title: 'Notes on the parser' };
		await state.newConversation();
		expect(server.created).toHaveLength(1);
	});

	it('asks the composer for the keyboard, fresh chat or new one', async () => {
		server.conversations = [conversation('c1', { title: 'New chat', model: 'default-model' })];
		const state = new AppState();
		await state.init();
		await settle();
		server.created = [];
		// The chat in view is untouched, so no second entry opens and the box is asked for.
		state.focusComposer = false;
		await state.newConversation();
		expect(state.focusComposer).toBe(true);
		expect(server.created).toHaveLength(0);
		// A chat with a title of its own is kept, and a new chat opens in its place.
		state.focusComposer = false;
		state.conversation = { ...state.conversation!, title: 'Notes on the parser' };
		await state.newConversation();
		expect(server.created).toHaveLength(1);
		expect(state.focusComposer).toBe(true);
	});

	it('gets the drawer out of the way when New chat is pressed on a narrow screen', async () => {
		server.conversations = [conversation('c1', { title: 'Notes', model: 'default-model' })];
		const state = new AppState();
		await state.init();
		await settle();
		state.narrow = true;
		state.sidebarOpen = true;
		await state.newConversation();
		expect(state.sidebarOpen).toBe(false);
		// The chat that opens is fresh, so the next press takes the early path and
		// closes the drawer all the same.
		state.sidebarOpen = true;
		await state.newConversation();
		expect(state.sidebarOpen).toBe(false);
	});

	it('closes the drawer when a chat is picked on a narrow screen', async () => {
		server.conversations = [conversation('c1', { model: 'default-model' })];
		const state = new AppState();
		await state.init();
		await settle();
		// Narrow: the list is a drawer covering the chat, so picking one closes it.
		state.narrow = true;
		state.sidebarOpen = true;
		await state.open('c1');
		expect(state.sidebarOpen).toBe(false);
	});

	it('leaves the column open when a chat is picked on a wide screen', async () => {
		server.conversations = [conversation('c1', { model: 'default-model' })];
		const state = new AppState();
		await state.init();
		await settle();
		await state.open('c1');
		expect(state.sidebarOpen).toBe(true);
	});

	it('picks the last used model for the first chat too', async () => {
		server.settings.defaults = { providerId: 'p1', model: 'remembered' };
		const state = new AppState();
		await state.init();
		await settle();
		expect(server.created[0]).toMatchObject({ providerId: 'p1', model: 'remembered' });
	});
});

describe('remembering the model', () => {
	it('stores the model that was picked', async () => {
		server.conversations = [conversation('c1', { model: 'default-model' })];
		const state = new AppState();
		await state.init();
		await settle();
		await state.setModel('m9');
		await settle();
		expect(state.conversation?.model).toBe('m9');
		expect(state.settings.defaults).toEqual({ providerId: 'p1', model: 'm9' });
		expect(server.saved).toContainEqual({ defaults: { providerId: 'p1', model: 'm9' } });
	});

	it('does not save the same model twice', async () => {
		server.conversations = [conversation('c1', { model: 'default-model' })];
		const state = new AppState();
		await state.init();
		await settle();
		await state.setModel('m9');
		await settle();
		server.saved = [];
		await state.setModel('m9');
		await settle();
		expect(server.saved).toEqual([]);
	});

	it('switching provider moves to a model that provider can serve', async () => {
		server.conversations = [conversation('c1', { model: 'default-model' })];
		const state = new AppState();
		await state.init();
		await settle();
		await state.setProvider('p2');
		await settle();
		expect(state.conversation?.providerId).toBe('p2');
		expect(state.conversation?.model).toBe('other-default');
		expect(state.settings.defaults).toEqual({ providerId: 'p2', model: 'other-default' });
	});
});
