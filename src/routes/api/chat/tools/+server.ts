import type { RequestHandler } from './$types';
import { attachResponse } from '$lib/server/attach';
import { bad, body } from '$lib/server/http';
import { isTurnRunning, startToolContinuation } from '$lib/server/hub';
import type { ToolResult } from '$lib/shared/types';

/**
 * Stores browser tool results, then continues the same chain. The continuation
 * is a server side job, so it survives the page that reported the results.
 */
export const POST = (async ({ request }) => {
	const input = await body<{ conversationId?: string; results?: ToolResult[] }>(request);
	if (!input.conversationId) return bad('conversationId is required');
	const results = Array.isArray(input.results) ? input.results : [];
	if (!isTurnRunning(input.conversationId)) {
		startToolContinuation(input.conversationId, results);
	}
	return attachResponse(request, input.conversationId);
}) satisfies RequestHandler;
