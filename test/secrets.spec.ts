import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What the browser is told about an MCP server. The environment of a stdio
 * process and the headers of an http endpoint hold the tokens that server needs,
 * and the settings page has no use for them, so they stay on the server. The page
 * gets the command, the url and the tools, which is what it draws.
 *
 * The store reads the database path when the module loads, so the data directory
 * is set before the first server import.
 */

process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-secrets-'));

const store = await import('$lib/server/store');
const list = await import('../src/routes/api/mcp/+server');
const one = await import('../src/routes/api/mcp/[id]/+server');
const test = await import('../src/routes/api/mcp/test/+server');

/** A server that is switched off, so no route tries to open it. */
function offServer() {
	return store.createMcpServer({
		name: 'local',
		enabled: false,
		config: { transport: 'stdio', command: 'node', args: ['server.js'], env: { API_TOKEN: 'hush' } }
	});
}

async function servers(): Promise<Record<string, any>[]> {
	const response = await list.GET({ url: new URL('http://local/api/mcp') } as never);
	return (await response.json()).servers;
}

describe('the MCP list', () => {
	it('keeps the environment values on the server', async () => {
		offServer();

		const body = JSON.stringify(await servers());

		expect(body).toContain('server.js');
		expect(body, 'the command travels, its environment does not').not.toContain('hush');
	});

	it('keeps the headers of a new http server on the server', async () => {
		const response = await list.POST({
			request: new Request('http://local/api/mcp', {
				method: 'POST',
				body: JSON.stringify({
					name: 'remote',
					config: { transport: 'http', url: 'http://127.0.0.1:9/mcp', headers: { authorization: 'Bearer hush2' } }
				})
			})
		} as never);

		const body = await response.text();

		expect(response.status).toBe(201);
		expect(body).toContain('http://127.0.0.1:9/mcp');
		expect(body).not.toContain('hush2');
	});

	it('keeps them when a server is renamed', async () => {
		const server = offServer();

		const response = await one.PATCH({
			params: { id: server.id },
			request: new Request('http://local/api/mcp/x', { method: 'PATCH', body: JSON.stringify({ name: 'renamed' }) })
		} as never);

		const body = await response.text();

		expect(body).toContain('renamed');
		expect(body).not.toContain('hush');
	});
});

describe('the test of one MCP server', () => {
	it('wants the id of a saved server', async () => {
		const missing = await test.POST({
			request: new Request('http://local/api/mcp/test', { method: 'POST', body: JSON.stringify({ id: 'nope' }) })
		} as never);

		expect(missing.status).toBe(404);
	});

	it('refuses to try a config handed to it', async () => {
		const response = await test.POST({
			request: new Request('http://local/api/mcp/test', {
				method: 'POST',
				body: JSON.stringify({ config: { transport: 'http', url: 'http://127.0.0.1:9/mcp' } })
			})
		} as never);

		expect(response.status).toBe(400);
	});
});
