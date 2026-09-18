import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { appendMessage, getConversation, getDocument, listMessages, maybeTitleFromFirstMessage } from '$lib/server/store';
import type { DocumentRef, ImageRef } from '$lib/shared/types';

export const GET = (async ({ params }) => {
	if (!getConversation(params.id)) return bad('Conversation not found', 404);
	return Response.json({ messages: listMessages(params.id) });
}) satisfies RequestHandler;

/** Adds a user message. The assistant turn is started by POST /api/chat. */
export const POST = (async ({ params, request }) => {
	if (!getConversation(params.id)) return bad('Conversation not found', 404);
	const input = await body<{ text?: string; images?: ImageRef[]; documents?: DocumentRef[] }>(request);
	const text = (input.text ?? '').trim();
	const images = Array.isArray(input.images) ? input.images.filter((img) => img?.id) : [];
	const documents: DocumentRef[] = Array.isArray(input.documents)
		? input.documents.flatMap((doc) => {
				if (!doc?.id) return [];
				const stored = getDocument(doc.id);
				// Refresh the counts from the store so the client cannot skew them.
				return [
					stored
						? { id: stored.id, name: stored.name, pages: stored.pages, chars: stored.text.length }
						: doc
				];
			})
		: [];
	if (!text && !images.length && !documents.length) return bad('Message is empty');
	const message = appendMessage({ conversationId: params.id, role: 'user', text, images, documents });
	maybeTitleFromFirstMessage(params.id, text);
	return Response.json({ message }, { status: 201 });
}) satisfies RequestHandler;
