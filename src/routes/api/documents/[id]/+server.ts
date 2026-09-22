import type { RequestHandler } from './$types';
import { bad } from '$lib/server/http';
import { deleteDocument, getDocument } from '$lib/server/store';
import { countLines } from '$lib/shared/files';

/**
 * The stored text of one attachment, so a chat can be read back without the
 * original file. The body is cut for the screen: a whole manual is not useful in
 * a bubble, and the row keeps the true character count either way.
 */

const MAX_VIEW_CHARS = 20000;

export const GET = (({ params }) => {
	const stored = getDocument(params.id);
	if (!stored) return bad('Attachment not found', 404);
	return Response.json({
		document: {
			id: stored.id,
			name: stored.name,
			mime: stored.mime,
			pages: stored.pages,
			lines: countLines(stored.text),
			chars: stored.text.length,
			text: stored.text.slice(0, MAX_VIEW_CHARS),
			truncated: stored.text.length > MAX_VIEW_CHARS
		}
	});
}) satisfies RequestHandler;

/** Drops an attachment the user removed before sending, so its text does not linger. */
export const DELETE = (({ params }) => {
	if (!getDocument(params.id)) return bad('Attachment not found', 404);
	return Response.json({ ok: true, dropped: deleteDocument(params.id) });
}) satisfies RequestHandler;
