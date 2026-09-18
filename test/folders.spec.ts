import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatHit, Conversation, Folder } from '$lib/shared/types';

/**
 * The actions behind the chat list: filing a chat by dragging or by the folder
 * choice, grouping two chats, pinning, and the search that waits for a pause.
 */

const calls = {
	moved: [] as [string, string | null][],
	merged: [] as [string, string][],
	folders: 0
};

function conversation(id: string, title = id): Conversation {
	return {
		id,
		title,
		providerId: null,
		model: null,
		system: null,
		params: {},
		folderId: null,
		tags: [],
		createdAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString()
	};
}

let conversations: Conversation[] = [];
let folders: Folder[] = [];
let hits: ChatHit[] = [];

vi.mock('$lib/client/api', () => ({
	ApiError: class ApiError extends Error {},
	api: {
		updateConversation: vi.fn(async (id: string, patch: { folderId?: string | null }) => {
			calls.moved.push([id, patch.folderId ?? null]);
			const next = { ...(conversations.find((item) => item.id === id) ?? conversation(id)), ...patch };
			conversations = conversations.map((item) => (item.id === id ? next : item));
			return { conversation: next };
		}),
		listConversations: vi.fn(async () => ({ conversations })),
		listFolders: vi.fn(async () => {
			calls.folders += 1;
			return { folders };
		}),
		createFolder: vi.fn(async (name: string) => {
			const folder: Folder = { id: `f${folders.length + 1}`, name, sort: 1, createdAt: '' };
			folders = [...folders, folder];
			return { folder };
		}),
		renameFolder: vi.fn(async (id: string, name: string) => {
			folders = folders.map((item) => (item.id === id ? { ...item, name } : item));
			return { folder: folders.find((item) => item.id === id)! };
		}),
		deleteFolder: vi.fn(async (id: string) => {
			folders = folders.filter((item) => item.id !== id);
			const unfiled = conversations.filter((item) => item.folderId === id).length;
			conversations = conversations.map((item) =>
				item.folderId === id ? { ...item, folderId: null } : item
			);
			return { unfiled };
		}),
		mergeFolders: vi.fn(async (chatId: string, ontoChatId: string) => {
			calls.merged.push([chatId, ontoChatId]);
			const folder: Folder = { id: 'f9', name: 'Grouped', sort: 1, createdAt: '' };
			folders = [...folders, folder];
			conversations = conversations.map((item) =>
				item.id === chatId || item.id === ontoChatId ? { ...item, folderId: folder.id } : item
			);
			return { folder };
		}),
		getSettings: vi.fn(),
		listProviders: vi.fn(async () => ({ providers: [] })),
		searchChats: vi.fn(async (query: string) => ({ query, hits }))
	},
	getStream: vi.fn(),
	postStream: vi.fn(),
	readEventStream: vi.fn()
}));

const { AppState } = await import('$lib/client/state.svelte');

function freshState(): InstanceType<typeof AppState> {
	const state = new AppState();
	state.ready = true;
	state.conversations = [conversation('c1', 'First'), conversation('c2', 'Second')];
	return state;
}

beforeEach(() => {
	calls.moved = [];
	calls.merged = [];
	calls.folders = 0;
	conversations = [conversation('c1', 'First'), conversation('c2', 'Second')];
	folders = [];
	hits = [];
});

describe('the chat list actions', () => {
	it('files a chat in a folder, and takes it out again', async () => {
		const state = freshState();
		await state.moveChat('c1', 'f1');
		expect(calls.moved).toEqual([['c1', 'f1']]);
		expect(state.conversations.find((item) => item.id === 'c1')?.folderId).toBe('f1');

		await state.moveChat('c1', null);
		expect(calls.moved.at(-1)).toEqual(['c1', null]);
		expect(state.conversations.find((item) => item.id === 'c1')?.folderId).toBeNull();
	});

	it('groups two chats when one is dropped on the other', async () => {
		const state = freshState();
		await state.mergeChats('c1', 'c2');

		expect(calls.merged).toEqual([['c1', 'c2']]);
		expect(state.openFolders.f9, 'the new folder opens').toBe(true);
		expect(state.conversations.filter((item) => item.folderId === 'f9')).toHaveLength(2);
		expect(state.chatsIn('f9').map((item) => item.id)).toEqual(['c1', 'c2']);
	});

	it('makes, renames and removes a folder, and keeps its chats', async () => {
		const state = freshState();
		await state.addFolder('Work');
		expect(state.folders.map((item) => item.name)).toEqual(['Work']);
		const id = state.folders[0].id;
		expect(state.openFolders[id], 'a new folder opens').toBe(true);

		await state.renameFolder(id, 'Office');
		expect(state.folders[0].name).toBe('Office');

		await state.moveChat('c1', id);
		await state.deleteFolder(id);
		expect(state.folders).toEqual([]);
		expect(state.conversations.find((item) => item.id === 'c1')?.folderId).toBeNull();
	});

	it('searches after a pause, and only for the last thing typed', async () => {
		const state = freshState();
		hits = [
			{
				conversationId: 'c1',
				title: 'First',
				updatedAt: '',
				snippet: 'a [match] here',
				hits: 1
			}
		];
		state.searchChats('ma');
		state.searchChats('match');
		expect(state.searching).toBe(true);
		// The pause is short, and the first query never reaches the api.
		await new Promise((resolve) => setTimeout(resolve, 260));

		expect(state.searchHits.map((hit) => hit.conversationId)).toEqual(['c1']);
		expect(state.searching).toBe(false);
		const { api } = await import('$lib/client/api');
		const calls_ = (api.searchChats as unknown as { mock: { calls: unknown[][] } }).mock.calls;
		expect(calls_).toEqual([['match']]);
	});

	it('clears the search', () => {
		const state = freshState();
		state.searchChats('anything');
		state.clearSearch();
		expect(state.searchQuery).toBe('');
		expect(state.searchHits).toEqual([]);
		expect(state.searching).toBe(false);
	});
});
