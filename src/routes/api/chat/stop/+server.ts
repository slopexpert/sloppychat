import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { stopTurn } from '$lib/server/hub';

/** Stops the turn for a conversation. Nothing else stops it. */
export const POST = (async ({ request }) => {
	const input = await body<{ conversationId?: string }>(request);
	if (!input.conversationId) return bad('conversationId is required');
	return Response.json({ stopped: stopTurn(input.conversationId) });
}) satisfies RequestHandler;
