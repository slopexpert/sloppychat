import type { RequestHandler } from './$types';
import { DEFAULT_SEARCH_HITS, searchChats } from '$lib/server/store';

/** Full text search over the chat titles and the message text. */
export const GET = (async ({ url }) => {
	const query = (url.searchParams.get('q') ?? '').trim();
	// The store owns the bound, so an odd number here cannot reach the list.
	const limit = Number(url.searchParams.get('limit') ?? DEFAULT_SEARCH_HITS);
	return Response.json({
		query,
		hits: query ? searchChats(query, limit) : []
	});
}) satisfies RequestHandler;
