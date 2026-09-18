import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

/**
 * A chat is a tree now: each message knows the message it follows, and the view
 * shows the line from the first message down to the active leaf. This test
 * builds a database in the old shape first, so the migration is covered too.
 */

const dir = mkdtempSync(join(tmpdir(), 'sloppychat-branches-'));
process.env.SLOPPYCHAT_DATA_DIR = dir;
const file = join(dir, 'legacy.db');
process.env.SLOPPYCHAT_DB = file;

// The shape the app used before branches: no parent, no active leaf, no reason.
const legacy = new DatabaseSync(file);
legacy.exec(`
	CREATE TABLE conversations (
		id          TEXT PRIMARY KEY,
		title       TEXT NOT NULL DEFAULT 'New chat',
		provider_id TEXT,
		model       TEXT,
		system      TEXT,
		params      TEXT NOT NULL DEFAULT '{}',
		created_at  TEXT NOT NULL,
		updated_at  TEXT NOT NULL
	);
	CREATE TABLE messages (
		id              TEXT PRIMARY KEY,
		conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
		seq             INTEGER NOT NULL,
		role            TEXT NOT NULL,
		text            TEXT NOT NULL DEFAULT '',
		reasoning       TEXT,
		images          TEXT NOT NULL DEFAULT '[]',
		documents       TEXT NOT NULL DEFAULT '[]',
		tool_calls      TEXT,
		tool_call_id    TEXT,
		tool_name       TEXT,
		is_error        INTEGER NOT NULL DEFAULT 0,
		model           TEXT,
		usage           TEXT,
		created_at      TEXT NOT NULL
	);
	INSERT INTO conversations (id, title, params, created_at, updated_at)
		VALUES ('c1', 'Old chat', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
	INSERT INTO messages (id, conversation_id, seq, role, text, images, documents, created_at) VALUES
		('m1', 'c1', 1, 'user', 'hello', '[]', '[]', '2026-01-01T00:00:00.000Z'),
		('m2', 'c1', 2, 'assistant', 'hi', '[]', '[]', '2026-01-01T00:00:01.000Z');
`);
legacy.close();

const store = await import('$lib/server/store');

describe('a chat that was one line', () => {
	it('gets a parent for every message and a leaf at the end', () => {
		const line = store.listMessages('c1');
		expect(line.map((message) => message.id)).toEqual(['m1', 'm2']);
		expect(line[0].parentId).toBeNull();
		expect(line[1].parentId).toBe('m1');
		expect(store.getConversation('c1')?.activeLeafId).toBe('m2');
		expect(line[1].brothers).toEqual(['m2']);
	});
});

describe('branches', () => {
	function chat() {
		const conversation = store.createConversation({ title: 'Branch test' });
		const question = store.appendMessage({ conversationId: conversation.id, role: 'user', text: 'first' });
		const first = store.appendMessage({ conversationId: conversation.id, role: 'assistant', text: 'answer one' });
		return { id: conversation.id, question, first };
	}

	it('keeps an old answer when a new one is made for the same question', () => {
		const { id, question, first } = chat();
		// Retry puts the line back on the question, so the next answer is a brother.
		store.setActiveLeaf(id, question.id);
		const second = store.appendMessage({ conversationId: id, role: 'assistant', text: 'answer two' });

		const line = store.listMessages(id);
		expect(line.map((message) => message.text)).toEqual(['first', 'answer two']);
		expect(line[1].parentId).toBe(question.id);
		expect(line[1].brothers).toEqual([first.id, second.id]);
		expect(store.getMessage(first.id)?.text, 'the old answer is still there').toBe('answer one');
	});

	it('switches the line to another brother, and to the newest message below it', () => {
		const { id, question, first } = chat();
		store.setActiveLeaf(id, question.id);
		const second = store.appendMessage({ conversationId: id, role: 'assistant', text: 'answer two' });

		expect(store.viewBranch(id, first.id)).toBe(first.id);
		expect(store.listMessages(id).map((message) => message.text)).toEqual(['first', 'answer one']);

		// The question has two answers, so the switch lands on the newer one.
		expect(store.viewBranch(id, question.id)).toBe(second.id);
		expect(store.listMessages(id).map((message) => message.text)).toEqual(['first', 'answer two']);
	});

	it('removes a message with everything below it, and moves the line up', () => {
		const { id, question } = chat();
		store.setActiveLeaf(id, question.id);
		store.appendMessage({ conversationId: id, role: 'assistant', text: 'answer two' });

		expect(store.deleteMessagesFrom(id, question.id)).toBe(3);
		expect(store.listMessages(id)).toEqual([]);
		expect(store.getConversation(id)?.activeLeafId).toBeNull();
	});

	it('keeps the deepest leaf when the tree goes deeper', () => {
		const { id, question, first } = chat();
		store.setActiveLeaf(id, question.id);
		const second = store.appendMessage({ conversationId: id, role: 'assistant', text: 'answer two' });
		// A question after the second answer, and an answer to it.
		const followUp = store.appendMessage({ conversationId: id, role: 'user', text: 'and then?' });
		store.appendMessage({ conversationId: id, role: 'assistant', text: 'third' });

		// Switching to the first answer shows its own line only.
		expect(store.viewBranch(id, first.id)).toBe(first.id);
		expect(store.listMessages(id).map((message) => message.text)).toEqual(['first', 'answer one']);
		// Switching to the second answer follows it all the way down.
		expect(store.viewBranch(id, second.id)).toBe(store.listMessages(id).at(-1)?.id);
		expect(store.listMessages(id).map((message) => message.text)).toEqual([
			'first',
			'answer two',
			'and then?',
			'third'
		]);
		expect(followUp.parentId).toBe(second.id);
	});

	it('keeps why an answer stopped', () => {
		const conversation = store.createConversation({ title: 'Stop reason' });
		const answer = store.appendMessage({ conversationId: conversation.id, role: 'assistant', text: 'cut off' });
		store.finalizeMessage(answer.id, { text: 'cut off', finishReason: 'length' });
		expect(store.getMessage(answer.id)?.finishReason).toBe('length');
	});
});
