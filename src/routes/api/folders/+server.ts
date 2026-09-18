import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { createFolder, listFolders } from '$lib/server/store';

/** The groups in the chat list. */
export const GET = (() => {
	return Response.json({ folders: listFolders() });
}) satisfies RequestHandler;

export const POST = (async ({ request }) => {
	const input = await body<{ name?: string }>(request);
	const name = (input.name ?? '').trim();
	if (!name) return bad('A folder name is required');
	return Response.json({ folder: createFolder(name) }, { status: 201 });
}) satisfies RequestHandler;
