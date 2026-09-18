import type { RequestHandler } from './$types';
import { deleteMessagesFrom } from '$lib/server/store';

/**
 * DELETE removes that message and everything below it, which is what the Delete
 * action on a message does. With branches a message can have several children,
 * so all of them go.
 */
export const DELETE = (async ({ params }) => {
	return Response.json({ removed: deleteMessagesFrom(params.id, params.messageId) });
}) satisfies RequestHandler;
