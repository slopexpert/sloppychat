import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

/**
 * The keys that keep the chat whole: a chat can only name a provider and a
 * folder that exist, a message can only follow a message that exists, and each
 * message holds one place in the line. A database from an older build has
 * neither the keys nor the rule, and it may hold rows that break them, so the
 * migration has to clean those rows and add the keys without losing the chat.
 */

const dir = mkdtempSync(join(tmpdir(), 'sloppychat-schema-'));
process.env.SLOPPYCHAT_DATA_DIR = dir;
const file = join(dir, 'legacy.db');
process.env.SLOPPYCHAT_DB = file;

// The shape an older build left behind: no keys on provider, folder or parent,
// and nothing that stops two messages taking the same place in the line.
const legacy = new DatabaseSync(file);
legacy.exec(`
	CREATE TABLE providers (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		base_url TEXT NOT NULL,
		api_key TEXT NOT NULL DEFAULT '',
		kind TEXT NOT NULL DEFAULT 'openai',
		default_model TEXT,
		enabled INTEGER NOT NULL DEFAULT 1,
		sort INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	);
	CREATE TABLE conversations (
		id          TEXT PRIMARY KEY,
		title       TEXT NOT NULL DEFAULT 'New chat',
		provider_id TEXT,
		model       TEXT,
		system      TEXT,
		params      TEXT NOT NULL DEFAULT '{}',
		created_at  TEXT NOT NULL,
		updated_at  TEXT NOT NULL,
		folder_id   TEXT
	);
	CREATE TABLE messages (
		id              TEXT PRIMARY KEY,
		conversation_id TEXT NOT NULL,
		seq             INTEGER NOT NULL,
		role            TEXT NOT NULL,
		text            TEXT NOT NULL DEFAULT '',
		reasoning       TEXT,
		images          TEXT NOT NULL DEFAULT '[]',
		tool_calls      TEXT,
		tool_call_id    TEXT,
		tool_name       TEXT,
		is_error        INTEGER NOT NULL DEFAULT 0,
		model           TEXT,
		usage           TEXT,
		created_at      TEXT NOT NULL
	);
	INSERT INTO providers (id, name, base_url, created_at)
		VALUES ('p1', 'Keep me', 'http://127.0.0.1:1/v1', '2026-01-01T00:00:00.000Z');
	INSERT INTO conversations (id, title, provider_id, folder_id, params, created_at, updated_at)
		VALUES ('c1', 'Whole chat', 'p1', 'gone-folder', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
	INSERT INTO messages (id, conversation_id, seq, role, text, images, created_at) VALUES
		('m1', 'c1', 1, 'user', 'the borrow checker', '[]', '2026-01-01T00:00:00.000Z'),
		('m2', 'c1', 1, 'assistant', 'it checks ownership', '[]', '2026-01-01T00:00:01.000Z');
`);
legacy.close();

const store = await import('$lib/server/store');
const db = await import('$lib/server/db');

/** True when the database says no to one statement. */
function refuses(sql: string): boolean {
	try {
		db.run(sql);
		return false;
	} catch {
		return true;
	}
}

describe('a database from an older build', () => {
	it('keeps the chat and the provider it still has', () => {
		const conversation = store.getConversation('c1');
		expect(conversation?.title).toBe('Whole chat');
		expect(conversation?.providerId).toBe('p1');
		expect(store.getProvider('p1')?.name).toBe('Keep me');
	});

	it('drops the folder and the parent that point at nothing', () => {
		expect(store.getConversation('c1')?.folderId).toBeNull();
		expect(store.getConversation('c1')?.activeLeafId).toBe('m2');
		expect(store.listMessages('c1')[1].parentId).toBe('m1');
	});

	it('gives the two messages of one place their own number', () => {
		const places = db
			.all(`SELECT id, seq FROM messages WHERE conversation_id = 'c1' ORDER BY seq`)
			.map((row) => `${String(row.id)}:${String(row.seq)}`);
		expect(places).toEqual(['m1:1', 'm2:2']);
		// The line is whole again, so the walk from the end reaches the question.
		expect(store.listMessages('c1').map((message) => message.text)).toEqual([
			'the borrow checker',
			'it checks ownership'
		]);
	});

	it('still finds the old text in the search', () => {
		expect(store.searchChats('ownership').map((hit) => hit.conversationId)).toContain('c1');
		expect(store.searchChats('whole chat').map((hit) => hit.conversationId)).toContain('c1');
	});

	it('keeps a message written after the move searchable', () => {
		const conversation = store.createConversation({ title: 'After the move' });
		store.appendMessage({ conversationId: conversation.id, role: 'user', text: 'indexed after the move' });

		expect(store.searchChats('indexed').map((hit) => hit.conversationId)).toContain(conversation.id);
	});

	it('now refuses a second message in the same place', () => {
		expect(
			refuses(
				`INSERT INTO messages (id, conversation_id, seq, role, text, images, created_at)
				 VALUES ('m9', 'c1', 2, 'user', 'clash', '[]', '2026-01-01T00:00:02.000Z')`
			)
		).toBe(true);
	});

	it('now refuses a provider and a folder that do not exist', () => {
		expect(refuses(`UPDATE conversations SET provider_id = 'nobody' WHERE id = 'c1'`)).toBe(true);
		expect(refuses(`UPDATE conversations SET folder_id = 'nowhere' WHERE id = 'c1'`)).toBe(true);
	});
});

describe('the keys on a chat', () => {
	it('clears the provider of a chat when the provider is deleted', () => {
		const provider = store.createProvider({ name: 'Temp', baseUrl: 'http://127.0.0.1:1/v1' });
		const conversation = store.createConversation({ providerId: provider.id, model: 'm' });
		expect(conversation.providerId).toBe(provider.id);

		store.deleteProvider(provider.id);

		expect(store.getConversation(conversation.id)?.providerId).toBeNull();
	});

	it('keeps the chat out of a folder that is gone instead of failing', () => {
		const conversation = store.createConversation({ title: 'Plain' });

		expect(store.moveConversation(conversation.id, 'no-such-folder')).toEqual(
			expect.objectContaining({ id: conversation.id, folderId: null })
		);
		expect(
			store.updateConversation(conversation.id, { folderId: 'no-such-folder' })?.folderId
		).toBeNull();
	});

	it('writes a message and its place in the line as one unit', () => {
		const conversation = store.createConversation({ title: 'One unit' });
		const message = store.appendMessage({ conversationId: conversation.id, role: 'user', text: 'one' });

		// The row, the end of the line and the touched time all arrived together.
		expect(store.listMessages(conversation.id).map((row) => row.id)).toEqual([message.id]);
		expect(store.getConversation(conversation.id)?.activeLeafId).toBe(message.id);
	});
});
