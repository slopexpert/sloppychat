import type { RequestHandler } from './$types';
import { attachResponse } from '$lib/server/attach';
import { bad } from '$lib/server/http';

/** Attaches to a running turn without starting one, for a page that just loaded. */
export const GET = (({ request, url }) => {
	const conversationId = url.searchParams.get('conversationId');
	if (!conversationId) return bad('conversationId is required');
	return attachResponse(request, conversationId);
}) satisfies RequestHandler;
