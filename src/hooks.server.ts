import { redirect, type Handle } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { door, refuses, TOKEN_COOKIE, wantsToken } from '$lib/server/gate';
import { armShutdown } from '$lib/server/lifecycle';

/** How long an approved browser is remembered, so the token is typed once. */
const REMEMBER_DAYS = 30;

/**
 * Opens the database on the first request so dev boots stay fast, arms the child
 * cleanup, and holds the door. SLOPPYCHAT_TOKEN guards the install: a browser
 * sends it once and the
 * cookie carries it from then on. With no token set the server answers its own
 * machine only, so a start on a shared network cannot share the chats by accident.
 */
export const handle: Handle = async ({ event, resolve }) => {
	getDB();
	// The test runner owns the signals of its own process, so only a server a
	// person started asks to be stopped.
	if (!process.env.VITEST) armShutdown();
	const token = process.env.SLOPPYCHAT_TOKEN ?? '';
	const given = event.url.searchParams.get('token');
	const state = door({
		token,
		address: event.getClientAddress(),
		cookie: event.cookies.get(TOKEN_COOKIE),
		query: given
	});

	if (state === 'closed') return refuses(event.url.pathname);
	if (state === 'ask') return wantsToken(event.url.pathname, !!given);
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
