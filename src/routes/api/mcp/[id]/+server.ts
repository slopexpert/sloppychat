import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { toMcpDTO } from '$lib/server/dto';
import { deleteMcpServer, getMcpServer, updateMcpServer } from '$lib/server/store';
import { forgetMcpServer } from '$lib/server/mcp/registry';
import type { McpServerConfig } from '$lib/shared/types';

/** One MCP server: rename it, switch it on or off, change its config, remove it. */

export const PATCH = (async ({ params, request }) => {
	if (!getMcpServer(params.id)) return bad('MCP server not found', 404);
	const input = await body<{ name?: string; enabled?: boolean; config?: McpServerConfig }>(request);
	if (input.config && input.config.transport !== 'stdio' && input.config.transport !== 'http') {
		return bad('A config with a transport of stdio or http is required');
	}
	// Any change needs a fresh connection with the new settings.
	forgetMcpServer(params.id);
	const updated = updateMcpServer(params.id, {
		name: input.name?.trim() || undefined,
		enabled: input.enabled,
		config: input.config
	});
	if (!updated) return bad('MCP server not found', 404);
	return Response.json({ server: toMcpDTO(updated) });
}) satisfies RequestHandler;

export const DELETE = (async ({ params }) => {
	if (!getMcpServer(params.id)) return bad('MCP server not found', 404);
	forgetMcpServer(params.id);
	deleteMcpServer(params.id);
	return Response.json({ ok: true });
}) satisfies RequestHandler;
