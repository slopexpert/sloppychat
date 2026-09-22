import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HttpConnection } from '$lib/server/mcp/http';
import type { McpServer } from '$lib/shared/types';

/**
 * The Streamable HTTP transport: one JSON reply, one event stream reply, the
 * session header, a JSON-RPC error, and a request that never answers.
 */

const SESSION = 'session-123';
const hits = { initialize: 0, withoutSession: 0, calls: 0 };

function server(overrides: Partial<McpServer['config']> = {}): McpServer {
	return {
		id: 'h1',
		name: 'remote',
		enabled: true,
		config: { transport: 'http', url: 'http://127.0.0.1:5404/mcp', timeoutMs: 4000, ...overrides },
		createdAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString()
	};
}

const json = (res: Response | import('node:http').ServerResponse, body: unknown, status = 200, headers = {}) => {
	const target = res as import('node:http').ServerResponse;
	target.writeHead(status, { 'content-type': 'application/json', ...headers });
	target.end(JSON.stringify(body));
};

const mock = createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://127.0.0.1:5404');
	if (url.pathname !== '/mcp') {
		json(res, { error: 'not found' }, 404);
		return;
	}
	let raw = '';
	req.on('data', (part) => (raw += part));
	req.on('end', () => {
		let message: { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
		try {
			message = JSON.parse(raw);
		} catch {
			json(res, { error: 'bad json' }, 400);
			return;
		}
		const session = req.headers['mcp-session-id'];
		if (message.method === 'initialize') {
			hits.initialize++;
			json(res, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }, 200, {
				'mcp-session-id': SESSION
			});
			return;
		}
		if (session !== SESSION) {
			hits.withoutSession++;
			json(res, { error: 'no session' }, 400);
			return;
		}
		if (message.method === 'notifications/initialized') {
			res.writeHead(202).end();
			return;
		}
		if (message.method === 'tools/list') {
			json(res, {
				jsonrpc: '2.0',
				id: message.id,
				result: { tools: [{ name: 'echo', description: 'Return the text it was given.' }] }
			});
			return;
		}
		if (message.method === 'tools/call') {
			hits.calls++;
			const name = message.params?.name;
			if (name === 'stall') return;
			if (name === 'crlf') {
				// A server whose lines end with CRLF, closing without a blank line.
				res.writeHead(200, { 'content-type': 'text/event-stream' });
				res.write(
					`data: ${JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						result: { content: [{ type: 'text', text: 'crlf: ok' }] }
					})}\r\n\r\n`
				);
				res.end();
				return;
			}
			if (name === 'trailing') {
				// The frame has no blank line of its own before the stream closes.
				res.writeHead(200, { 'content-type': 'text/event-stream' });
				res.write(
					`data: ${JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						result: { content: [{ type: 'text', text: 'last frame' }] }
					})}`
				);
				res.end();
				return;
			}
			if (name === 'boom') {
				json(res, { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'boom' } });
				return;
			}
			// An answer that arrives as an event stream, which the protocol allows.
			res.writeHead(200, { 'content-type': 'text/event-stream' });
			res.write('event: message\n');
			res.write(
				`data: ${JSON.stringify({
					jsonrpc: '2.0',
					id: message.id,
					result: { content: [{ type: 'text', text: `echo: ${message.params?.arguments?.text ?? ''}` }] }
				})}\n\n`
			);
			res.end();
			return;
		}
		json(res, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'no method' } });
	});
});

beforeAll(async () => {
	await new Promise<void>((resolve) => mock.listen(5404, '127.0.0.1', () => resolve()));
});

afterAll(() => {
	mock.close();
});

describe('the Streamable HTTP connection', () => {
	it('handshakes, keeps the session and lists the tools', async () => {
		const connection = await HttpConnection.connect(server());
		try {
			expect(hits.initialize).toBe(1);
			const tools = await connection.listTools();
			expect(tools.map((tool) => tool.name)).toEqual(['echo']);
			// The session header was sent on the requests after the handshake.
			expect(hits.withoutSession).toBe(0);
		} finally {
			connection.close();
		}
	});

	it('reads a reply that arrives as an event stream', async () => {
		const connection = await HttpConnection.connect(server());
		try {
			const answer = await connection.callTool('echo', { text: 'hi' });
			expect(answer.content).toEqual([{ type: 'text', text: 'echo: hi' }]);
		} finally {
			connection.close();
		}
	});

	it('reads an event stream whose lines end with CRLF', async () => {
		const connection = await HttpConnection.connect(server());
		try {
			const answer = await connection.callTool('crlf', {});
			expect(answer.content).toEqual([{ type: 'text', text: 'crlf: ok' }]);
		} finally {
			connection.close();
		}
	});

	it('reads the last frame when the stream ends without a blank line', async () => {
		const connection = await HttpConnection.connect(server());
		try {
			const answer = await connection.callTool('trailing', {});
			expect(answer.content).toEqual([{ type: 'text', text: 'last frame' }]);
		} finally {
			connection.close();
		}
	});

	it('refuses a request whose signal is already stopped, without asking the server', async () => {
		const connection = await HttpConnection.connect(server());
		const controller = new AbortController();
		const listener = vi.spyOn(controller.signal, 'addEventListener');
		controller.abort();
		const before = hits.calls;
		try {
			await expect(connection.callTool('echo', { text: 'hi' }, controller.signal)).rejects.toThrow(
				/cancelled/i
			);
			expect(hits.calls, 'the server was not asked').toBe(before);
			expect(listener, 'no listener on a signal that cannot fire').not.toHaveBeenCalled();
		} finally {
			connection.close();
		}
	});

	it('reports a JSON-RPC error', async () => {
		const connection = await HttpConnection.connect(server());
		try {
			await expect(connection.callTool('boom', {})).rejects.toThrow(/boom/);
		} finally {
			connection.close();
		}
	});

	it('gives up on a request that never answers', async () => {
		const connection = await HttpConnection.connect(server({ timeoutMs: 300 }));
		try {
			await expect(connection.callTool('stall', {})).rejects.toThrow(/did not answer/i);
		} finally {
			connection.close();
		}
	});

	it('reports an endpoint that refuses the handshake', async () => {
		await expect(HttpConnection.connect(server({ url: 'http://127.0.0.1:5404/nope' }))).rejects.toThrow(/HTTP 404/);
	});
});
