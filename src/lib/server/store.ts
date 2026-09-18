import { all, newId, now, one, run, tx } from './db';
import { DEFAULT_PARAMS, DEFAULT_SETTINGS, type Conversation, type Message, type Provider, type Settings } from '$lib/shared/types';
import { migrateToolModes } from '$lib/shared/tools';
import type { Skill } from '$lib/shared/skills';

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
		`UPDATE conversations SET title = ?, provider_id = ?, model = ?, system = ?, params = ?, updated_at = ?
		 WHERE id = ?`,
		next.title,
		next.providerId ?? null,
		next.model ?? null,
		next.system ?? null,
		JSON.stringify(next.params ?? {}),
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
		isError: row.is_error === 1,
		model: text(row.model) ?? undefined,
		usage: row.usage ? json<Message['usage']>(row.usage, undefined) : undefined,
		createdAt: str(row.created_at)
	};
}

export function listMessages(conversationId: string): Message[] {
	return all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq', conversationId).map(mapMessage);
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
	const seqRow = one('SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE conversation_id = ?', input.conversationId);
	const seq = typeof seqRow?.seq === 'number' ? seqRow.seq + 1 : 1;
	run(
		`INSERT INTO messages (id, conversation_id, seq, role, text, reasoning, images, documents, tool_calls,
		 tool_call_id, tool_name, is_error, model, usage, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
		id,
		input.conversationId,
		seq,
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
	touchConversation(input.conversationId);
	return getMessage(id)!;
}

/** Fills in a streaming assistant row once the turn is over. */
export function finalizeMessage(
	id: string,
	patch: { text?: string; reasoning?: string; toolCalls?: Message['toolCalls']; usage?: Message['usage'] }
): Message | undefined {
	const current = getMessage(id);
	if (!current) return undefined;
	const merged = {
		text: patch.text ?? current.text,
		reasoning: patch.reasoning ?? current.reasoning,
		toolCalls: patch.toolCalls ?? current.toolCalls,
		usage: patch.usage ?? current.usage
	};
	run('UPDATE messages SET text = ?, reasoning = ?, tool_calls = ?, usage = ? WHERE id = ?',
		merged.text, merged.reasoning ?? null, merged.toolCalls ? JSON.stringify(merged.toolCalls) : null,
		merged.usage ? JSON.stringify(merged.usage) : null, id);
	return getMessage(id);
}

export function deleteMessagesFrom(conversationId: string, seqOfMessageId: string): number {
	const row = one('SELECT seq FROM messages WHERE id = ? AND conversation_id = ?', seqOfMessageId, conversationId);
	if (typeof row?.seq !== 'number') return 0;
	const result = one('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND seq >= ?', conversationId, row.seq);
	run('DELETE FROM messages WHERE conversation_id = ? AND seq >= ?', conversationId, row.seq);
	touchConversation(conversationId);
	return typeof result?.n === 'number' ? result.n : 0;
}

export function deleteMessage(id: string): void {
	const msg = getMessage(id);
	if (!msg) return;
	run('DELETE FROM messages WHERE id = ?', id);
	touchConversation(msg.conversationId);
}
