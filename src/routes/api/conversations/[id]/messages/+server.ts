import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { isTurnRunning } from '$lib/server/hub';
import { appendMessage, getConversation, getDocument, listMessages, maybeTitleFromFirstMessage, queueMessage } from '$lib/server/store';
import { countLines } from '$lib/shared/files';
import type { DocumentRef, ImageRef } from '$lib/shared/types';

export const GET = (async ({ params }) => {
	if (!getConversation(params.id)) return bad('Conversation not found', 404);
	return Response.json({ messages: listMessages(params.id) });
}) satisfies RequestHandler;

/**
 * Adds a user message. The assistant turn is started by POST /api/chat. A turn
 * owns the chat while it runs, so the message waits for it rather than landing
 * in the middle of the answer, and 202 says it was held.
 */
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
						? {
								id: stored.id,
								name: stored.name,
								pages: stored.pages,
								// A document without pages is a text file, so its line count belongs here.
								...(stored.pages > 0 ? {} : { lines: countLines(stored.text) }),
								chars: stored.text.length
							}
						: doc
				];
			})
		: [];
	if (!text && !images.length && !documents.length) return bad('Message is empty');
	// The server is the one that knows whether a turn runs, so it is the one that
	// decides: a page that guesses wrong still lands in the right place.
	if (isTurnRunning(params.id)) {
		const queued = queueMessage({ conversationId: params.id, text, images, documents });
		return Response.json({ queued }, { status: 202 });
	}
	const message = appendMessage({ conversationId: params.id, role: 'user', text, images, documents });
	maybeTitleFromFirstMessage(params.id, text);
	return Response.json({ message }, { status: 201 });
}) satisfies RequestHandler;
