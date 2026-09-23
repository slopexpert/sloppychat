/** The messages that arrived while a turn was still answering. */

import { all, one, run, tx, newId, now } from '../db';
import { str, json, text, type Row } from './rows';
import { type QueuedMessage } from '$lib/shared/types';

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
	return tx(() => {
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
	});
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
	return tx(() => {
		const row = one(
			'SELECT * FROM queued_messages WHERE conversation_id = ? ORDER BY seq LIMIT 1',
			conversationId
		);
		if (!row) return undefined;
		const queued = mapQueued(row);
		run('DELETE FROM queued_messages WHERE id = ?', queued.id);
		return queued;
	});
}

/** Empties the queue of a conversation, and says how many messages were dropped. */
export function clearQueued(conversationId: string): number {
	const count = listQueued(conversationId).length;
	run('DELETE FROM queued_messages WHERE conversation_id = ?', conversationId);
	return count;
}
