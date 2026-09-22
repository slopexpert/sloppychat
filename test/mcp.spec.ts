import { describe, expect, it, vi } from 'vitest';
import { configFromCursor, parseCursorConfig, sanitizeToolPart, toCursorConfig, toolIdFor } from '$lib/shared/mcp';
import type { McpServer } from '$lib/shared/types';
import { StdioConnection } from '$lib/server/mcp/stdio';

/** The MCP server list, the config format, and the stdio connection. */

const FIXTURE = 'test/fixtures/mcp-echo.mjs';

function server(overrides: Partial<McpServer['config']> = {}, name = 'echo'): McpServer {
	return {
		id: 's1',
		name,
		enabled: true,
		config: { transport: 'stdio', command: process.execPath, args: [FIXTURE], timeoutMs: 4000, ...overrides },
		createdAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString()
	};
}

function connect(overrides: Partial<McpServer['config']> = {}, name = 'echo') {
	return StdioConnection.connect(server(overrides, name));
}

describe('tool ids', () => {
	it('makes a name the model can call', () => {
		expect(toolIdFor('my files', 'read.file')).toBe('my_files_read_file');
		expect(toolIdFor('echo', 'echo')).toBe('echo_echo');
	});

	it('never returns an empty part', () => {
		expect(sanitizeToolPart('')).toBe('server');
		expect(sanitizeToolPart('###')).toBe('server');
	});
});

describe('the Cursor config format', () => {
	it('reads a stdio entry', () => {
		const parsed = parseCursorConfig(
			JSON.stringify({
				mcpServers: { files: { command: 'npx', args: ['-y', 'server-files'], env: { HOME: '/tmp' }, cwd: '/tmp' } }
			})
		);
		expect(parsed).toEqual([
			{
				name: 'files',
				config: { transport: 'stdio', command: 'npx', args: ['-y', 'server-files'], env: { HOME: '/tmp' }, cwd: '/tmp' }
			}
		]);
	});

	it('reads an http entry and the timeout', () => {
		const parsed = parseCursorConfig(
			JSON.stringify({ mcpServers: { remote: { url: 'https://example.test/mcp', headers: { 'x-key': '1' }, timeout_ms: 5000 } } })
		);
		expect(parsed[0].config).toEqual({
			transport: 'http',
			url: 'https://example.test/mcp',
			headers: { 'x-key': '1' },
			timeoutMs: 5000
		});
	});

	it('accepts a bare map of servers', () => {
		expect(parseCursorConfig(JSON.stringify({ one: { command: 'one' } }))[0].name).toBe('one');
	});

	it('refuses text that is not JSON, and entries without a command or url', () => {
		expect(() => parseCursorConfig('not json')).toThrow(/not valid JSON/i);
		expect(() => parseCursorConfig(JSON.stringify({ mcpServers: { empty: { args: [] } } }))).toThrow(/command or a url/i);
	});

	it('writes the same shape back out', () => {
		const json = JSON.parse(
			toCursorConfig([
				{ ...server(), name: 'files', config: { transport: 'stdio', command: 'npx', args: ['-y', 'x'], timeoutMs: 9000 } },
				{ ...server(), id: 's2', name: 'remote', config: { transport: 'http', url: 'https://example.test/mcp' } }
			])
		);
		expect(json.mcpServers.files).toEqual({ command: 'npx', args: ['-y', 'x'], timeout_ms: 9000 });
		expect(json.mcpServers.remote).toEqual({ url: 'https://example.test/mcp' });
	});

	it('drops an entry that has neither a command nor a url', () => {
		expect(configFromCursor('bad', { args: [] })).toBeUndefined();
	});
});

describe('the stdio connection', () => {
	it('handshakes, lists the tools and calls one', async () => {
		const connection = await connect();
		try {
			const tools = await connection.listTools();
			expect(tools.map((tool) => tool.name)).toEqual(['echo', 'add', 'picture', 'stall', 'crash']);
			expect(tools[0].description).toContain('Return the text');

			const answer = await connection.callTool('echo', { text: 'hello' });
			expect(answer.isError).toBe(false);
			expect(answer.content).toEqual([{ type: 'text', text: 'echo: hello' }]);

			const sum = await connection.callTool('add', { a: 2, b: 3 });
			expect(sum.content[0]).toEqual({ type: 'text', text: '5' });
		} finally {
			connection.close();
		}
	});

	it('returns an image block as it arrives', async () => {
		const connection = await connect();
		try {
			const answer = await connection.callTool('picture', {});
			expect(answer.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
		} finally {
			connection.close();
		}
	});

	it('gives up on a request that never answers', async () => {
		// A second, so a slow process start under a full test run is not the thing
		// that times out: the call must be.
		const connection = await connect({ timeoutMs: 1000 });
		try {
			await expect(connection.callTool('stall', {})).rejects.toThrow(/did not answer/i);
		} finally {
			connection.close();
		}
	});

	it('reports a server that stops as not alive', async () => {
		const connection = await connect();
		await expect(connection.callTool('crash', {})).rejects.toThrow(/stopped/i);
		expect(connection.alive).toBe(false);
		connection.close();
	});

	it('fails a request on a command that cannot start', async () => {
		await expect(connect({ command: 'definitely-not-a-real-program-xyz' })).rejects.toThrow();
	});

	it('answers a call after the server was closed', async () => {
		const connection = await connect();
		connection.close();
		await expect(connection.callTool('echo', { text: 'hi' })).rejects.toThrow(/stopped/i);
	});

	it('refuses a request whose signal is already stopped', async () => {
		const connection = await connect();
		const controller = new AbortController();
		const listener = vi.spyOn(controller.signal, 'addEventListener');
		controller.abort();
		try {
			await expect(connection.request('tools/list', {}, controller.signal)).rejects.toThrow(/cancelled/i);
			// A signal that already fired never fires again, so nothing may be
			// attached to it: such a listener stays for the life of the signal.
			expect(listener, 'no listener on a signal that cannot fire').not.toHaveBeenCalled();
		} finally {
			connection.close();
		}
	});

	it('cancels a request when the stop arrives during it', async () => {
		const connection = await connect({ timeoutMs: 4000 });
		const controller = new AbortController();
		const pending = connection.callTool('stall', {}, controller.signal);
		await new Promise((resolve) => setTimeout(resolve, 60));
		controller.abort();

		await expect(pending).rejects.toThrow(/cancelled/i);
		connection.close();
	});
});
