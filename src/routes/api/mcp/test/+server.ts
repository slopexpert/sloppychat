import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { getMcpServer } from '$lib/server/store';
import { StdioConnection } from '$lib/server/mcp/stdio';
import { HttpConnection } from '$lib/server/mcp/http';

/**
 * Tries a saved server: connect, list the tools and close again. The answer is
 * what the settings window shows next to the Test button. The server reads the
 * stored config itself, so a config with its tokens never travels to the browser.
 */

export const POST = (async ({ request }) => {
	const input = await body<{ id?: string }>(request);
	const id = (input.id ?? '').trim();
	if (!id) return bad('The id of a saved server is required');
	const server = getMcpServer(id);
	if (!server) return bad('MCP server not found', 404);
	const config = server.config;
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
