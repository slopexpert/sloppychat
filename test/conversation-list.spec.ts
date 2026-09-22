import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The chat list is one query with one bound. A chat that falls outside the bound
 * leaves the sidebar without a word, so the bound is named, wide, and tested.
 *
 * The store reads the database path when the module loads, so the data directory
 * is set before the first server import.
 */

process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-list-'));

const store = await import('$lib/server/store');
const { run } = await import('$lib/server/db');

describe('the chat list', () => {
	it('holds its bound and keeps the chats touched last', () => {
		const chats = Array.from({ length: store.CONVERSATION_LIMIT + 1 }, () => store.createConversation());
		// One stamp per chat, so the order the list must keep is fixed here.
		chats.forEach((chat, index) => {
			run('UPDATE conversations SET updated_at = ? WHERE id = ?', new Date(index * 1000).toISOString(), chat.id);
		});
		const newest = chats[chats.length - 1];
		const oldest = chats[0];

		const list = store.listConversations();

		expect(list).toHaveLength(store.CONVERSATION_LIMIT);
		expect(list[0]?.id, 'the chat touched last leads').toBe(newest.id);
		expect(list.some((chat) => chat.id === oldest.id), 'the chat touched first falls off').toBe(false);
	});
});
