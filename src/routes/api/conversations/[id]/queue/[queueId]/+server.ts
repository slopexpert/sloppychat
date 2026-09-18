import type { RequestHandler } from './$types';
import { bad } from '$lib/server/http';
import { deleteQueued } from '$lib/server/store';

/** Removes one message that waits for the turn in flight. */
export const DELETE = (async ({ params }) => {
	const removed = deleteQueued(params.id, params.queueId);
	if (!removed) return bad('Queued message not found', 404);
	return Response.json({ ok: true });
}) satisfies RequestHandler;
