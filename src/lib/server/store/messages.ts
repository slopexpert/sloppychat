/** The message rows, their branch, and the round of a turn that finishes them. */

import { all, one, run, tx, newId, now } from '../db';
import { str, json, text, type Row } from './rows';
import { type Message } from '$lib/shared/types';
import { getConversation, touchConversation } from './conversations';

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
	return tx(() => {
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
	});
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
	return tx(() => {
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
	});
}
