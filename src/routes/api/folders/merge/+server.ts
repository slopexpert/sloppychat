import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { mergeIntoFolder } from '$lib/server/store';

/**
 * Makes a folder that holds the chat that was dragged and the one it was
 * dropped on. This is how a folder is made by dragging a chat onto another.
 */
export const POST = (async ({ request }) => {
	const input = await body<{ chatId?: string; ontoChatId?: string }>(request);
	if (!input.chatId || !input.ontoChatId) return bad('chatId and ontoChatId are required');
	const folder = mergeIntoFolder(input.chatId, input.ontoChatId);
	if (!folder) return bad('Those chats could not be grouped', 400);
	return Response.json({ folder }, { status: 201 });
}) satisfies RequestHandler;
