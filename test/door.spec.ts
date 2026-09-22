import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loopback, door, TOKEN_COOKIE } from '$lib/server/gate';

/**
 * The door in front of the install. A port on a network is an open door to every
 * chat, so the token guards it, and a machine without a token is served on its own
 * loopback address only.
 */

process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-door-'));

const { handle } = await import('../src/hooks.server');

afterEach(() => {
	delete process.env.SLOPPYCHAT_TOKEN;
});

describe('the decision', () => {
	it('knows the machine the server runs on', () => {
		expect(loopback('127.0.0.1')).toBe(true);
		expect(loopback('::1')).toBe(true);
		expect(loopback('::ffff:127.0.0.1')).toBe(true);
		expect(loopback('192.168.1.30')).toBe(false);
		expect(loopback('::ffff:192.168.1.30')).toBe(false);
	});

	it('serves the machine itself when no token is set', () => {
		expect(door({ token: '', address: '127.0.0.1' })).toBe('open');
		expect(door({ token: '', address: '10.0.0.8' })).toBe('closed');
	});

	it('wants the token once one is configured', () => {
		expect(door({ token: 'letmein', address: '192.168.1.30' })).toBe('ask');
		expect(door({ token: 'letmein', address: '192.168.1.30', cookie: 'letmein' })).toBe('open');
		expect(door({ token: 'letmein', address: '192.168.1.30', query: 'letmein' })).toBe('open');
		expect(door({ token: 'letmein', address: '192.168.1.30', cookie: 'guess' })).toBe('ask');
	});

	it('asks even the machine itself once a token is set', () => {
		expect(door({ token: 'letmein', address: '127.0.0.1' })).toBe('ask');
	});
});

describe('the door of one request', () => {
	/** A request from `address`, with the token cookie the browser would send. */
	function event(url: string, options: { address?: string; cookie?: string } = {}) {
		const set: string[] = [];
		return {
			set,
			event: {
				url: new URL(url),
				getClientAddress: () => options.address ?? '127.0.0.1',
				cookies: {
					get: (name: string) => (name === TOKEN_COOKIE ? options.cookie : undefined),
					set: (name: string, value: string) => set.push(`${name}=${value}`)
				}
			}
		};
	}

	/** What the app would answer once the door lets the request through. */
	const app = async () => new Response('the app');

	async function ask(url: string, options?: { address?: string; cookie?: string }): Promise<Response | Error> {
		const { event: e } = event(url, options);
		try {
			return await handle({ event: e, resolve: app } as never);
		} catch (err) {
			// A redirect arrives as a thrown value, which is what the route expects.
			return err as Error;
		}
	}

	it('hands the app to the machine itself with no token set', async () => {
		const response = await ask('http://127.0.0.1:3000/');

		expect(response).toBeInstanceOf(Response);
		expect(await (response as Response).text()).toBe('the app');
	});

	it('refuses another machine when no token could be checked', async () => {
		const response = (await ask('http://192.168.1.5:3000/', { address: '192.168.1.30' })) as Response;

		expect(response.status).toBe(403);
		expect(await response.text()).toContain('SLOPPYCHAT_TOKEN');
	});

	it('shows the token field to a device that has none', async () => {
		process.env.SLOPPYCHAT_TOKEN = 'letmein';

		const response = (await ask('http://192.168.1.5:3000/', { address: '192.168.1.30' })) as Response;

		expect(response.status).toBe(401);
		expect(await response.text()).toContain('name="token"');
	});

	it('remembers the token and cleans it out of the address', async () => {
		process.env.SLOPPYCHAT_TOKEN = 'letmein';
		const { event: e, set } = event('http://192.168.1.5:3000/?c=7&token=letmein', { address: '192.168.1.30' });

		let status = 0;
		let location = '';
		try {
			await handle({ event: e, resolve: app } as never);
		} catch (err) {
			status = (err as { status: number }).status;
			location = (err as { location: string }).location;
		}

		expect(status).toBe(303);
		expect(location, 'the token leaves the address, the rest stays').toBe('/?c=7');
		expect(set).toEqual([`${TOKEN_COOKIE}=letmein`]);
	});

	it('lets a browser through on the cookie alone', async () => {
		process.env.SLOPPYCHAT_TOKEN = 'letmein';

		const response = (await ask('http://192.168.1.5:3000/', {
			address: '192.168.1.30',
			cookie: 'letmein'
		})) as Response;

		expect(await response.text()).toBe('the app');
	});

	it('asks again when the token does not match', async () => {
		process.env.SLOPPYCHAT_TOKEN = 'letmein';

		const response = (await ask('http://192.168.1.5:3000/?token=guess', { address: '192.168.1.30' })) as Response;

		expect(response.status).toBe(401);
		expect(await response.text()).toContain('did not match');
	});
});
