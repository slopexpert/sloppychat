import type { McpServer, McpServerConfig } from './types';

/**
 * MCP servers are configured in the Cursor and Claude shape:
 *
 *   { "mcpServers": { "files": { "command": "npx", "args": ["-y", "server"] } } }
 *
 * The same shape is accepted here, so a list can be pasted in and out.
 */

export interface ParsedServer {
	name: string;
	config: McpServerConfig;
}

/** Tool ids must match the model's rules, so every other character becomes _ */
export function sanitizeToolPart(value: string): string {
	return (
		value
			.trim()
			.replace(/[^a-zA-Z0-9_-]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 48) || 'server'
	);
}

/** The name the model sees for a tool of a server: <server>_<tool>. */
export function toolIdFor(serverName: string, toolName: string): string {
	return `${sanitizeToolPart(serverName)}_${sanitizeToolPart(toolName)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const list = value.filter((item): item is string => typeof item === 'string');
	return list.length ? list : undefined;
}

function stringMap(value: unknown): Record<string, string> | undefined {
	const record = asRecord(value);
	const entries = Object.entries(record).filter(([, item]) => typeof item === 'string');
	return entries.length ? Object.fromEntries(entries as [string, string][]) : undefined;
}

/** Reads one entry of the Cursor format into the shape the app stores. */
export function configFromCursor(name: string, raw: unknown): ParsedServer | undefined {
	const entry = asRecord(raw);
	const command = typeof entry.command === 'string' ? entry.command.trim() : '';
	const url = typeof entry.url === 'string' ? entry.url.trim() : '';
	const timeout = Number(entry.timeout_ms ?? entry.timeoutMs);
	const shared = Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout } : {};
	if (command) {
		return {
			name: name.trim() || command,
			config: {
				transport: 'stdio',
				command,
				args: stringList(entry.args),
				env: stringMap(entry.env),
				cwd: typeof entry.cwd === 'string' && entry.cwd.trim() ? entry.cwd.trim() : undefined,
				...shared
			}
		};
	}
	if (url) {
		return {
			name: name.trim() || url,
			config: { transport: 'http', url, headers: stringMap(entry.headers), ...shared }
		};
	}
	return undefined;
}

/** Parses a pasted config. A bare map of servers is accepted too. */
export function parseCursorConfig(json: string): ParsedServer[] {
	let body: unknown;
	try {
		body = JSON.parse(json) as unknown;
	} catch {
		throw new Error('That is not valid JSON');
	}
	const record = asRecord(body);
	const servers = asRecord(record.mcpServers ?? record.servers ?? record);
	const parsed: ParsedServer[] = [];
	for (const [name, raw] of Object.entries(servers)) {
		const entry = configFromCursor(name, raw);
		if (entry) parsed.push(entry);
	}
	if (!parsed.length) throw new Error('No server with a command or a url was found');
	return parsed;
}

/** Writes the stored servers back out in the same shape. */
export function toCursorConfig(servers: McpServer[]): string {
	const mcpServers: Record<string, Record<string, unknown>> = {};
	for (const server of servers) {
		const config = server.config;
		if (config.transport === 'stdio') {
			mcpServers[server.name] = {
				command: config.command,
				...(config.args?.length ? { args: config.args } : {}),
				...(config.env ? { env: config.env } : {}),
				...(config.cwd ? { cwd: config.cwd } : {}),
				...(config.timeoutMs ? { timeout_ms: config.timeoutMs } : {})
			};
			continue;
		}
		mcpServers[server.name] = {
			url: config.url,
			...(config.headers ? { headers: config.headers } : {}),
			...(config.timeoutMs ? { timeout_ms: config.timeoutMs } : {})
		};
	}
	return JSON.stringify({ mcpServers }, null, 2);
}
