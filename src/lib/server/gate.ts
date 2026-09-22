import { createHash, timingSafeEqual } from 'node:crypto';

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
