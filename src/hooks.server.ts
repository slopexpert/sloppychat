import { redirect, type Handle } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { door, TOKEN_COOKIE } from '$lib/server/gate';

/** How long an approved browser is remembered, so the token is typed once. */
const REMEMBER_DAYS = 30;

/** The one screen the door shows while it waits for the token. */
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

/**
 * Opens the database on the first request so dev boots stay fast, and holds the
 * door. SLOPPYCHAT_TOKEN guards the install: a browser sends it once and the
 * cookie carries it from then on. With no token set the server answers its own
 * machine only, so a start on a shared network cannot share the chats by accident.
 */
export const handle: Handle = async ({ event, resolve }) => {
	getDB();
	const token = process.env.SLOPPYCHAT_TOKEN ?? '';
	const given = event.url.searchParams.get('token');
	const state = door({
		token,
		address: event.getClientAddress(),
		cookie: event.cookies.get(TOKEN_COOKIE),
		query: given
	});

	if (state === 'closed') {
		return new Response('This install answers its own machine. Set SLOPPYCHAT_TOKEN to let other devices in.', {
			status: 403
		});
	}
	if (state === 'ask') {
		return new Response(askPage(!!given), { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } });
	}
	if (token && given) {
		// The token came from the address bar: remember it, then clean the address so
		// the secret does not stay in the browser history.
		event.cookies.set(TOKEN_COOKIE, given, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * REMEMBER_DAYS
		});
		const clean = new URL(event.url);
		clean.searchParams.delete('token');
		redirect(303, clean.pathname + clean.search);
	}
	return resolve(event);
};
