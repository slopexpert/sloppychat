import type { RequestHandler } from './$types';
import { body } from '$lib/server/http';
import { createConversation, listConversations } from '$lib/server/store';
import type { Conversation } from '$lib/shared/types';

export const GET = (() => {
	return Response.json({ conversations: listConversations() });
}) satisfies RequestHandler;

export const POST = (async ({ request }) => {
	const input = await body<Partial<Conversation>>(request);
	const conversation = createConversation({
		title: input.title?.trim() || undefined,
		providerId: input.providerId ?? undefined,
		model: input.model ?? undefined,
		system: input.system ?? undefined
	});
	return Response.json({ conversation }, { status: 201 });
}) satisfies RequestHandler;
