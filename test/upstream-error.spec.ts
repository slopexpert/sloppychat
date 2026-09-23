import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a failing provider leaves behind. The reason belongs on the screen, and
 * the whole answer belongs in the server log, where a long trace or a path of the
 * provider machine can be read without going to a browser.
 */

process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-upstream-'));

const { httpError } = await import('$lib/server/openai');

/** The lines the server wrote while the call ran. */
let lines: string[] = [];

beforeEach(() => {
	lines = [];
	vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		lines.push(args.map(String).join(' '));
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('a provider that failed', () => {
	it('writes the answer to the log with the status it came with', async () => {
		const message = await httpError(new Response('CUDA out of memory', { status: 500 }), 'Request to llama');

		expect(lines.join('\n')).toContain('[provider] Request to llama: HTTP 500');
		expect(lines.join('\n'), 'the log holds what the screen shows').toContain('CUDA out of memory');
		expect(message).toContain('HTTP 500');
		expect(message).toContain('CUDA out of memory');
	});

	it('keeps more in the log than it sends to the screen', async () => {
		const raw = `${'x'.repeat(5_000)}TAIL`;

		const message = await httpError(new Response(raw, { status: 500 }), 'Request to llama');

		expect(message.length, 'one screen of text').toBeLessThan(900);
		const logged = lines.join('\n');
		expect(logged.length, 'the log keeps four thousand of it').toBeGreaterThan(message.length);
		expect(logged).not.toContain('TAIL');
	});

	it('keeps the reason the provider gave, and adds the hint of the status', async () => {
		const body = JSON.stringify({ error: { message: 'The model does not exist' } });

		const gone = await httpError(new Response(body, { status: 404 }), 'Model list for llama');
		const key = await httpError(new Response(body, { status: 401 }), 'Model list for llama');

		expect(gone).toContain('The model does not exist');
		expect(gone).toContain('check the base URL');
		expect(key).toContain('check the API key');
	});
});
