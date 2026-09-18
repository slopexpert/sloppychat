import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { getConversation, queueMessage } from '$lib/server/store';
import type { DocumentRef, ImageRef } from '$lib/shared/types';

/**
 * Holds a message until the turn in flight finishes. The queue belongs to the
 * server, so a reload, a closed page or a second window shows the same queue,
 * and the message is sent when the turn ends.
 */

export const POST = (async ({ params, request }) => {
	if (!getConversation(params.id)) return bad('Conversation not found', 404);
	const input = await body<{ text?: string; images?: ImageRef[]; documents?: DocumentRef[] }>(request);
	const text = (input.text ?? '').trim();
	const images = Array.isArray(input.images) ? input.images.filter((image) => image?.id) : [];
	const documents = Array.isArray(input.documents) ? input.documents.filter((doc) => doc?.id) : [];
	if (!text && !images.length && !documents.length) return bad('Message is empty');
	const queued = queueMessage({ conversationId: params.id, text, images, documents });
	return Response.json({ queued }, { status: 201 });
}) satisfies RequestHandler;
