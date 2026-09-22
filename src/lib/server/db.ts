import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Single-user sqlite store. node:sqlite is synchronous, which keeps the route
 * handlers free of callback plumbing and is fine at this scale.
 */

const DATA_DIR = process.env.SLOPPYCHAT_DATA_DIR ?? join(process.cwd(), 'var');
const DB_PATH = process.env.SLOPPYCHAT_DB ?? join(DATA_DIR, 'sloppychat.db');

/**
 * The two tables that hold the chat. They are written out on their own because a
 * database made by an older build is rebuilt from this same text.
 */
const CREATE_CONVERSATIONS = `
CREATE TABLE IF NOT EXISTS conversations (
	id          TEXT PRIMARY KEY,
	title       TEXT NOT NULL DEFAULT 'New chat',
	provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
	model       TEXT,
	system      TEXT,
	params      TEXT NOT NULL DEFAULT '{}',
	created_at  TEXT NOT NULL,
	updated_at  TEXT NOT NULL,
	active_leaf_id TEXT,
	folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
	tags        TEXT NOT NULL DEFAULT '[]'
);`;

const CREATE_MESSAGES = `
CREATE TABLE IF NOT EXISTS messages (
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
	created_at      TEXT NOT NULL,
	parent_id       TEXT REFERENCES messages(id) ON DELETE CASCADE,
	finish_reason   TEXT,
	/** One place in the line per chat, so two turns cannot land on the same one. */
	UNIQUE (conversation_id, seq)
);`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS providers (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	base_url    TEXT NOT NULL,
	api_key     TEXT NOT NULL DEFAULT '',
	kind        TEXT NOT NULL DEFAULT 'openai',
	default_model TEXT,
	enabled     INTEGER NOT NULL DEFAULT 1,
	sort        INTEGER NOT NULL DEFAULT 0,
	created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
	id         TEXT PRIMARY KEY,
	name       TEXT NOT NULL,
	sort       INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
);

${CREATE_CONVERSATIONS}

${CREATE_MESSAGES}

CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, seq);

CREATE TABLE IF NOT EXISTS images (
	id         TEXT PRIMARY KEY,
	mime       TEXT NOT NULL,
	blob       BLOB NOT NULL,
	bytes      INTEGER NOT NULL,
	created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
	id         TEXT PRIMARY KEY,
	name       TEXT NOT NULL,
	mime       TEXT NOT NULL,
	pages      INTEGER NOT NULL,
	text       TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	body        TEXT NOT NULL DEFAULT '',
	enabled     INTEGER NOT NULL DEFAULT 1,
	created_at  TEXT NOT NULL,
	updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
	id          TEXT PRIMARY KEY,
	title       TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	body        TEXT NOT NULL DEFAULT '',
	kind        TEXT NOT NULL DEFAULT 'user',
	sort        INTEGER NOT NULL DEFAULT 0,
	created_at  TEXT NOT NULL,
	updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

/**
 * Full text search over the chat titles and the message text. The indexes hold
 * no copy of the text: they point at the tables, and the triggers below keep
 * them in step on every insert, update and delete.
 */
CREATE VIRTUAL TABLE IF NOT EXISTS chats_fts USING fts5(title, content='conversations', content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS conversations_fts_insert AFTER INSERT ON conversations BEGIN
	INSERT INTO chats_fts (rowid, title) VALUES (new.rowid, new.title);
END;
CREATE TRIGGER IF NOT EXISTS conversations_fts_update AFTER UPDATE OF title ON conversations BEGIN
	INSERT INTO chats_fts (chats_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
	INSERT INTO chats_fts (rowid, title) VALUES (new.rowid, new.title);
END;
CREATE TRIGGER IF NOT EXISTS conversations_fts_delete AFTER DELETE ON conversations BEGIN
	INSERT INTO chats_fts (chats_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
	INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF text ON messages BEGIN
	INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
	INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
	INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TABLE IF NOT EXISTS settings (
	id   INTEGER PRIMARY KEY CHECK (id = 1),
	data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queued_messages (
	id              TEXT PRIMARY KEY,
	conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
	seq             INTEGER NOT NULL,
	text            TEXT NOT NULL DEFAULT '',
	images          TEXT NOT NULL DEFAULT '[]',
	documents       TEXT NOT NULL DEFAULT '[]',
	created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS queued_conv ON queued_messages(conversation_id, seq);

CREATE TABLE IF NOT EXISTS mcp_servers (
	id         TEXT PRIMARY KEY,
	name       TEXT NOT NULL,
	enabled    INTEGER NOT NULL DEFAULT 1,
	config     TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
`;

export interface DB {
	sqlite: DatabaseSync;
}

let instance: DB | null = null;

export function getDB(): DB {
	if (instance) return instance;
	mkdirSync(dirname(DB_PATH), { recursive: true });
	const sqlite = new DatabaseSync(DB_PATH);
	sqlite.exec('PRAGMA journal_mode = WAL');
	sqlite.exec('PRAGMA foreign_keys = ON');
	sqlite.exec(SCHEMA);
	migrate(sqlite);
	instance = { sqlite };
	return instance;
}

/** Adds columns that older databases may not have yet. */
function migrate(sqlite: DatabaseSync): void {
	// The place of a message is counted before anything reads the order, because a
	// database from an older build can hold two messages in the same place.
	numberTheLine(sqlite);
	const columns = sqlite.prepare('PRAGMA table_info(conversations)').all() as { name?: string }[];
	if (!columns.some((column) => column.name === 'params')) {
		sqlite.exec("ALTER TABLE conversations ADD COLUMN params TEXT NOT NULL DEFAULT '{}'");
	}
	const messageColumns = sqlite.prepare('PRAGMA table_info(messages)').all() as { name?: string }[];
	if (!messageColumns.some((column) => column.name === 'documents')) {
		sqlite.exec("ALTER TABLE messages ADD COLUMN documents TEXT NOT NULL DEFAULT '[]'");
	}
	if (!messageColumns.some((column) => column.name === 'finish_reason')) {
		sqlite.exec('ALTER TABLE messages ADD COLUMN finish_reason TEXT');
	}
	// An older chat is one line, so each message follows the one before it, and
	// the last message of the chat is the end of that line.
	if (!messageColumns.some((column) => column.name === 'parent_id')) {
		sqlite.exec('ALTER TABLE messages ADD COLUMN parent_id TEXT');
		sqlite.exec(
			`UPDATE messages SET parent_id = (
				SELECT previous.id FROM messages AS previous
				WHERE previous.conversation_id = messages.conversation_id AND previous.seq < messages.seq
				ORDER BY previous.seq DESC LIMIT 1
			)`
		);
	}
	if (!columns.some((column) => column.name === 'active_leaf_id')) {
		sqlite.exec('ALTER TABLE conversations ADD COLUMN active_leaf_id TEXT');
		sqlite.exec(
			`UPDATE conversations SET active_leaf_id = (
				SELECT id FROM messages WHERE messages.conversation_id = conversations.id ORDER BY seq DESC LIMIT 1
			)`
		);
	}
	if (!columns.some((column) => column.name === 'folder_id')) {
		sqlite.exec('ALTER TABLE conversations ADD COLUMN folder_id TEXT');
	}
	if (!columns.some((column) => column.name === 'tags')) {
		sqlite.exec("ALTER TABLE conversations ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
	}
	// The line of a chat is read through the parent column, so the index goes after
	// the column: an older database gets it from the ALTER above.
	sqlite.exec('CREATE INDEX IF NOT EXISTS messages_parent ON messages(parent_id)');
	// A database from an older build has no keys and no rule about the place of a
	// message, and SQLite cannot add either to a table that exists, so those two
	// tables are rebuilt from the text above.
	const missingKeys =
		!hasForeignKey(sqlite, 'conversations', 'provider_id') ||
		!hasForeignKey(sqlite, 'conversations', 'folder_id') ||
		!hasForeignKey(sqlite, 'messages', 'parent_id') ||
		!hasUniqueIndex(sqlite, 'messages', ['conversation_id', 'seq']);
	if (missingKeys) {
		dropDanglingReferences(sqlite);
		rebuild(sqlite, 'conversations', CREATE_CONVERSATIONS);
		rebuild(sqlite, 'messages', CREATE_MESSAGES);
		// The rebuild took the search triggers along with the old table, and the
		// copied rows have new row numbers, so the triggers and the index come next.
		sqlite.exec(SCHEMA);
		sqlite.exec(
			"INSERT INTO meta (key, value) VALUES ('fts_built', '0') ON CONFLICT(key) DO UPDATE SET value = '0'"
		);
	}
	// The search indexes are built once, with the command FTS5 gives for it, and
	// the triggers keep them in step after that. Counting the rows of an external
	// content table cannot say whether the index holds them: it reads through to
	// the table itself, so an empty index looks full.
	const built = sqlite.prepare('SELECT value FROM meta WHERE key = ?').get('fts_built') as
		| { value?: string }
		| undefined;
	if (built?.value !== '1') {
		sqlite.exec("INSERT INTO chats_fts (chats_fts) VALUES ('rebuild')");
		sqlite.exec("INSERT INTO messages_fts (messages_fts) VALUES ('rebuild')");
		sqlite.exec(
			"INSERT INTO meta (key, value) VALUES ('fts_built', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
		);
	}
}

/** Column names of a table, in declaration order. */
function tableColumns(sqlite: DatabaseSync, table: string): string[] {
	return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name?: string }[])
		.map((column) => column.name ?? '')
		.filter(Boolean);
}

/** True when the table carries a foreign key on that column. */
function hasForeignKey(sqlite: DatabaseSync, table: string, column: string): boolean {
	// The child column of a key comes back under the name from.
	return sqlite
		.prepare(`PRAGMA foreign_key_list(${table})`)
		.all()
		.some((key) => key.from === column);
}

/** True when a unique index covers exactly these columns, in that order. */
function hasUniqueIndex(sqlite: DatabaseSync, table: string, wanted: string[]): boolean {
	const indexes = sqlite.prepare(`PRAGMA index_list(${table})`).all() as { name?: string; unique?: number }[];
	return indexes.some((index) => {
		if (!index.name || index.unique !== 1) return false;
		const held = (sqlite.prepare(`PRAGMA index_info(${index.name})`).all() as { name?: string }[]).map(
			(column) => column.name
		);
		return held.join(',') === wanted.join(',');
	});
}

/**
 * Makes a table again from its current text and copies the rows across. Ids, the
 * order of the line and the text of an answer all stay as they were.
 */
function rebuild(sqlite: DatabaseSync, table: string, create: string): void {
	const before = tableColumns(sqlite, table);
	// Keys are off while the rows move, because a row can be copied before the
	// row it points at.
	sqlite.exec('PRAGMA foreign_keys = OFF');
	try {
		sqlite.exec('BEGIN');
		sqlite.exec(`ALTER TABLE ${table} RENAME TO ${table}_old`);
		sqlite.exec(create);
		const columns = tableColumns(sqlite, table).filter((column) => before.includes(column));
		sqlite.exec(
			`INSERT INTO ${table} (${columns.join(', ')}) SELECT ${columns.join(', ')} FROM ${table}_old`
		);
		sqlite.exec(`DROP TABLE ${table}_old`);
		sqlite.exec('COMMIT');
	} catch (err) {
		sqlite.exec('ROLLBACK');
		sqlite.exec('PRAGMA foreign_keys = ON');
		throw err;
	}
	sqlite.exec('PRAGMA foreign_keys = ON');
}

/**
 * Gives every message its own place in the line of its chat, in the order it
 * already had. Two messages in one place are a sign of a write that stopped
 * halfway, and the new rule would refuse them.
 */
function numberTheLine(sqlite: DatabaseSync): void {
	sqlite.exec(
		`WITH numbered AS (
			SELECT rowid AS rid, ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY seq, rowid) AS n
			FROM messages
		)
		UPDATE messages SET seq = (SELECT n FROM numbered WHERE numbered.rid = messages.rowid)
		 WHERE seq <> (SELECT n FROM numbered WHERE numbered.rid = messages.rowid)`
	);
}

/**
 * Clears the references that point at nothing, so the new keys can go onto a
 * database that was written before the keys existed.
 */
function dropDanglingReferences(sqlite: DatabaseSync): void {
	sqlite.exec(
		`UPDATE conversations SET provider_id = NULL
		 WHERE provider_id IS NOT NULL AND provider_id NOT IN (SELECT id FROM providers)`
	);
	sqlite.exec(
		`UPDATE conversations SET folder_id = NULL
		 WHERE folder_id IS NOT NULL AND folder_id NOT IN (SELECT id FROM folders)`
	);
	sqlite.exec(
		`UPDATE conversations SET active_leaf_id = NULL
		 WHERE active_leaf_id IS NOT NULL AND active_leaf_id NOT IN (SELECT id FROM messages)`
	);
	sqlite.exec(
		`UPDATE messages SET parent_id = NULL
		 WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM messages)`
	);
}

export function dbPath(): string {
	return DB_PATH;
}

export function now(): string {
	return new Date().toISOString();
}

export function newId(): string {
	return randomUUID();
}

/** Rows come back with snake_case columns; JSON-ish columns stay as strings. */
type Row = Record<string, string | number | Uint8Array | null>;

export function all(sql: string, ...params: unknown[]): Row[] {
	return getDB()
		.sqlite.prepare(sql)
		.all(...(params as never[])) as Row[];
}

export function one(sql: string, ...params: unknown[]): Row | undefined {
	return getDB()
		.sqlite.prepare(sql)
		.get(...(params as never[])) as Row | undefined;
}

export function run(sql: string, ...params: unknown[]): void {
	getDB()
		.sqlite.prepare(sql)
		.run(...(params as never[]));
}

/** How deep inside a transaction of this process the code stands. */
let txDepth = 0;

/** Runs the writes as one unit, so a half written chat cannot stay behind. */
export function tx<T>(fn: () => T): T {
	const sqlite = getDB().sqlite;
	// A write that runs inside another write joins that one, so only the first
	// BEGIN and the last COMMIT touch the database.
	if (txDepth > 0) {
		txDepth++;
		try {
			return fn();
		} catch (err) {
			txDepth--;
			throw err;
		}
	}
	sqlite.exec('BEGIN');
	txDepth = 1;
	try {
		const result = fn();
		sqlite.exec('COMMIT');
		return result;
	} catch (err) {
		sqlite.exec('ROLLBACK');
		throw err;
	} finally {
		txDepth = 0;
	}
}
