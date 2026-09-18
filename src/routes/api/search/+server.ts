import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { searxngSearch } from '$lib/server/search';
import { getSettings } from '$lib/server/store';
import { formatSearchResult } from '$lib/shared/tools';

/** Runs a SearXNG search on the server so the browser needs no CORS tricks. */
export const POST = (async ({ request }) => {
	const settings = getSettings();
	const input = await body<{ query?: string; max_results?: number }>(request);
	const query = (input.query ?? '').trim();
	if (!query) return bad('Missing query');
	const wanted = Number(input.max_results ?? settings.search.maxResults);
	const maxResults = Math.min(Math.max(Number.isFinite(wanted) ? wanted : 5, 1), 10);
	try {
		const response = await searxngSearch(settings.search, query, maxResults, AbortSignal.timeout(30000));
		return Response.json({
			query: response.query,
			provider: response.provider,
			results: response.results,
			unresponsiveEngines: response.unresponsiveEngines,
			text: formatSearchResult(response.query, response.results)
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return bad(message, 502);
	}
}) satisfies RequestHandler;
