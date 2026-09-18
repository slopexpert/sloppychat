import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { clearActiveLeaf, getConversation, listMessages, setActiveLeaf, viewBranch } from '$lib/server/store';

/**
 * Moves the reader to another branch. `exact` puts the line on the message
 * itself, which is what Retry and Edit do before they make a brother; without
 * it the line follows the newest message below the one given, which is what the
 * 1/3 control shows. A null messageId starts a new first message.
 */
export const POST = (async ({ params, request }) => {
	const conversation = getConversation(params.id);
	if (!conversation) return bad('Conversation not found', 404);
	const input = await body<{ messageId?: string | null; exact?: boolean }>(request);
	if (input.messageId === null) {
		clearActiveLeaf(params.id);
		return Response.json({ conversation: getConversation(params.id), messages: listMessages(params.id) });
	}
	if (!input.messageId) return bad('messageId is required');
	const leaf = input.exact
		? setActiveLeaf(params.id, input.messageId)
		: viewBranch(params.id, input.messageId);
	if (!leaf) return bad('Message not found', 404);
	return Response.json({ conversation: getConversation(params.id), messages: listMessages(params.id) });
}) satisfies RequestHandler;
