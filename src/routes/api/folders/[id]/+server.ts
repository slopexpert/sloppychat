import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { deleteFolder, getFolder, renameFolder } from '$lib/server/store';

/** One folder: rename it, or remove it and let its chats back into the list. */
export const PATCH = (async ({ params, request }) => {
	if (!getFolder(params.id)) return bad('Folder not found', 404);
	const input = await body<{ name?: string }>(request);
	const name = (input.name ?? '').trim();
	if (!name) return bad('A folder name is required');
	return Response.json({ folder: renameFolder(params.id, name) });
}) satisfies RequestHandler;

export const DELETE = (async ({ params }) => {
	if (!getFolder(params.id)) return bad('Folder not found', 404);
	return Response.json({ unfiled: deleteFolder(params.id) });
}) satisfies RequestHandler;
