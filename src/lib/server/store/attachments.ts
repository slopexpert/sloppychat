/** Uploaded images and documents, kept as their own rows so a message can point at them. */

import { one, run, runChanges, now } from '../db';
import { str, text } from './rows';

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

/** Attachment lists are JSON columns, so one id shows up as text inside them. */
function attachmentInUse(column: 'images' | 'documents', id: string): boolean {
	const like = `%"${id}"%`;
	for (const table of ['messages', 'queued_messages']) {
		if (one(`SELECT 1 AS hit FROM ${table} WHERE ${column} LIKE ?`, like)) return true;
	}
	return false;
}

/**
 * Drops an uploaded image. A row that a stored or queued message still names is
 * kept, so a stale tab cannot empty a chat the user already sent.
 */
export function deleteImage(id: string): boolean {
	if (attachmentInUse('images', id)) return false;
	return runChanges('DELETE FROM images WHERE id = ?', id) > 0;
}

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

export function getDocument(
	id: string
): { id: string; name: string; mime: string; pages: number; text: string } | undefined {
	const row = one('SELECT id, name, mime, pages, text FROM documents WHERE id = ?', id);
	if (!row) return undefined;
	return {
		id: str(row.id),
		name: str(row.name, 'document'),
		mime: str(row.mime, 'application/pdf'),
		pages: typeof row.pages === 'number' ? row.pages : 0,
		text: str(row.text)
	};
}

/**
 * Drops an uploaded attachment. The page images of a PDF are separate rows, and
 * the caller that holds their ids drops them.
 */
export function deleteDocument(id: string): boolean {
	if (attachmentInUse('documents', id)) return false;
	return runChanges('DELETE FROM documents WHERE id = ?', id) > 0;
}
