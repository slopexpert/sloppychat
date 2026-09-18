import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { McpServer } from '$lib/shared/types';
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
 * A connection to a server that runs as a child process and speaks JSON-RPC,
 * one message per line. Lines that are not JSON are log output and are ignored.
 * A process that stops is noticed, and the caller connects again.
 */

interface Pending {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class StdioConnection implements McpConnection {
	readonly kind = 'stdio' as const;
	#child: ChildProcess;
	#pending = new Map<number, Pending>();
	#nextId = 1;
	#closed = false;
	#stderr = '';
	#timeoutMs: number;

	private constructor(child: ChildProcess, timeoutMs: number) {
		this.#child = child;
		this.#timeoutMs = timeoutMs;
		this.#child.stderr?.on('data', (part) => {
			// Kept for the error message when the server fails to start.
			this.#stderr = `${this.#stderr}${part}`.slice(-800);
		});
		this.#child.on('exit', () => this.#failAll(new Error(this.#stopMessage())));
		this.#child.on('error', (error) => this.#failAll(error));
		const lines = createInterface({ input: this.#child.stdout ?? process.stdin });
		lines.on('line', (line) => this.#handleLine(line));
	}

	get alive(): boolean {
		return !this.#closed && this.#child.exitCode === null && !this.#child.killed;
	}

	/** Starts the process and completes the handshake. */
	static async connect(server: McpServer, signal?: AbortSignal): Promise<StdioConnection> {
		const config = server.config;
		const command = (config.command ?? '').trim();
		if (!command) throw new Error(`${server.name} has no command`);
		const child = spawn(command, config.args ?? [], {
			cwd: config.cwd || undefined,
			env: { ...process.env, ...(config.env ?? {}) },
			stdio: ['pipe', 'pipe', 'pipe']
		});
		const connection = new StdioConnection(child, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		// The handshake proves the server speaks the protocol before it is used.
		await connection.request(
			'initialize',
			{
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				clientInfo: { name: 'sloppychat', version: '0.1' }
			},
			signal
		);
		connection.notify('notifications/initialized');
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
		if (this.#closed) return;
		this.#closed = true;
		this.#failAll(new Error(`${this.#stopMessage()}`));
		this.#child.kill('SIGKILL');
	}

	#stopMessage(): string {
		const detail = this.#stderr.trim().split('\n').slice(-2).join(' ').trim();
		return `The MCP server stopped${detail ? `: ${detail}` : ''}`;
	}

	#failAll(error: Error): void {
		for (const [, pending] of this.#pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.#pending.clear();
	}

	#handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		let message: JsonRpcReply;
		try {
			message = JSON.parse(trimmed) as JsonRpcReply;
		} catch {
			// Server logging on stdout. It is not a reply, so it is not a problem.
			return;
		}
		const id = typeof message.id === 'number' ? message.id : Number(message.id);
		const pending = Number.isFinite(id) ? this.#pending.get(id) : undefined;
		if (!pending) return;
		this.#pending.delete(id);
		clearTimeout(pending.timer);
		if (message.error) pending.reject(replyError(message, 'The MCP request'));
		else pending.resolve(message.result);
	}

	#write(message: unknown): void {
		if (!this.alive) throw new Error(this.#stopMessage());
		this.#child.stdin?.write(`${JSON.stringify(message)}\n`);
	}

	notify(method: string, params?: unknown): void {
		this.#write({ jsonrpc: '2.0', method, params });
	}

	request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.alive) {
				reject(new Error(this.#stopMessage()));
				return;
			}
			const id = this.#nextId++;
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error(`The MCP server did not answer ${method} in ${this.#timeoutMs} ms`));
			}, this.#timeoutMs);
			const onAbort = () => {
				this.#pending.delete(id);
				clearTimeout(timer);
				reject(new Error('The MCP request was cancelled'));
			};
			signal?.addEventListener('abort', onAbort, { once: true });
			this.#pending.set(id, {
				resolve: (value) => {
					signal?.removeEventListener('abort', onAbort);
					resolve(value);
				},
				reject: (error) => {
					signal?.removeEventListener('abort', onAbort);
					reject(error);
				},
				timer
			});
			try {
				this.#write({ jsonrpc: '2.0', id, method, params });
			} catch (error) {
				this.#pending.delete(id);
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}
}
