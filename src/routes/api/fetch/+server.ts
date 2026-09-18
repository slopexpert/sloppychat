import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { getSettings } from '$lib/server/store';
import { fetchPage } from '$lib/server/fetcher';
import { BlockedAddressError } from '$lib/server/safe-fetch';
import { formatPageResult } from '$lib/shared/tools';

/** Reads one URL through the guarded fetcher and returns reader mode markdown. */
export const POST = (async ({ request }) => {
	const settings = getSettings();
	const input = await body<{ url?: string; raw?: boolean }>(request);
	const url = (input.url ?? '').trim();
	if (!/^https?:\/\//i.test(url)) return bad('URL must start with http:// or https://');
	try {
		const page = await fetchPage(url, {
			maxChars: settings.tools.fetchMaxChars,
			allowPrivate: settings.tools.fetchAllowPrivate,
			raw: input.raw === true,
			signal: AbortSignal.timeout(45000)
		});
		return Response.json({
			...page,
			text: formatPageResult({
				url: page.url,
				title: page.title,
				mode: page.mode,
				markdown: page.markdown,
				truncated: page.truncated
			})
		});
	} catch (err) {
		if (err instanceof BlockedAddressError) {
			return bad(
				`Refused ${err.hostname}: ${err.reason}. Turn on "Allow private hosts" in Settings > Tools to fetch it anyway.`,
				400
			);
		}
		const message = err instanceof Error ? err.message : String(err);
		return bad(message, 502);
	}
}) satisfies RequestHandler;
