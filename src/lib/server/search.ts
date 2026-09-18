import type { SearchConfig, SearchResult } from '$lib/shared/types';

/** SearXNG JSON API client. The instance must allow `json` in search.formats. */

export type { SearchResult };

export interface SearchResponse {
	query: string;
	provider: string;
	results: SearchResult[];
	unresponsiveEngines?: string[];
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
}

function normalize(raw: unknown, maxResults: number): SearchResult[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: SearchResult[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const entry = item as Record<string, unknown>;
		const url = typeof entry.url === 'string' ? entry.url : '';
		if (!url || seen.has(url)) continue;
		seen.add(url);
		out.push({
			title: typeof entry.title === 'string' ? entry.title : url,
			url,
			snippet: typeof entry.content === 'string' ? entry.content : '',
			domain: hostOf(url),
			publishedDate: typeof entry.publishedDate === 'string' ? entry.publishedDate : undefined
		});
		if (out.length >= maxResults) break;
	}
	return out;
}

function trimUrl(url: string): string {
	return url.replace(/\/+$/, '');
}

export async function searxngSearch(
	config: SearchConfig,
	query: string,
	maxResults: number,
	signal?: AbortSignal
): Promise<SearchResponse> {
	const base = config.url.trim();
	if (!base) {
		throw new Error('No SearXNG instance configured. Open Settings > Tools and set the SearXNG URL.');
	}
	let endpoint: URL;
	try {
		endpoint = new URL(`${trimUrl(base)}/search`);
	} catch {
		throw new Error(`Invalid SearXNG URL: ${base}`);
	}
	endpoint.searchParams.set('q', query);
	endpoint.searchParams.set('format', 'json');
	endpoint.searchParams.set('language', 'all');
	endpoint.searchParams.set('pageno', '1');

	const headers: Record<string, string> = {
		accept: 'application/json',
		'user-agent': UA
	};
	if (config.apiKey.trim()) headers.authorization = `Bearer ${config.apiKey.trim()}`;

	const res = await fetch(endpoint, { headers, signal });
	if (!res.ok) {
		const body = (await res.text()).slice(0, 300);
		const hint =
			res.status === 403
				? ' - the instance may have JSON output disabled; enable json under search.formats in settings.yml'
				: '';
		throw new Error(`SearXNG error (HTTP ${res.status})${hint}: ${body}`);
	}
	const body = (await res.json()) as Record<string, unknown>;
	const usage = body.usage as Record<string, unknown> | undefined;
	if (usage && usage.source === 'json' && Array.isArray(body.error)) {
		throw new Error(`SearXNG rate limited: ${(body.error as unknown[]).join(' ')}`);
	}
	const engines = Array.isArray(body.unresponsive_engines) ? body.unresponsive_engines.map(String) : undefined;
	return {
		query,
		provider: 'SearXNG',
		results: normalize(body.results, maxResults),
		unresponsiveEngines: engines?.length ? engines : undefined
	};
}
