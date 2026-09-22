import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '$lib/shared/types';

/**
 * Two turns can ask for the tools of a MCP server at the same moment. Opening
 * the server twice is not twice as ready: for a stdio server it is a second
 * child process, and only one of them is written down, so the other stays
 * running with nobody to close it.
 *
 * The two transports are replaced by doubles that count the opens and answer
 * when the test says so.
 */

process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-mcp-open-'));

const opens = { stdio: 0, http: 0 };
/** Lets a test hold an open open, so a second caller arrives during it. */
let releaseOpen: (() => void) | undefined;
let holdOpen = false;

function connection(kind: string) {
	return {
		kind,
		alive: true,
		async listTools() {
			return [{ name: 'echo', description: 'Return the text it was given.' }];
		},
		async callTool() {
			return { content: [], isError: false };
		},
		close: vi.fn()
	};
}

vi.mock('$lib/server/mcp/stdio', () => ({
	StdioConnection: {
		connect: async () => {
			opens.stdio++;
			if (holdOpen) await new Promise<void>((resolve) => (releaseOpen = resolve));
			return connection('stdio');
		}
	}
}));

vi.mock('$lib/server/mcp/http', () => ({
	HttpConnection: {
		connect: async () => {
			opens.http++;
			if (holdOpen) await new Promise<void>((resolve) => (releaseOpen = resolve));
			return connection('http');
		}
	}
}));

const store = await import('$lib/server/store');
const registry = await import('$lib/server/mcp/registry');

function server(name: string, transport: 'stdio' | 'http'): McpServer {
	return store.createMcpServer({
		name,
		enabled: true,
		config: transport === 'stdio' ? { transport, command: 'echo' } : { transport, url: 'http://127.0.0.1:1/mcp' }
	});
}

beforeEach(() => {
	opens.stdio = 0;
	opens.http = 0;
	holdOpen = false;
	releaseOpen = undefined;
	for (const item of store.listMcpServers()) store.deleteMcpServer(item.id);
	registry.closeMcpServers();
});

describe('opening a MCP server', () => {
	it('opens once when two callers ask at the same moment', async () => {
		const first = server('shared', 'stdio');

		const [a, b] = await Promise.all([registry.mcpTools(), registry.mcpTools()]);

		expect(opens.stdio, 'one child process for one server').toBe(1);
		expect(a.map((tool) => tool.name)).toEqual(['echo']);
		expect(b.map((tool) => tool.name)).toEqual(['echo']);
		expect(first.enabled).toBe(true);
	});

	it('shares an open that is still running', async () => {
		server('slow', 'http');
		holdOpen = true;

		const starting = registry.mcpTools();
		// The first caller is inside the open; a second one arrives during it.
		await new Promise((resolve) => setTimeout(resolve, 20));
		const also = registry.mcpTools();
		releaseOpen?.();

		await Promise.all([starting, also]);

		expect(opens.http, 'the second caller waited for the open in flight').toBe(1);
	});

	it('opens again after the server was dropped', async () => {
		const item = server('dropped', 'http');

		await registry.mcpTools();
		registry.forgetMcpServer(item.id);
		await registry.mcpTools();

		expect(opens.http).toBe(2);
	});
});
