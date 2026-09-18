import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Finding an old chat: the search index, the folders, the pins and the tags.
 * The index is kept in step by triggers on the tables it points at.
 */

process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-search-'));

const store = await import('$lib/server/store');

function chat(title: string, ...texts: string[]) {
	const conversation = store.createConversation({ title });
	for (const text of texts) {
		store.appendMessage({ conversationId: conversation.id, role: 'user', text });
	}
	return conversation;
}

beforeEach(() => {
	// A clean list for every test, so the counts are exact.
	for (const conversation of store.listConversations()) store.deleteConversation(conversation.id);
	for (const folder of store.listFolders()) store.deleteFolder(folder.id);
});

describe('the search index', () => {
	it('finds a word in a message, and marks it in the snippet', () => {
		const conversation = chat('Rust notes', 'the borrow checker is strict');
		const hits = store.searchChats('borrow');
		expect(hits.map((hit) => hit.conversationId)).toContain(conversation.id);
		expect(hits[0].snippet).toContain('[borrow]');
		expect(hits[0].hits).toBe(1);
	});

	it('finds a word in a title', () => {
		const conversation = chat('Kubernetes upgrade plan', 'unrelated text');
		expect(store.searchChats('kubernetes').map((hit) => hit.conversationId)).toContain(conversation.id);
	});

	it('follows an edited message and a renamed chat', () => {
		const conversation = chat('First title', 'the old wording');
		expect(store.searchChats('wording')).toHaveLength(1);

		const [message] = store.listMessages(conversation.id);
		store.finalizeMessage(message.id, { text: 'the new wording' });
		expect(store.searchChats('new')).toHaveLength(1);
		expect(store.searchChats('oldword')).toHaveLength(0);

		store.updateConversation(conversation.id, { title: 'Second title' });
		expect(store.searchChats('second')).toHaveLength(1);
		expect(store.searchChats('firsttitle')).toHaveLength(0);
	});

	it('drops a deleted message, and its chat when the chat goes', () => {
		const conversation = chat('Delete me', 'this line will go');
		expect(store.searchChats('line')).toHaveLength(1);
		const [message] = store.listMessages(conversation.id);
		store.deleteMessagesFrom(conversation.id, message.id);
		expect(store.searchChats('line')).toHaveLength(0);

		const other = chat('Keep me', 'another line');
		store.deleteConversation(other.id);
		expect(store.searchChats('another')).toHaveLength(0);
	});

	it('counts every matching message of one chat once', () => {
		chat('Counting', 'alpha one', 'alpha two', 'beta');
		const hit = store.searchChats('alpha')[0];
		expect(hit.hits).toBe(2);
		expect(hit.messageId).toBeTruthy();
	});

	it('survives a query with quotes and operators in it', () => {
		chat('Tricky', 'a normal line');
		expect(() => store.searchChats('" OR *')).not.toThrow();
		expect(store.searchChats('')).toEqual([]);
		expect(store.searchChats('   ')).toEqual([]);
	});
});

describe('folders', () => {
	it('moves chats in and out, and keeps them when the folder goes', () => {
		const one = chat('First chat', 'one');
		const two = chat('Second chat', 'two');
		const folder = store.createFolder('Work');
		expect(store.listFolders().map((item) => item.name)).toEqual(['Work']);

		store.moveConversation(one.id, folder.id);
		store.moveConversation(two.id, folder.id);
		expect(store.listConversations().filter((item) => item.folderId === folder.id)).toHaveLength(2);

		store.moveConversation(two.id, null);
		expect(store.getConversation(two.id)?.folderId).toBeNull();

		expect(store.deleteFolder(folder.id)).toBe(1);
		expect(store.listFolders()).toEqual([]);
		expect(store.getConversation(one.id), 'the chat stays').toBeTruthy();
		expect(store.getConversation(one.id)?.folderId).toBeNull();
	});

	it('makes a folder when a chat is dropped on another chat', () => {
		const dragged = chat('Drag me', 'dragged');
		const onto = chat('Folder name', 'target');
		const folder = store.mergeIntoFolder(dragged.id, onto.id);

		expect(folder?.name).toBe('Folder name');
		expect(store.getConversation(dragged.id)?.folderId).toBe(folder?.id);
		expect(store.getConversation(onto.id)?.folderId).toBe(folder?.id);
	});

	it('drops into the folder that is already there', () => {
		const onto = chat('Existing', 'target');
		const folder = store.createFolder('Existing');
		store.moveConversation(onto.id, folder.id);
		const dragged = chat('Drag me', 'dragged');

		expect(store.mergeIntoFolder(dragged.id, onto.id)?.id).toBe(folder.id);
		expect(store.listFolders()).toHaveLength(1);
	});

	it('renames a folder', () => {
		const folder = store.createFolder('Old');
		expect(store.renameFolder(folder.id, 'New')?.name).toBe('New');
		expect(store.renameFolder('nowhere', 'New')).toBeUndefined();
	});
});

describe('tags', () => {
	it('keeps tags tidy', () => {
		const conversation = chat('Tag me', 'text');
		expect(store.normalizeTags(['  Work ', 'work', 'Long   name', '', 'x'.repeat(40)])).toEqual([
			'work',
			'long name',
			'x'.repeat(24)
		]);
		expect(store.setTags(conversation.id, [' Work ', 'work', 'Pets'])?.tags).toEqual(['work', 'pets']);
	});
});
