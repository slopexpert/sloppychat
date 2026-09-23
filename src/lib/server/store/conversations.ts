/** The chat list, the active line of each chat, and the tags and folder of a chat. */

import { all, one, run, tx, newId, now } from '../db';
import { str, num, json, text, type Row } from './rows';
import { type Conversation } from '$lib/shared/types';
import { defaultProvider, getProvider } from './providers';
import { getFolder, normalizeTags } from './folders';

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

/**
 * How many chats one list query returns, the most recently touched first. The
 * sidebar takes the whole result, so the bound keeps one query and one render
 * bounded. A chat past the bound leaves the list until it is touched again, which
 * a local install with far fewer chats never reaches.
 */
export const CONVERSATION_LIMIT = 1000;

export function listConversations(): Conversation[] {
	return all(
		`SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
		 FROM conversations c ORDER BY c.updated_at DESC LIMIT ?`,
		CONVERSATION_LIMIT
	).map(mapConversation);
}

export function getConversation(id: string): Conversation | undefined {
	const row = one('SELECT * FROM conversations WHERE id = ?', id);
	return row ? mapConversation(row) : undefined;
}

export function createConversation(input: Partial<Conversation> = {}): Conversation {
	const id = newId();
	const stamp = now();
	const provider = input.providerId && getProvider(input.providerId) ? undefined : defaultProvider();
	run(
		`INSERT INTO conversations (id, title, provider_id, model, system, params, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		input.title ?? 'New chat',
		(input.providerId && getProvider(input.providerId) && input.providerId) || null,
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
	// A provider or folder that is gone is no provider and no folder, so the chat
	// goes back to the default provider and the plain list.
	const providerId = next.providerId && getProvider(next.providerId) ? next.providerId : null;
	const folderId = next.folderId && getFolder(next.folderId) ? next.folderId : null;
	run(
		`UPDATE conversations SET title = ?, provider_id = ?, model = ?, system = ?, params = ?,
		 folder_id = ?, tags = ?, updated_at = ?
		 WHERE id = ?`,
		next.title,
		providerId,
		next.model ?? null,
		next.system ?? null,
		JSON.stringify(next.params ?? {}),
		folderId,
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
