import type { McpServer, McpServerConfig } from '$lib/shared/types';

/** One tool as its server describes it. */
export interface McpToolDescription {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

/** A block of a tool result. Other types are kept as they arrive. */
export type McpContentBlock =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType?: string }
	| { type: string; [key: string]: unknown };

export interface McpCallResult {
	content: McpContentBlock[];
	isError?: boolean;
}

/** A live connection to one server, over stdio or over HTTP. */
export interface McpConnection {
	readonly kind: McpServerConfig['transport'];
	/** False when the process or the endpoint went away, so the caller reconnects. */
	readonly alive: boolean;
	listTools(): Promise<McpToolDescription[]>;
	callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>;
	close(): void;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const PROTOCOL_VERSION = '2025-06-18';

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id?: number;
	method: string;
	params?: unknown;
}

export interface JsonRpcReply {
	jsonrpc?: string;
	id?: number | string | null;
	result?: unknown;
	error?: { code?: number; message?: string };
}

/** The message a failed call carries, whichever shape the server uses. */
export function replyError(reply: JsonRpcReply, what: string): Error {
	const message = reply.error?.message ?? `${what} failed`;
	return new Error(message);
}

export function serverLabel(server: McpServer): string {
	const config = server.config;
	return config.transport === 'stdio' ? `${config.command ?? ''}`.trim() || server.name : (config.url ?? server.name);
}
