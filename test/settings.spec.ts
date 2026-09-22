import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '$lib/shared/types';

/**
 * The settings route takes what the browser sends, and the code that reads the
 * settings afterwards trusts the types: a round cap that is not a number turns
 * the tool limit off, and a size that is not a number bounds nothing. So every
 * field is checked on the way in.
 */

process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-settings-'));

const store = await import('$lib/server/store');
const route = await import('../src/routes/api/settings/+server');

/** Sends a patch through the route and gives back what the app now holds. */
async function put(patch: unknown): Promise<Record<string, any>> {
	const response = await route.PUT({ request: new Request('http://local/api/settings', {
		method: 'PUT',
		body: JSON.stringify(patch)
	}) } as never);
	expect(response.status).toBe(200);
	return response.json();
}

async function current(): Promise<Record<string, any>> {
	const response = await route.GET();
	return response.json();
}

describe('a settings patch', () => {
	it('keeps a number that is inside the range', async () => {
		const saved = await put({ tools: { maxRounds: 4 } });
		expect(saved.tools.maxRounds).toBe(4);
	});

	it('pulls a number back inside the range', async () => {
		expect((await put({ tools: { maxRounds: 9999 } })).tools.maxRounds).toBe(32);
		expect((await put({ tools: { maxRounds: -3 } })).tools.maxRounds).toBe(0);
		expect((await put({ search: { maxResults: 500 } })).search.maxResults).toBe(20);
		expect((await put({ tools: { pdfMaxImages: 2.7 } })).tools.pdfMaxImages).toBe(3);
	});

	it('drops a value of the wrong type and keeps what was stored', async () => {
		await put({ tools: { maxRounds: 5 } });
		const saved = await put({ tools: { maxRounds: 'many' } });
		expect(saved.tools.maxRounds, 'a word cannot switch the round cap off').toBe(5);

		await put({ tools: { fetchAllowPrivate: true } });
		expect((await put({ tools: { fetchAllowPrivate: 'yes' } })).tools.fetchAllowPrivate).toBe(true);
	});

	it('holds a generation knob inside the range the provider takes', async () => {
		expect((await put({ generation: { temperature: 99 } })).generation.temperature).toBe(2);
		expect((await put({ generation: { temperature: -4 } })).generation.temperature).toBe(0);
		expect((await put({ generation: { temperature: null } })).generation.temperature).toBeNull();
		await put({ generation: { topP: 0.9 } });
		expect((await put({ generation: { topP: 'high' } })).generation.topP).toBe(0.9);
	});

	it('takes only the choices the app knows', async () => {
		expect((await put({ generation: { toolChoice: 'required' } })).generation.toolChoice).toBe('required');
		expect((await put({ generation: { toolChoice: 'sometimes' } })).generation.toolChoice).toBe('auto');
		expect((await put({ theme: { radius: 'round' } })).theme.radius).toBe('round');
		expect((await put({ theme: { radius: 'enormous' } })).theme.radius).toBe(DEFAULT_SETTINGS.theme.radius);
	});

	it('keeps a tool mode that means something, and drops the rest', async () => {
		const saved = await put({ tools: { modes: { read_skill: 'on', web_search: 'maybe', 'fs:read': 'ask' } } });
		expect(saved.tools.modes).toEqual({ read_skill: 'on', 'fs:read': 'ask' });
	});

	it('drops the fields the app does not know', async () => {
		const saved = await put({ evil: { run: true }, tools: { maxRounds: 3 } });
		expect('evil' in saved).toBe(false);
		expect((await current()).evil).toBeUndefined();
	});

	it('leaves the stored value alone when the body is not settings', async () => {
		await put({ tools: { maxRounds: 7 } });
		const response = await route.PUT({
			request: new Request('http://local/api/settings', { method: 'PUT', body: 'not json' })
		} as never);
		expect(response.status).toBe(200);
		expect((await current()).tools.maxRounds).toBe(7);
	});

	it('keeps the search key it was given, and the round cap with it', async () => {
		const saved = await put({ search: { url: 'http://192.168.1.5:8080/search', apiKey: 'sekret' } });
		expect(saved.search.apiKey).toBe('sekret');
		expect(saved.search.url).toBe('http://192.168.1.5:8080/search');
		expect(saved.tools.maxRounds).toBe(7);
	});
});

describe('the round cap the turn reads', () => {
	it('is a number the tool loop can count with', async () => {
		await put({ tools: { maxRounds: 'off' } });
		expect(typeof store.getSettings().tools.maxRounds).toBe('number');
	});
});
