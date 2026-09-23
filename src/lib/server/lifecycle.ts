import { closeMcpServers } from './mcp/registry';
import { onStop } from './shutdown';

let armed = false;

/**
 * Closes the child processes of the MCP servers when this process stops. A stdio
 * server is a child of the app, so a stop that ignores it leaves the child behind
 * with an input pipe that no one will write again, and a restart adds another.
 *
 * The app has one server entry, `hooks.server.ts`, so arming happens on its first
 * request, which is before any request could open a child. A second call does
 * nothing, because the request hook runs once per request.
 */
export function armShutdown(target: NodeJS.Process = process): void {
	if (armed) return;
	armed = true;
	onStop(closeMcpServers, target);
}
