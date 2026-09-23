/** Folders over the chat list, the merge of one chat into another, and the tags. */

import { all, one, run, tx, newId, now } from '../db';
import { str, num, type Row } from './rows';
import { type Conversation, type Folder } from '$lib/shared/types';
import { getConversation } from './conversations';

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
	return tx(() => {
		const chats = all('SELECT id FROM conversations WHERE folder_id = ?', id).length;
		run('UPDATE conversations SET folder_id = NULL WHERE folder_id = ?', id);
		run('DELETE FROM folders WHERE id = ?', id);
		return chats;
	});
}

/** Puts a chat in a folder, or back in the plain list when folderId is null. */
export function moveConversation(id: string, folderId: string | null): Conversation | undefined {
	if (!getConversation(id)) return undefined;
	// A folder the user no longer has cannot hold a chat.
	const held = folderId && getFolder(folderId) ? folderId : null;
	run('UPDATE conversations SET folder_id = ? WHERE id = ?', held, id);
	return getConversation(id);
}

/**
 * Makes a folder that holds the chat that was dragged and the one it was dropped
 * on, which is how a folder is made without a dialog.
 */
export function mergeIntoFolder(chatId: string, ontoChatId: string): Folder | undefined {
	return tx(() => {
		const dragged = getConversation(chatId);
		const target = getConversation(ontoChatId);
		if (!dragged || !target || dragged.id === target.id) return undefined;
		const folder = target.folderId ? getFolder(target.folderId) : createFolder(target.title);
		if (!folder) return undefined;
		run('UPDATE conversations SET folder_id = ? WHERE id IN (?, ?)', folder.id, dragged.id, target.id);
		return folder;
	});
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
