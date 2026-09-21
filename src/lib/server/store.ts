import { all, newId, now, one, run, tx } from './db';
import { DEFAULT_PARAMS, DEFAULT_SETTINGS, type ChatHit, type Conversation, type Folder, type McpServer, type McpServerConfig, type Message, type Provider, type QueuedMessage, type Settings } from '$lib/shared/types';
import { migrateToolModes } from '$lib/shared/tools';
import type { Skill } from '$lib/shared/skills';
import { promptDescription, promptTitle, type PromptEntry, type PromptKind } from '$lib/shared/prompts';

/** Typed helpers over the raw sql in db.ts. Rows are mapped to shared types here. */

type Row = Record<string, unknown>;

function str(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}

function num(v: unknown): number | undefined {
	return typeof v === 'number' ? v : undefined;
}

function json<T>(v: unknown, fallback: T): T {
	if (typeof v !== 'string' || !v) return fallback;
	try {
		return JSON.parse(v) as T;
	} catch {
		return fallback;
	}
}

function text(v: unknown): string | null {
	return typeof v === 'string' ? v : null;
}

/* ------------------------------------------------------------------ providers */

export function mapProvider(row: Row): Provider {
	return {
		id: str(row.id),
		name: str(row.name),
		baseUrl: str(row.base_url).replace(/\/+$/, ''),
		apiKey: str(row.api_key),
		kind: 'openai',
		defaultModel: text(row.default_model),
		enabled: row.enabled === 1,
		sort: typeof row.sort === 'number' ? row.sort : 0,
		createdAt: str(row.created_at)
	};
}

export function listProviders(): Provider[] {
	return all('SELECT * FROM providers ORDER BY sort, name').map(mapProvider);
}

export function getProvider(id: string): Provider | undefined {
	const row = one('SELECT * FROM providers WHERE id = ?', id);
	return row ? mapProvider(row) : undefined;
}

/** First enabled provider, used when a conversation has no explicit pick. */
export function defaultProvider(): Provider | undefined {
	const settings = getSettings();
	if (settings.defaults.providerId) {
		const picked = getProvider(settings.defaults.providerId);
		if (picked?.enabled) return picked;
	}
	return listProviders().find((p) => p.enabled);
}

export function createProvider(input: Partial<Provider> & { name: string; baseUrl: string }): Provider {
	const id = newId();
	const sort = listProviders().length;
	run(
		`INSERT INTO providers (id, name, base_url, api_key, kind, default_model, enabled, sort, created_at)
		 VALUES (?, ?, ?, ?, 'openai', ?, ?, ?, ?)`,
		id,
		input.name,
		input.baseUrl.replace(/\/+$/, ''),
		input.apiKey ?? '',
		input.defaultModel ?? null,
		input.enabled === false ? 0 : 1,
		input.sort ?? sort,
		now()
	);
	return getProvider(id)!;
}

export function updateProvider(id: string, patch: Partial<Provider>): Provider | undefined {
	const current = getProvider(id);
	if (!current) return undefined;
	const next = { ...current, ...patch };
	run(
		`UPDATE providers SET name = ?, base_url = ?, kind = 'openai', default_model = ?, enabled = ?, sort = ?,
		 api_key = ? WHERE id = ?`,
		next.name,
		next.baseUrl.replace(/\/+$/, ''),
		next.defaultModel ?? null,
		next.enabled ? 1 : 0,
		next.sort,
		patch.apiKey === undefined ? current.apiKey : patch.apiKey,
		id
	);
	return getProvider(id);
}

export function deleteProvider(id: string): void {
	run('DELETE FROM providers WHERE id = ?', id);
	run('UPDATE conversations SET provider_id = NULL WHERE provider_id = ?', id);
}

/* ------------------------------------------------------------------ settings */

export function getSettings(): Settings {
	const row = one('SELECT data FROM settings WHERE id = 1');
	const saved = json<Partial<Settings>>(row?.data, {});
	return {
		theme: { ...DEFAULT_SETTINGS.theme, ...saved.theme },
		search: { ...DEFAULT_SETTINGS.search, ...saved.search },
		generation: { ...DEFAULT_PARAMS, ...saved.generation },
		tools: normalizeTools(saved.tools),
		defaults: { ...DEFAULT_SETTINGS.defaults, ...saved.defaults }
	};
}

/**
 * The tools keep one mode per tool. Older rows hold a boolean per web tool, and
 * this function turns those booleans into modes, so an upgrade keeps the choice.
 * The old keys fall away on the next save.
 */
function normalizeTools(
	saved?: Partial<Settings['tools']> & { webSearch?: boolean; webFetch?: boolean }
): Settings['tools'] {
	const { webSearch, webFetch, ...rest } = saved ?? {};
	return {
		...DEFAULT_SETTINGS.tools,
		...rest,
		modes: migrateToolModes({ modes: rest.modes, webSearch, webFetch })
	};
}

export function saveSettings(patch: Partial<Settings>): Settings {
	const next = {
		...getSettings(),
		...patch,
		theme: { ...getSettings().theme, ...patch.theme },
		search: { ...getSettings().search, ...patch.search },
		generation: { ...getSettings().generation, ...patch.generation },
		tools: normalizeTools({ ...getSettings().tools, ...patch.tools }),
		defaults: { ...getSettings().defaults, ...patch.defaults }
	};
	run(
		`INSERT INTO settings (id, data) VALUES (1, ?)
		 ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
		JSON.stringify(next)
	);
	return next;
}

/* -------------------------------------------------------------- conversations */

function mapConversation(row: Row): Conversation {
	return {
		id: str(row.id),
		title: str(row.title),
		providerId: text(row.provider_id),
		model: text(row.model),
		system: text(row.system),
		params: json<Conversation['params']>(row.params, {}),
		activeLeafId: text(row.active_leaf_id),
		folderId: text(row.folder_id),
		tags: json<string[]>(row.tags, []),
		createdAt: str(row.created_at),
		updatedAt: str(row.updated_at),
		messageCount: num(row.message_count)
	};
}

export function listConversations(): Conversation[] {
	return all(
		`SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
		 FROM conversations c ORDER BY c.updated_at DESC LIMIT 500`
	).map(mapConversation);
}

export function getConversation(id: string): Conversation | undefined {
	const row = one('SELECT * FROM conversations WHERE id = ?', id);
	return row ? mapConversation(row) : undefined;
}

export function createConversation(input: Partial<Conversation> = {}): Conversation {
	const id = newId();
	const stamp = now();
	const provider = input.providerId ? undefined : defaultProvider();
	run(
		`INSERT INTO conversations (id, title, provider_id, model, system, params, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		input.title ?? 'New chat',
		input.providerId ?? provider?.id ?? null,
		input.model ?? provider?.defaultModel ?? null,
		input.system ?? null,
		JSON.stringify(input.params ?? {}),
		stamp,
		stamp
	);
	return getConversation(id)!;
}

export function updateConversation(id: string, patch: Partial<Conversation>): Conversation | undefined {
	const current = getConversation(id);
	if (!current) return undefined;
	const next = { ...current, ...patch };
	run(
		`UPDATE conversations SET title = ?, provider_id = ?, model = ?, system = ?, params = ?,
		 folder_id = ?, tags = ?, updated_at = ?
		 WHERE id = ?`,
		next.title,
		next.providerId ?? null,
		next.model ?? null,
		next.system ?? null,
		JSON.stringify(next.params ?? {}),
		next.folderId ?? null,
		JSON.stringify(normalizeTags(next.tags ?? [])),
		now(),
		id
	);
	return getConversation(id);
}

export function touchConversation(id: string): void {
	run('UPDATE conversations SET updated_at = ? WHERE id = ?', now(), id);
}

export function deleteConversation(id: string): void {
	tx(() => {
		run('DELETE FROM messages WHERE conversation_id = ?', id);
		run('DELETE FROM conversations WHERE id = ?', id);
	});
}

/** Use the first user line as the title until the user renames the chat. */
export function maybeTitleFromFirstMessage(conversationId: string, textContent: string): void {
	const conv = getConversation(conversationId);
	if (!conv || conv.title !== 'New chat') return;
	const title = textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
	if (!title) return;
	run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', title, now(), conversationId);
}

/* -------------------------------------------------------------------- images */

export function saveImage(id: string, mime: string, blob: Uint8Array): void {
	run('INSERT OR REPLACE INTO images (id, mime, blob, bytes, created_at) VALUES (?, ?, ?, ?, ?)', id, mime, blob, blob.byteLength, now());
}

export function getImage(id: string): { mime: string; blob: Uint8Array } | undefined {
	const row = one('SELECT mime, blob FROM images WHERE id = ?', id);
	if (!row) return undefined;
	const blob = row.blob;
	if (!(blob instanceof Uint8Array)) return undefined;
	return { mime: str(row.mime, 'application/octet-stream'), blob };
}

/* ----------------------------------------------------------------- documents */

export function saveDocument(id: string, name: string, mime: string, pages: number, textContent: string): void {
	run(
		`INSERT OR REPLACE INTO documents (id, name, mime, pages, text, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		id,
		name,
		mime,
		pages,
		textContent,
		now()
	);
}

export function getDocument(id: string): { id: string; name: string; pages: number; text: string } | undefined {
	const row = one('SELECT id, name, pages, text FROM documents WHERE id = ?', id);
	if (!row) return undefined;
	return {
		id: str(row.id),
		name: str(row.name, 'document'),
		pages: typeof row.pages === 'number' ? row.pages : 0,
		text: str(row.text)
	};
}

/* ----------------------------------------------------------- the queue --- */

function mapQueued(row: Row): QueuedMessage {
	return {
		id: str(row.id),
		text: str(row.text),
		images: json(row.images, []),
		documents: json(row.documents, [])
	};
}

/** The messages that wait for the turn in flight, oldest first. */
export function listQueued(conversationId: string): QueuedMessage[] {
	return all('SELECT * FROM queued_messages WHERE conversation_id = ? ORDER BY seq', conversationId).map(
		mapQueued
	);
}

export function queueMessage(input: {
	conversationId: string;
	text: string;
	images?: QueuedMessage['images'];
	documents?: QueuedMessage['documents'];
}): QueuedMessage {
	const id = newId();
	const seqRow = one(
		'SELECT COALESCE(MAX(seq), 0) AS seq FROM queued_messages WHERE conversation_id = ?',
		input.conversationId
	);
	const seq = typeof seqRow?.seq === 'number' ? seqRow.seq + 1 : 1;
	run(
		`INSERT INTO queued_messages (id, conversation_id, seq, text, images, documents, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id,
		input.conversationId,
		seq,
		input.text,
		JSON.stringify(input.images ?? []),
		JSON.stringify(input.documents ?? []),
		now()
	);
	return {
		id,
		text: input.text,
		images: input.images ?? [],
		documents: input.documents ?? []
	};
}

/** Drops one waiting message. False means the row was not there. */
export function deleteQueued(conversationId: string, id: string): boolean {
	const row = one('SELECT id FROM queued_messages WHERE conversation_id = ? AND id = ?', conversationId, id);
	if (!row) return false;
	run('DELETE FROM queued_messages WHERE conversation_id = ? AND id = ?', conversationId, id);
	return true;
}

/** Takes the oldest waiting message out of the queue, or nothing when it is empty. */
export function takeQueued(conversationId: string): QueuedMessage | undefined {
	const row = one(
		'SELECT * FROM queued_messages WHERE conversation_id = ? ORDER BY seq LIMIT 1',
		conversationId
	);
	if (!row) return undefined;
	const queued = mapQueued(row);
	run('DELETE FROM queued_messages WHERE id = ?', queued.id);
	return queued;
}

/** Empties the queue of a conversation, and says how many messages were dropped. */
export function clearQueued(conversationId: string): number {
	const count = listQueued(conversationId).length;
	run('DELETE FROM queued_messages WHERE conversation_id = ?', conversationId);
	return count;
}

/* ------------------------------------------------------------ the folders -- */

function mapFolder(row: Row): Folder {
	return {
		id: str(row.id),
		name: str(row.name, 'Folder'),
		sort: num(row.sort) ?? 0,
		createdAt: str(row.created_at)
	};
}

export function listFolders(): Folder[] {
	return all('SELECT * FROM folders ORDER BY sort, name COLLATE NOCASE').map(mapFolder);
}

export function getFolder(id: string): Folder | undefined {
	const row = one('SELECT * FROM folders WHERE id = ?', id);
	return row ? mapFolder(row) : undefined;
}

export function createFolder(name: string): Folder {
	const id = newId();
	const sortRow = one('SELECT COALESCE(MAX(sort), 0) AS sort FROM folders');
	const sort = typeof sortRow?.sort === 'number' ? sortRow.sort + 1 : 1;
	run(
		'INSERT INTO folders (id, name, sort, created_at) VALUES (?, ?, ?, ?)',
		id,
		name.trim().slice(0, 60) || 'Folder',
		sort,
		now()
	);
	return getFolder(id)!;
}

export function renameFolder(id: string, name: string): Folder | undefined {
	const current = getFolder(id);
	if (!current) return undefined;
	run('UPDATE folders SET name = ? WHERE id = ?', name.trim().slice(0, 60) || current.name, id);
	return getFolder(id);
}

/** Removes a folder. Its chats stay, and go back to the plain list. */
export function deleteFolder(id: string): number {
	const chats = all('SELECT id FROM conversations WHERE folder_id = ?', id).length;
	run('UPDATE conversations SET folder_id = NULL WHERE folder_id = ?', id);
	run('DELETE FROM folders WHERE id = ?', id);
	return chats;
}

/** Puts a chat in a folder, or back in the plain list when folderId is null. */
export function moveConversation(id: string, folderId: string | null): Conversation | undefined {
	if (!getConversation(id)) return undefined;
	run('UPDATE conversations SET folder_id = ? WHERE id = ?', folderId, id);
	return getConversation(id);
}

/**
 * Makes a folder that holds the chat that was dragged and the one it was dropped
 * on, which is how a folder is made without a dialog.
 */
export function mergeIntoFolder(chatId: string, ontoChatId: string): Folder | undefined {
	const dragged = getConversation(chatId);
	const target = getConversation(ontoChatId);
	if (!dragged || !target || dragged.id === target.id) return undefined;
	const folder = target.folderId ? getFolder(target.folderId) : createFolder(target.title);
	if (!folder) return undefined;
	run('UPDATE conversations SET folder_id = ? WHERE id IN (?, ?)', folder.id, dragged.id, target.id);
	return folder;
}

export function setTags(id: string, tags: string[]): Conversation | undefined {
	if (!getConversation(id)) return undefined;
	run('UPDATE conversations SET tags = ? WHERE id = ?', JSON.stringify(normalizeTags(tags)), id);
	return getConversation(id);
}

/** Tags are lower case, without duplicates, and short. */
export function normalizeTags(tags: string[]): string[] {
	const seen = new Set<string>();
	for (const tag of tags) {
		const clean = tag.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 24);
		if (clean) seen.add(clean);
	}
	return [...seen];
}

/* ------------------------------------------------------------- the search -- */

/** The words of a search, quoted so FTS5 reads them as text and not as syntax. */
function ftsQuery(text: string): string {
	return (text.match(/[^\s"]+/g) ?? [])
		.slice(0, 8)
		.map((word) => `"${word.replace(/"/g, '')}"`)
		.join(' ');
}

/** The chats whose title or messages match, best first, with one line each. */
export function searchChats(text: string, limit = 30): ChatHit[] {
	const query = ftsQuery(text);
	if (!query) return [];
	const hits = new Map<string, ChatHit>();
	for (const row of all(
		`SELECT m.conversation_id AS conversation_id, m.id AS message_id,
		        snippet(messages_fts, 0, '[', ']', ' ... ', 14) AS snippet
		 FROM messages_fts
		 JOIN messages m ON m.rowid = messages_fts.rowid
		 WHERE messages_fts MATCH ?
		 ORDER BY bm25(messages_fts)
		 LIMIT 200`,
		query
	)) {
		const conversationId = str(row.conversation_id);
		const existing = hits.get(conversationId);
		if (existing) {
			existing.hits += 1;
			continue;
		}
		const conversation = getConversation(conversationId);
		if (!conversation) continue;
		hits.set(conversationId, {
			conversationId,
			title: conversation.title,
			updatedAt: conversation.updatedAt,
			messageId: str(row.message_id),
			snippet: str(row.snippet),
			hits: 1
		});
	}
	for (const row of all(
		`SELECT c.id AS conversation_id, c.title, c.updated_at
		 FROM chats_fts JOIN conversations c ON c.rowid = chats_fts.rowid
		 WHERE chats_fts MATCH ?
		 ORDER BY bm25(chats_fts)
		 LIMIT 20`,
		query
	)) {
		const conversationId = str(row.conversation_id);
		const existing = hits.get(conversationId);
		if (existing) {
			existing.hits += 1;
			continue;
		}
		hits.set(conversationId, {
			conversationId,
			title: str(row.title),
			updatedAt: str(row.updated_at),
			snippet: 'The title matches',
			hits: 1
		});
	}
	return [...hits.values()].slice(0, limit);
}

/* ---------------------------------------------------------------- mcp ----- */

function mapMcpServer(row: Row): McpServer {
	return {
		id: str(row.id),
		name: str(row.name, 'server'),
		enabled: row.enabled === 1,
		config: json<McpServerConfig>(row.config, { transport: 'stdio' }),
		createdAt: str(row.created_at),
		updatedAt: str(row.updated_at)
	};
}

export function listMcpServers(): McpServer[] {
	return all('SELECT * FROM mcp_servers ORDER BY name COLLATE NOCASE').map(mapMcpServer);
}

export function getMcpServer(id: string): McpServer | undefined {
	const row = one('SELECT * FROM mcp_servers WHERE id = ?', id);
	return row ? mapMcpServer(row) : undefined;
}

export function createMcpServer(input: { name: string; config: McpServerConfig; enabled?: boolean }): McpServer {
	const id = newId();
	const stamp = now();
	run(
		'INSERT INTO mcp_servers (id, name, enabled, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
		id,
		input.name,
		input.enabled === false ? 0 : 1,
		JSON.stringify(input.config),
		stamp,
		stamp
	);
	return getMcpServer(id)!;
}

export function updateMcpServer(
	id: string,
	patch: { name?: string; enabled?: boolean; config?: McpServerConfig }
): McpServer | undefined {
	const current = getMcpServer(id);
	if (!current) return undefined;
	run(
		'UPDATE mcp_servers SET name = ?, enabled = ?, config = ?, updated_at = ? WHERE id = ?',
		patch.name ?? current.name,
		(patch.enabled ?? current.enabled) ? 1 : 0,
		JSON.stringify(patch.config ?? current.config),
		now(),
		id
	);
	return getMcpServer(id);
}

export function deleteMcpServer(id: string): void {
	run('DELETE FROM mcp_servers WHERE id = ?', id);
}

/* --------------------------------------------------------------------- skills */

function mapSkill(row: Row): Skill {
	return {
		id: str(row.id),
		name: str(row.name, 'skill'),
		description: str(row.description),
		body: str(row.body),
		enabled: row.enabled === 1,
		createdAt: str(row.created_at),
		updatedAt: str(row.updated_at)
	};
}

export function listSkills(): Skill[] {
	return all('SELECT * FROM skills ORDER BY name').map(mapSkill);
}

export function getSkill(id: string): Skill | undefined {
	const row = one('SELECT * FROM skills WHERE id = ?', id);
	return row ? mapSkill(row) : undefined;
}

export function getSkillByName(name: string): Skill | undefined {
	const row = one('SELECT * FROM skills WHERE name = ?', name);
	return row ? mapSkill(row) : undefined;
}

/** Reads the skills the model should be told about. */
export function enabledSkills(): Skill[] {
	return all('SELECT * FROM skills WHERE enabled = 1 ORDER BY name').map(mapSkill);
}

/** Creates a skill, or replaces the one with the same name. */
export function saveSkill(input: {
	id?: string;
	name: string;
	description?: string;
	body?: string;
	enabled?: boolean;
}): Skill {
	const existing = getSkillByName(input.name);
	const id = input.id ?? existing?.id ?? newId();
	const stamp = now();
	if (existing?.id && existing.id !== id) run('DELETE FROM skills WHERE id = ?', existing.id);
	run(
		`INSERT INTO skills (id, name, description, body, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
		 body = excluded.body, enabled = excluded.enabled, updated_at = excluded.updated_at`,
		id,
		input.name,
		input.description ?? existing?.description ?? '',
		input.body ?? existing?.body ?? '',
		(input.enabled ?? existing?.enabled ?? true) ? 1 : 0,
		existing?.createdAt ?? stamp,
		stamp
	);
	return getSkill(id)!;
}

export function deleteSkill(id: string): void {
	run('DELETE FROM skills WHERE id = ?', id);
}

/* -------------------------------------------------------------------- prompts */

function mapPrompt(row: Row): PromptEntry {
	return {
		id: str(row.id),
		title: str(row.title, 'prompt'),
		description: str(row.description),
		body: str(row.body),
		kind: row.kind === 'system' ? 'system' : 'user',
		sort: typeof row.sort === 'number' ? row.sort : 0,
		createdAt: str(row.created_at),
		updatedAt: str(row.updated_at)
	};
}

export function listPrompts(kind?: PromptKind): PromptEntry[] {
	const rows = kind
		? all('SELECT * FROM prompts WHERE kind = ? ORDER BY sort, title', kind)
		: all('SELECT * FROM prompts ORDER BY sort, title');
	return rows.map(mapPrompt);
}

export function getPrompt(id: string): PromptEntry | undefined {
	const row = one('SELECT * FROM prompts WHERE id = ?', id);
	return row ? mapPrompt(row) : undefined;
}

/** Creates a prompt, or updates the one with the same id. */
export function savePrompt(input: {
	id?: string;
	title: string;
	description?: string;
	body?: string;
	kind?: PromptKind;
	sort?: number;
}): PromptEntry {
	const existing = input.id ? getPrompt(input.id) : undefined;
	const id = input.id ?? newId();
	const stamp = now();
	run(
		`INSERT INTO prompts (id, title, description, body, kind, sort, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description,
		 body = excluded.body, kind = excluded.kind, sort = excluded.sort, updated_at = excluded.updated_at`,
		id,
		promptTitle(input.title),
		promptDescription(input.description ?? existing?.description ?? ''),
		input.body ?? existing?.body ?? '',
		input.kind ?? existing?.kind ?? 'user',
		input.sort ?? existing?.sort ?? 0,
		existing?.createdAt ?? stamp,
		stamp
	);
	return getPrompt(id)!;
}

export function deletePrompt(id: string): void {
	run('DELETE FROM prompts WHERE id = ?', id);
}

/* ------------------------------------------------------------------- messages */

export function mapMessage(row: Row): Message {
	return {
		id: str(row.id),
		conversationId: str(row.conversation_id),
		role: str(row.role, 'user') as Message['role'],
		text: str(row.text),
		reasoning: text(row.reasoning) ?? undefined,
		images: json(row.images, []),
		documents: json(row.documents, []),
		toolCalls: row.tool_calls ? json<Message['toolCalls']>(row.tool_calls, []) : undefined,
		toolCallId: text(row.tool_call_id) ?? undefined,
		toolName: text(row.tool_name) ?? undefined,
		parentId: text(row.parent_id),
		finishReason: text(row.finish_reason) ?? undefined,
		isError: row.is_error === 1,
		model: text(row.model) ?? undefined,
		usage: row.usage ? json<Message['usage']>(row.usage, undefined) : undefined,
		createdAt: str(row.created_at)
	};
}

/**
 * The messages of a chat as the reader sees them: the line from the first
 * message down to the active leaf. The brothers of each message come with it,
 * which is what the 1/3 control in the view shows.
 */
export function listMessages(conversationId: string): Message[] {
	const conversation = getConversation(conversationId);
	const leaf = conversation?.activeLeafId ?? undefined;
	const path = leaf
		? all(
				`WITH RECURSIVE line(id) AS (
					SELECT id FROM messages WHERE id = ?
					UNION ALL
					SELECT m.parent_id FROM messages m JOIN line l ON m.id = l.id WHERE m.parent_id IS NOT NULL
				)
				SELECT m.* FROM messages m JOIN line l ON m.id = l.id WHERE m.conversation_id = ? ORDER BY m.seq`,
				leaf,
				conversationId
			)
		: [];
	// A leaf that points at nothing, or a chat that never set one: the plain order.
	const rows = path.length ? path : all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq', conversationId);
	const messages = rows.map(mapMessage);

	// The brothers of a message are the messages that share its parent.
	const siblings = new Map<string, string[]>();
	for (const row of all('SELECT id, parent_id FROM messages WHERE conversation_id = ? ORDER BY seq', conversationId)) {
		const parent = text(row.parent_id) ?? '';
		siblings.set(parent, [...(siblings.get(parent) ?? []), str(row.id)]);
	}
	for (const message of messages) {
		message.brothers = siblings.get(message.parentId ?? '') ?? [message.id];
	}
	return messages;
}

export function getMessage(id: string): Message | undefined {
	const row = one('SELECT * FROM messages WHERE id = ?', id);
	return row ? mapMessage(row) : undefined;
}

interface InsertMessage {
	conversationId: string;
	role: Message['role'];
	text?: string;
	reasoning?: string;
	images?: Message['images'];
	documents?: Message['documents'];
	toolCalls?: Message['toolCalls'];
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	model?: string;
}

export function appendMessage(input: InsertMessage): Message {
	const id = newId();
	// A new message hangs off the end of the line the reader is on.
	const parent = getConversation(input.conversationId)?.activeLeafId ?? null;
	const seqRow = one('SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE conversation_id = ?', input.conversationId);
	const seq = typeof seqRow?.seq === 'number' ? seqRow.seq + 1 : 1;
	run(
		`INSERT INTO messages (id, conversation_id, seq, parent_id, role, text, reasoning, images, documents,
		 tool_calls, tool_call_id, tool_name, is_error, model, usage, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
		id,
		input.conversationId,
		seq,
		parent,
		input.role,
		input.text ?? '',
		input.reasoning ?? null,
		JSON.stringify(input.images ?? []),
		JSON.stringify(input.documents ?? []),
		input.toolCalls ? JSON.stringify(input.toolCalls) : null,
		input.toolCallId ?? null,
		input.toolName ?? null,
		input.isError ? 1 : 0,
		input.model ?? null,
		now()
	);
	// The new message is the end of the line now.
	run('UPDATE conversations SET active_leaf_id = ? WHERE id = ?', id, input.conversationId);
	touchConversation(input.conversationId);
	return getMessage(id)!;
}

/**
 * Makes one message the end of the line, so the next message hangs off it.
 * Retry uses this to make a second answer to the same question.
 */
export function setActiveLeaf(conversationId: string, messageId: string): string | undefined {
	const row = one('SELECT id FROM messages WHERE id = ? AND conversation_id = ?', messageId, conversationId);
	const leaf = text(row?.id);
	if (!leaf) return undefined;
	run('UPDATE conversations SET active_leaf_id = ? WHERE id = ?', leaf, conversationId);
	return leaf;
}

/** Starts a new first message: the line is empty until one is made. */
export function clearActiveLeaf(conversationId: string): void {
	run('UPDATE conversations SET active_leaf_id = NULL WHERE id = ?', conversationId);
}

/**
 * Shows the branch that holds a message: the line ends at the newest message
 * below it, or at the message itself when nothing follows it. This is what the
 * 1/3 control uses.
 */
export function viewBranch(conversationId: string, messageId: string): string | undefined {
	const row = one(
		`WITH RECURSIVE down(id, seq) AS (
			SELECT id, seq FROM messages WHERE id = ? AND conversation_id = ?
			UNION ALL
			SELECT m.id, m.seq FROM messages m JOIN down d ON m.parent_id = d.id
			WHERE m.seq = (SELECT MAX(seq) FROM messages WHERE parent_id = d.id)
		)
		SELECT id FROM down ORDER BY seq DESC LIMIT 1`,
		messageId,
		conversationId
	);
	const leaf = text(row?.id);
	if (!leaf) return undefined;
	run('UPDATE conversations SET active_leaf_id = ? WHERE id = ?', leaf, conversationId);
	return leaf;
}

/** Fills in a streaming assistant row once the turn is over. */
export function finalizeMessage(
	id: string,
	patch: {
		text?: string;
		reasoning?: string;
		toolCalls?: Message['toolCalls'];
		usage?: Message['usage'];
		finishReason?: string;
	}
): Message | undefined {
	const current = getMessage(id);
	if (!current) return undefined;
	const merged = {
		text: patch.text ?? current.text,
		reasoning: patch.reasoning ?? current.reasoning,
		toolCalls: patch.toolCalls ?? current.toolCalls,
		usage: patch.usage ?? current.usage,
		finishReason: patch.finishReason ?? current.finishReason
	};
	run('UPDATE messages SET text = ?, reasoning = ?, tool_calls = ?, usage = ?, finish_reason = ? WHERE id = ?',
		merged.text, merged.reasoning ?? null, merged.toolCalls ? JSON.stringify(merged.toolCalls) : null,
		merged.usage ? JSON.stringify(merged.usage) : null, merged.finishReason ?? null, id);
	return getMessage(id);
}

/**
 * Removes a message and everything that hangs below it, and moves the reader to
 * the parent when the line it was on is gone.
 */
export function deleteMessagesFrom(conversationId: string, messageId: string): number {
	const root = one('SELECT id, parent_id FROM messages WHERE id = ? AND conversation_id = ?', messageId, conversationId);
	if (!root) return 0;
	const branch = all(
		`WITH RECURSIVE sub(id) AS (
			SELECT id FROM messages WHERE id = ?
			UNION ALL
			SELECT m.id FROM messages m JOIN sub s ON m.parent_id = s.id
		)
		SELECT id FROM sub`,
		messageId
	).map((row) => str(row.id));
	const conversation = getConversation(conversationId);
	if (conversation?.activeLeafId && branch.includes(conversation.activeLeafId)) {
		run('UPDATE conversations SET active_leaf_id = ? WHERE id = ?', text(root.parent_id), conversationId);
	}
	const placeholders = branch.map(() => '?').join(', ');
	run(`DELETE FROM messages WHERE id IN (${placeholders})`, ...branch);
	touchConversation(conversationId);
	return branch.length;
}

