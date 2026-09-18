import type { RequestHandler } from './$types';
import { searchChats } from '$lib/server/store';

/** Full text search over the chat titles and the message text. */
export const GET = (async ({ url }) => {
	const query = (url.searchParams.get('q') ?? '').trim();
	const limit = Number(url.searchParams.get('limit') ?? 30);
	return Response.json({
		query,
		hits: query ? searchChats(query, Number.isFinite(limit) ? Math.min(100, limit) : 30) : []
	});
}) satisfies RequestHandler;
