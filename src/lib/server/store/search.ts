/** Full text search over the chat titles and the message text. */

import { all, one } from '../db';
import { str, text } from './rows';
import { type ChatHit } from '$lib/shared/types';
import { getConversation } from './conversations';

/** The words of a search, quoted so FTS5 reads them as text and not as syntax. */
function ftsQuery(text: string): string {
	return (text.match(/[^\s"]+/g) ?? [])
		.slice(0, 8)
		.map((word) => `"${word.replace(/"/g, '')}"`)
		.join(' ');
}

/** How many chats one search returns when the caller asked for nothing. */
export const DEFAULT_SEARCH_HITS = 30;

/** How many chats one search may return, however the caller asked. */
const MAX_SEARCH_HITS = 100;

/**
 * Brings a requested number of hits into the range the app can show. The number can
 * come from an address bar, so a negative one would cut the end off the list and a
 * missing one would ask for the whole database.
 */
function clampLimit(limit: number): number {
	if (!Number.isFinite(limit)) return DEFAULT_SEARCH_HITS;
	return Math.max(1, Math.min(MAX_SEARCH_HITS, Math.trunc(limit)));
}

/** The chats whose title or messages match, best first, with one line each. */
export function searchChats(text: string, limit = DEFAULT_SEARCH_HITS): ChatHit[] {
	const wanted = clampLimit(limit);
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
	return [...hits.values()].slice(0, wanted);
}
