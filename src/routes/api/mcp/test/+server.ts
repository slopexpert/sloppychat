import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { StdioConnection } from '$lib/server/mcp/stdio';
import { HttpConnection } from '$lib/server/mcp/http';
import type { McpServerConfig } from '$lib/shared/types';

/**
 * Tries a config before it is saved: connect, list the tools and close again.
 * The answer is what the settings window shows next to the Test button.
 */

export const POST = (async ({ request }) => {
	const input = await body<{ name?: string; config?: McpServerConfig }>(request);
	const config = input.config;
	if (!config) return bad('A config is required');
	const server = {
		id: 'test',
		name: input.name?.trim() || 'test',
		enabled: true,
		config,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	};
	const connection =
		config.transport === 'http' ? await HttpConnection.connect(server).catch((err) => err) : await StdioConnection.connect(server).catch((err) => err);
	if (connection instanceof Error) return bad(connection.message, 502);
	try {
		const tools = await connection.listTools();
		return Response.json({ tools });
	} catch (err) {
		return bad(err instanceof Error ? err.message : 'The server did not list its tools', 502);
	} finally {
		connection.close();
	}
}) satisfies RequestHandler;
