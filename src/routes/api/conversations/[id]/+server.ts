import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import {
	deleteConversation,
	getConversation,
	listMessages,
	listQueued,
	updateConversation
} from '$lib/server/store';
import type { Conversation } from '$lib/shared/types';

export const GET = (async ({ params }) => {
	const conversation = getConversation(params.id);
	if (!conversation) return bad('Conversation not found', 404);
	// The queue lives on the server now, so every window sees the same one.
	return Response.json({
		conversation,
		messages: listMessages(params.id),
		queued: listQueued(params.id)
	});
}) satisfies RequestHandler;

export const PATCH = (async ({ params, request }) => {
	if (!getConversation(params.id)) return bad('Conversation not found', 404);
	const patch = await body<Partial<Conversation>>(request);
	const clean: Partial<Conversation> = {};
	if (patch.title !== undefined) clean.title = String(patch.title).trim() || 'New chat';
	if (patch.providerId !== undefined) clean.providerId = patch.providerId || null;
	if (patch.model !== undefined) clean.model = patch.model || null;
	if (patch.system !== undefined) clean.system = patch.system || null;
	if (patch.params !== undefined) clean.params = patch.params ?? {};
	if (patch.folderId !== undefined) clean.folderId = patch.folderId || null;
	if (patch.tags !== undefined) clean.tags = Array.isArray(patch.tags) ? patch.tags : [];
	return Response.json({ conversation: updateConversation(params.id, clean) });
}) satisfies RequestHandler;

export const DELETE = (async ({ params }) => {
	deleteConversation(params.id);
	return Response.json({ ok: true });
}) satisfies RequestHandler;
