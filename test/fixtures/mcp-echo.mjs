#!/usr/bin/env node
/**
 * A small MCP server over stdio, for the tests. It reads one JSON-RPC message
 * per line and writes one reply per line. It also writes a line that is not
 * JSON, because real servers do that too and the client must ignore it.
 */
import { createInterface } from 'node:readline';

const tools = [
	{
		name: 'echo',
		description: 'Return the text it was given.',
		inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
	},
	{
		name: 'add',
		description: 'Add two numbers.',
		inputSchema: {
			type: 'object',
			properties: { a: { type: 'number' }, b: { type: 'number' } },
			required: ['a', 'b']
		}
	},
	{ name: 'picture', description: 'Return a small image.', inputSchema: { type: 'object', properties: {} } },
	{ name: 'stall', description: 'Never answers.', inputSchema: { type: 'object', properties: {} } },
	{ name: 'crash', description: 'Stops the server.', inputSchema: { type: 'object', properties: {} } }
];

const PNG =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+7ZTVAAAAAElFTkSuQmCC';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
	if (line.startsWith('log')) {
		process.stdout.write('this line is not JSON\n');
		return;
	}
	let request;
	try {
		request = JSON.parse(line);
	} catch {
		return;
	}
	if (request.method === 'initialize') {
		send({
			jsonrpc: '2.0',
			id: request.id,
			result: {
				protocolVersion: '2025-06-18',
				capabilities: { tools: {} },
				serverInfo: { name: 'echo', version: '1.0.0' }
			}
		});
		return;
	}
	// A notification carries no id and gets no reply.
	if (request.method === 'notifications/initialized') return;
	if (request.method === 'tools/list') {
		send({ jsonrpc: '2.0', id: request.id, result: { tools } });
		return;
	}
	if (request.method === 'tools/call') {
		const name = request.params?.name;
		const args = request.params?.arguments ?? {};
		if (name === 'echo') {
			send({
				jsonrpc: '2.0',
				id: request.id,
				result: { content: [{ type: 'text', text: `echo: ${args.text ?? ''}` }] }
			});
			return;
		}
		if (name === 'add') {
			send({
				jsonrpc: '2.0',
				id: request.id,
				result: { content: [{ type: 'text', text: String(Number(args.a ?? 0) + Number(args.b ?? 0)) }] }
			});
			return;
		}
		if (name === 'picture') {
			send({
				jsonrpc: '2.0',
				id: request.id,
				result: {
					content: [
						{ type: 'image', data: PNG, mimeType: 'image/png' },
						{ type: 'text', text: 'a picture' }
					]
				}
			});
			return;
		}
		if (name === 'crash') {
			process.exit(1);
		}
		if (name === 'stall') return;
		send({
			jsonrpc: '2.0',
			id: request.id,
			result: { content: [{ type: 'text', text: `no tool ${name}` }], isError: true }
		});
		return;
	}
	send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `no method ${request.method}` } });
});
