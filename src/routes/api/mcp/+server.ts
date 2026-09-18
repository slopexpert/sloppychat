import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { parseCursorConfig } from '$lib/shared/mcp';
import { createMcpServer } from '$lib/server/store';
import { mcpStates } from '$lib/server/mcp/registry';
import type { McpServerConfig } from '$lib/shared/types';

/**
 * The MCP servers. GET reports each server with its state and its tools, and
 * POST adds one, either from a single entry or from a pasted Cursor config.
 */

export const GET = (async ({ url }) => {
	const refresh = url.searchParams.get('refresh') === '1';
	return Response.json({ servers: await mcpStates(refresh) });
}) satisfies RequestHandler;

export const POST = (async ({ request }) => {
	const input = await body<{ name?: string; config?: McpServerConfig; json?: string }>(request);
	if (typeof input.json === 'string') {
		let parsed;
		try {
			parsed = parseCursorConfig(input.json);
		} catch (err) {
			return bad(err instanceof Error ? err.message : 'That config could not be read');
		}
		const servers = parsed.map((entry) => createMcpServer({ name: entry.name, config: entry.config }));
		return Response.json({ servers }, { status: 201 });
	}
	const name = (input.name ?? '').trim();
	const config = input.config;
	if (!name) return bad('A server name is required');
	if (!config || (config.transport !== 'stdio' && config.transport !== 'http')) {
		return bad('A config with a transport of stdio or http is required');
	}
	if (config.transport === 'stdio' && !config.command?.trim()) return bad('A command is required');
	if (config.transport === 'http' && !config.url?.trim()) return bad('A url is required');
	const server = createMcpServer({ name, config });
	return Response.json({ server }, { status: 201 });
}) satisfies RequestHandler;
