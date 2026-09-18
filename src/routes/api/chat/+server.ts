import type { RequestHandler } from './$types';
import { attachResponse } from '$lib/server/attach';
import { bad, body } from '$lib/server/http';
import { isTurnRunning, startTurn } from '$lib/server/hub';
import type { ChatRequest } from '$lib/shared/types';

/**
 * Starts an assistant turn if none is running for the conversation, then streams
 * it. The turn belongs to the server, so closing this connection does not stop
 * the model, and a second client simply watches the same turn.
 */
export const POST = (async ({ request }) => {
	const input = await body<ChatRequest>(request);
	if (!input.conversationId) return bad('conversationId is required');
	if (!isTurnRunning(input.conversationId)) {
		startTurn({
			conversationId: input.conversationId,
			providerId: input.providerId,
			model: input.model,
			continueMessageId: input.continueMessageId
		});
	}
	return attachResponse(request, input.conversationId);
}) satisfies RequestHandler;
