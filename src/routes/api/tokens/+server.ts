import type { RequestHandler } from './$types';
import { promptTokenCount } from '$lib/server/bridge';
import { bad, body } from '$lib/server/http';
import { getConversation } from '$lib/server/store';

/**
 * The exact prompt count of a conversation, for the context gauge. A provider
 * that cannot count returns null, and the client keeps its estimate.
 */
export const POST = (async ({ request }) => {
	const input = await body<{ conversationId?: string }>(request);
	if (!input.conversationId) return bad('conversationId is required');
	if (!getConversation(input.conversationId)) return bad('Conversation not found', 404);
	const prompt = await promptTokenCount(input.conversationId);
	return Response.json({ prompt: prompt ?? null, exact: prompt !== undefined });
}) satisfies RequestHandler;
