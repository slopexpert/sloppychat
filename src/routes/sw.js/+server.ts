import type { RequestHandler } from './$types';
import worker from '$lib/server/sw-worker.js?raw';

/**
 * The service worker. It is served from a route rather than from static, because
 * only a route can say "do not cache this": a cached worker would hide every new
 * shell from the browser.
 */
export const GET = (() => {
	return new Response(worker, {
		headers: {
			'content-type': 'text/javascript',
			'cache-control': 'no-cache'
		}
	});
}) satisfies RequestHandler;
