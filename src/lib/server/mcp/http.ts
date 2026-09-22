import type { McpServer } from '$lib/shared/types';
import { frameData, sseFrames } from '../sse-read';
import {
	DEFAULT_TIMEOUT_MS,
	PROTOCOL_VERSION,
	replyError,
	type JsonRpcReply,
	type McpCallResult,
	type McpConnection,
	type McpToolDescription
} from './types';

/**
 * A connection to a server that answers over Streamable HTTP. A reply comes as
 * one JSON body or as an event stream, and the session header of the handshake
 * is sent with every later request.
 */

export class HttpConnection implements McpConnection {
	readonly kind = 'http' as const;
	#url: string;
	#headers: Record<string, string>;
	#session?: string;
	#timeoutMs: number;
	#closed = false;
	#nextId = 1;

	private constructor(url: string, headers: Record<string, string>, timeoutMs: number) {
		this.#url = url;
		this.#headers = headers;
		this.#timeoutMs = timeoutMs;
	}

	get alive(): boolean {
		return !this.#closed;
	}

	static async connect(server: McpServer, signal?: AbortSignal): Promise<HttpConnection> {
		const config = server.config;
		const url = (config.url ?? '').trim();
		if (!url) throw new Error(`${server.name} has no url`);
		const connection = new HttpConnection(url, config.headers ?? {}, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		await connection.request(
			'initialize',
			{
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				clientInfo: { name: 'sloppychat', version: '0.1' }
			},
			signal
		);
		// A notification has no reply, so a failure here is not fatal.
		await connection.#post({ jsonrpc: '2.0', method: 'notifications/initialized' }, signal).catch(() => undefined);
		return connection;
	}

	async listTools(): Promise<McpToolDescription[]> {
		const result = (await this.request('tools/list', {})) as { tools?: unknown };
		const tools = Array.isArray(result?.tools) ? result.tools : [];
		return tools.flatMap((item) => {
			const tool = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
			const name = typeof tool.name === 'string' ? tool.name : '';
			if (!name) return [];
			return [
				{
					name,
					description: typeof tool.description === 'string' ? tool.description : undefined,
					inputSchema: tool.inputSchema
				}
			];
		});
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<McpCallResult> {
		const result = (await this.request('tools/call', { name, arguments: args }, signal)) as McpCallResult;
		return {
			content: Array.isArray(result?.content) ? result.content : [],
			isError: result?.isError === true
		};
	}

	close(): void {
		this.#closed = true;
	}

	async request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
		const id = this.#nextId++;
		const reply = await this.#post({ jsonrpc: '2.0', id, method, params }, signal);
		if (!reply) throw new Error(`The MCP server did not answer ${method}`);
		if (reply.error) throw replyError(reply, `The MCP request ${method}`);
		return reply.result;
	}

	/** Sends one request and reads the reply, whichever way it arrives. */
	async #post(message: unknown, signal?: AbortSignal): Promise<JsonRpcReply | undefined> {
		if (this.#closed) throw new Error('The MCP connection is closed');
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
		const onAbort = () => controller.abort();
		signal?.addEventListener('abort', onAbort, { once: true });
		try {
			const res = await fetch(this.#url, {
				method: 'POST',
				headers: {
					...this.#headers,
					'content-type': 'application/json',
					// A Streamable HTTP server may answer with either of these.
					accept: 'application/json, text/event-stream',
					...(this.#session ? { 'mcp-session-id': this.#session } : {})
				},
				body: JSON.stringify(message),
				signal: controller.signal
			});
			const session = res.headers.get('mcp-session-id');
			if (session) this.#session = session;
			if (!res.ok) {
				const detail = (await res.text().catch(() => '')).slice(0, 200).trim();
				throw new Error(`The MCP server answered HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
			}
			const type = (res.headers.get('content-type') ?? '').toLowerCase();
			if (type.includes('text/event-stream')) return await readEventStream(res);
			const body = (await res.json().catch(() => undefined)) as JsonRpcReply | undefined;
			return body;
		} catch (err) {
			if (controller.signal.aborted && !signal?.aborted) {
				throw new Error(`The MCP server did not answer in ${this.#timeoutMs} ms`);
			}
			throw err;
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
		}
	}
}

/** Reads the reply out of an event stream. A notification carries no id. */
async function readEventStream(res: Response): Promise<JsonRpcReply | undefined> {
	let last: JsonRpcReply | undefined;
	for await (const frame of sseFrames(res)) {
		for (const body of frameData(frame)) {
			try {
				const parsed = JSON.parse(body) as JsonRpcReply;
				if (parsed.id !== undefined) return parsed;
				last = parsed;
			} catch {
				/* keep reading: a server may send keep alive comments */
			}
		}
	}
	return last;
}
