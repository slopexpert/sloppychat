import { createHash, timingSafeEqual } from 'node:crypto';
import { CLOSED_TEXT, TOKEN_ERROR } from '$lib/shared/types';

/** The cookie that remembers an approved browser, so the token is typed once. */
export const TOKEN_COOKIE = 'sloppychat-token';

/** What the door decided about one request. */
export type Door = 'open' | 'ask' | 'closed';

/** A compare that gives away neither the length of the token nor where it differs. */
function same(token: string, given: string): boolean {
	return timingSafeEqual(createHash('sha256').update(token).digest(), createHash('sha256').update(given).digest());
}

/** True when the address belongs to the machine the server itself runs on. */
export function loopback(address: string): boolean {
	const host = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
	return host === '::1' || host === 'localhost' || host.startsWith('127.');
}

/**
 * Decides one request. With a token configured, the cookie or the address must
 * carry it. Without a token the install serves its own machine only, because an
 * open port hands every chat on it to the whole network.
 */
export function door(options: {
	token: string;
	address: string;
	cookie?: string | null;
	query?: string | null;
}): Door {
	if (!options.token) return loopback(options.address) ? 'open' : 'closed';
	if (options.cookie && same(options.token, options.cookie)) return 'open';
	if (options.query && same(options.token, options.query)) return 'open';
	return 'ask';
}

/** The one screen the door shows while it waits for a person to type the token. */
function askPage(wrong: boolean): string {
	return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sloppychat</title>
<style>
	body { font: 15px/1.5 system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #141414; color: #eaeaea; }
	form { display: grid; gap: .6rem; width: min(88vw, 20rem); }
	input, button { font: inherit; padding: .5rem .7rem; border-radius: .5rem; border: 1px solid #333; background: #1e1e1e; color: inherit; }
	.warn { color: #ff6b6b; margin: 0; }
</style>
<form method="get">
	<strong>sloppychat</strong>
	${wrong ? '<p class="warn">The token did not match.</p>' : ''}
	<input name="token" type="password" placeholder="token" autocomplete="current-password" autofocus>
	<button type="submit">Open</button>
</form>`;
}

/** True when the caller is code of our own app, where no one reads an HTML page. */
function isApi(path: string): boolean {
	return path.startsWith('/api/');
}

/**
 * Answers a request with no usable token. A person gets the field, code gets JSON,
 * so an API caller reads one message instead of a whole page, and the app can see
 * the status and ask for a fresh token on its own.
 */
export function wantsToken(path: string, wrong: boolean): Response {
	if (isApi(path)) return Response.json({ error: TOKEN_ERROR }, { status: 401 });
	return new Response(askPage(wrong), { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** Answers a request this install will not serve at all, because no token is set. */
export function refuses(path: string): Response {
	if (isApi(path)) return Response.json({ error: CLOSED_TEXT }, { status: 403 });
	return new Response(CLOSED_TEXT, { status: 403 });
}
