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

CREATE TABLE IF NOT EXISTS conversations (
	id          TEXT PRIMARY KEY,
	title       TEXT NOT NULL DEFAULT 'New chat',
	provider_id TEXT,
	model       TEXT,
	system      TEXT,
	params      TEXT NOT NULL DEFAULT '{}',
	created_at  TEXT NOT NULL,
	updated_at  TEXT NOT NULL
);

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
	created_at      TEXT NOT NULL
);
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
		sqlite.exec('CREATE INDEX IF NOT EXISTS messages_parent ON messages(parent_id)');
	}
	if (!columns.some((column) => column.name === 'active_leaf_id')) {
		sqlite.exec('ALTER TABLE conversations ADD COLUMN active_leaf_id TEXT');
		sqlite.exec(
			`UPDATE conversations SET active_leaf_id = (
				SELECT id FROM messages WHERE messages.conversation_id = conversations.id ORDER BY seq DESC LIMIT 1
			)`
		);
	}
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

export function tx(fn: () => void): void {
	const sqlite = getDB().sqlite;
	sqlite.exec('BEGIN');
	try {
		fn();
		sqlite.exec('COMMIT');
	} catch (err) {
		sqlite.exec('ROLLBACK');
		throw err;
	}
}
