import type { RequestHandler } from './$types';
import { deleteMessage, deleteMessagesFrom } from '$lib/server/store';

/** DELETE removes that message and everything after it, used by edit and retry. */
export const DELETE = (async ({ params, url }) => {
	const cascade = url.searchParams.get('cascade') !== '0';
	if (cascade) {
		return Response.json({ removed: deleteMessagesFrom(params.id, params.messageId) });
	}
	deleteMessage(params.messageId);
	return Response.json({ removed: 1 });
}) satisfies RequestHandler;
