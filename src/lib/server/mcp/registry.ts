import type { McpServer, McpServerState, McpToolInfo } from '$lib/shared/types';
import { toolIdFor } from '$lib/shared/mcp';
import { listMcpServers } from '../store';
import { HttpConnection } from './http';
import { StdioConnection } from './stdio';
import type { McpCallResult, McpConnection, McpToolDescription } from './types';

/**
 * The live MCP servers. A server is opened when it is first needed, its tools
 * are kept here, and a server that fails is retried after a cooldown, or at once
 * when the user asks. One place holds the connections, so no turn opens two.
 */

interface Live {
	connection?: McpConnection;
	tools: McpToolInfo[];
	failed?: string;
	/** When the last attempt ran, for the cooldown after a failure. */
	attemptedAt: number;
}

const RETRY_AFTER_MS = 30_000;

const live = new Map<string, Live>();
/** Opens that are running, so one server is opened once, not once per caller. */
const opening = new Map<string, Promise<Live>>();

function toolInfo(server: McpServer, tool: McpToolDescription): McpToolInfo {
	const schema = tool.inputSchema;
	return {
		id: toolIdFor(server.name, tool.name),
		serverId: server.id,
		serverName: server.name,
		name: tool.name,
		description: tool.description ?? '',
		parameters:
			schema && typeof schema === 'object'
				? (schema as Record<string, unknown>)
				: { type: 'object', properties: {}, additionalProperties: true }
	};
}

async function open(server: McpServer): Promise<Live> {
	const connection =
		server.config.transport === 'http'
			? await HttpConnection.connect(server)
			: await StdioConnection.connect(server);
	try {
		const tools = (await connection.listTools()).map((tool) => toolInfo(server, tool));
		return { connection, tools, attemptedAt: Date.now() };
	} catch (err) {
		connection.close();
		throw err;
	}
}

/**
 * The live state of one server. A ready connection is reused; a dead one, or an
 * earlier failure whose cooldown has passed, is opened again.
 */
async function ensure(server: McpServer, refresh = false): Promise<Live | undefined> {
	if (!server.enabled) return undefined;
	const current = live.get(server.id);
	if (current && !refresh) {
		if (!current.failed && current.connection?.alive) return current;
		if (current.failed && Date.now() - current.attemptedAt < RETRY_AFTER_MS) return current;
	}
	// An open that is already running is waited for instead of started again: a
	// second stdio server would be a child process that nobody closes.
	const running = opening.get(server.id);
	if (running) return running;
	const attempt = (async (): Promise<Live> => {
		current?.connection?.close();
		try {
			const opened = await open(server);
			live.set(server.id, opened);
			return opened;
		} catch (err) {
			const failed: Live = {
				tools: [],
				failed: err instanceof Error ? err.message : String(err),
				attemptedAt: Date.now()
			};
			live.set(server.id, failed);
			return failed;
		}
	})();
	opening.set(server.id, attempt);
	try {
		return await attempt;
	} finally {
		opening.delete(server.id);
	}
}

/** What the settings window shows: every server, its state, and its tools. */
export async function mcpStates(refresh = false): Promise<McpServerState[]> {
	const servers = listMcpServers();
	const states: McpServerState[] = [];
	for (const server of servers) {
		if (!server.enabled) {
			states.push({ ...server, status: 'stopped', tools: [] });
			continue;
		}
		const state = await ensure(server, refresh);
		states.push({
			...server,
			status: state?.failed ? 'failed' : 'ready',
			error: state?.failed,
			tools: state?.tools ?? []
		});
	}
	return states;
}

/** Every tool of every ready server, which is what the model may call. */
export async function mcpTools(): Promise<McpToolInfo[]> {
	const servers = listMcpServers().filter((server) => server.enabled);
	const states = await Promise.all(servers.map((server) => ensure(server)));
	return states.flatMap((state) => state?.tools ?? []);
}

/** The server and tool behind one id, or nothing when the id is unknown. */
async function locate(id: string): Promise<{ server: McpServer; tool: McpToolInfo } | undefined> {
	const servers = listMcpServers();
	for (const server of servers) {
		const state = await ensure(server);
		const tool = state?.tools.find((item) => item.id === id);
		if (tool) return { server, tool };
	}
	return undefined;
}

export async function callMcpTool(
	id: string,
	args: Record<string, unknown>,
	signal?: AbortSignal
): Promise<McpCallResult> {
	const found = await locate(id);
	if (!found) throw new Error(`No MCP tool named ${id}`);
	const connection = live.get(found.server.id)?.connection;
	if (!connection) throw new Error(`The MCP server ${found.server.name} is not connected`);
	try {
		return await connection.callTool(found.tool.name, args, signal);
	} catch (err) {
		// A server that stopped is opened again the next time it is needed.
		forgetMcpServer(found.server.id);
		throw err;
	}
}

/** Drops the connection of one server, so the next use opens it again. */
export function forgetMcpServer(id: string): void {
	live.get(id)?.connection?.close();
	live.delete(id);
}

/** Closes every connection, used when a server is removed or the app stops. */
export function closeMcpServers(): void {
	for (const state of live.values()) state.connection?.close();
	live.clear();
}
