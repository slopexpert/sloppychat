import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { pendingApproval, resolveApproval } from '$lib/server/approvals';
import { getSettings, saveSettings } from '$lib/server/store';

/**
 * Answers the tool request that holds a turn, because the tool mode is ask
 * first. Always allow also saves the choice, so the tool runs without a question
 * from now on.
 */

export const POST = (async ({ request }) => {
	const input = await body<{
		conversationId?: string;
		toolCallId?: string;
		decision?: 'allow' | 'deny';
		always?: boolean;
	}>(request);
	if (!input.conversationId || !input.toolCallId) {
		return bad('conversationId and toolCallId are required');
	}
	if (input.decision !== 'allow' && input.decision !== 'deny') {
		return bad('decision must be allow or deny');
	}

	const call = pendingApproval(input.conversationId);
	if (input.decision === 'allow' && input.always && call) {
		const settings = getSettings();
		saveSettings({
			tools: { ...settings.tools, modes: { ...settings.tools.modes, [call.name]: 'on' } }
		});
	}

	const answered = resolveApproval(input.conversationId, input.toolCallId, input.decision);
	return Response.json({ answered });
}) satisfies RequestHandler;
