import { getDocument, getImage } from './store';
import { frameData, sseFrames } from './sse-read';
import { textFileBlock } from '$lib/shared/files';
import type { Message, ModelInfo, Provider, RuntimeTimings, UpstreamTool, Usage } from '$lib/shared/types';

/**
 * Thin client for OpenAI-compatible /chat/completions and /models endpoints.
 * Everything upstream specific lives in this file so providers stay pluggable.
 */

/** How long a provider may take to start answering, in milliseconds. */
const ANSWER_WAIT_MS = 30_000;

/**
 * A wait limit for one request. A provider that is up but busy takes a moment;
 * a provider that is gone would hold the turn open for as long as the process
 * lives. The limit covers the wait for the answer to start: once the answer has
 * started, only the caller ends it.
 */
function waitAnswer(caller?: AbortSignal): { signal: AbortSignal; answered(): void } {
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new Error(`The provider did not answer in ${ANSWER_WAIT_MS / 1000} s`)),
		ANSWER_WAIT_MS
	);
	// The listener goes away with the abort it waits for, and both the signal and
	// this request belong to one turn, so it cannot outlive the turn.
	const onCaller = () => controller.abort(caller?.reason);
	caller?.addEventListener('abort', onCaller, { once: true });
	return {
		signal: controller.signal,
		answered: () => clearTimeout(timer)
	};
}

export interface UpstreamContentPart {
	type: 'text' | 'image_url';
	text?: string;
	image_url?: { url: string };
}

export interface UpstreamMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | UpstreamContentPart[] | null;
	tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
	tool_call_id?: string;
	name?: string;
	reasoning_content?: string;
}

export interface ChatPayload {
	model: string;
	messages: UpstreamMessage[];
	stream: true;
	stream_options?: { include_usage: boolean };
	temperature?: number;
	top_p?: number;
	top_k?: number;
	min_p?: number;
	max_tokens?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
	repetition_penalty?: number;
	seed?: number;
	stop?: string[];
	tools?: UpstreamTool[];
	tool_choice?: 'auto' | 'none' | 'required';
	reasoning_effort?: string;
	/** Allows vendor specific fields from the `extra` parameter blob. */
	[key: string]: unknown;
}

export interface UpstreamChunk {
	content: string;
	reasoning: string;
	/** Completed tool calls, only present once the stream ends. */
	toolCalls: { id: string; name: string; argsText: string }[];
	finishReason: string | null;
	usage?: Usage;
	/** Timing the server reported about its own work, when it sends any. */
	timings?: RuntimeTimings;
	/** Prompt tokens the server counted itself, when it reports them. */
	promptTokens?: number;
	/** Completion tokens counted from the token ids of the stream. */
	completionTokens?: number;
}

function apiUrl(baseUrl: string, path: string): string {
	const base = baseUrl.replace(/\/+$/, '');
	// Accept both "https://host/v1" and a bare "https://host" root.
	return `${base}${path}`;
}

export function authHeaders(provider: Provider): Record<string, string> {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
	return headers;
}

/* --------------------------------------------------------------- model list */

function asRecord(v: unknown): Record<string, unknown> {
	return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Reads the vision hints that different vendors put on a model entry. */
function visionOf(entry: Record<string, unknown>): boolean | undefined {
	const arch = asRecord(entry.architecture);
	const modalities = arch.input_modalities;
	if (Array.isArray(modalities)) return modalities.includes('image');
	const supported = entry.supported_modalities ?? entry.input_modalities;
	if (Array.isArray(supported)) return supported.includes('image');
	const caps = asRecord(entry.capabilities);
	if (typeof caps.vision === 'boolean') return caps.vision;
	return undefined;
}

/**
 * The context window a provider reports, if it reports one at all.
 *
 * The key differs per server: OpenRouter and LM Studio use `context_length`,
 * vLLM `max_model_len`, llama.cpp `meta.n_ctx_train`, and a few put it under
 * `details` or `top_provider`. OpenAI's own API returns none of them, which is
 * the only reason a fallback table exists for the ones that stay silent.
 */
function contextOf(entry: Record<string, unknown>): number | undefined {
	for (const key of ['context_length', 'context_window', 'max_context_length', 'max_model_len']) {
		const value = entry[key];
		if (typeof value === 'number' && value > 0) return value;
	}
	return firstPositive(
		asRecord(entry.details),
		asRecord(entry.meta),
		asRecord(asRecord(entry.top_provider))
	);
}

function firstPositive(...sources: Record<string, unknown>[]): number | undefined {
	for (const source of sources) {
		for (const key of ['context_length', 'max_context_length', 'max_model_len', 'n_ctx_train', 'n_ctx']) {
			const value = source[key];
			if (typeof value === 'number' && value > 0) return value;
		}
	}
	return undefined;
}

export async function listModels(provider: Provider, signal?: AbortSignal): Promise<ModelInfo[]> {
	const wait = waitAnswer(signal);
	const res = await fetch(apiUrl(provider.baseUrl, '/models'), {
		headers: authHeaders(provider),
		signal: wait.signal
	}).finally(() => wait.answered());
	if (!res.ok) throw new Error(await httpError(res, `Model list for ${provider.name}`));
	const body = asRecord(await res.json());
	const raw = body.data ?? body.models ?? body;
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const models: ModelInfo[] = [];
	for (const item of raw) {
		const entry = asRecord(item);
		const id = typeof entry.id === 'string' ? entry.id : typeof entry.name === 'string' ? entry.name : '';
		if (!id || seen.has(id)) continue;
		seen.add(id);
		models.push({
			id,
			name: typeof entry.name === 'string' && entry.name !== id ? entry.name : undefined,
			contextLength: contextOf(entry),
			vision: visionOf(entry)
		});
	}
	models.sort((a, b) => a.id.localeCompare(b.id));
	return models;
}

export async function httpError(res: Response, what: string): Promise<string> {
	const body = (await res.text()).slice(0, 800).trim();
	let detail = body;
	try {
		const parsed = asRecord(JSON.parse(body));
		const err = asRecord(parsed.error);
		if (typeof err.message === 'string') detail = err.message;
	} catch {
		/* keep the raw body */
	}
	const hint =
		res.status === 401 || res.status === 403
			? ' (check the API key)'
			: res.status === 404
				? ' (check the base URL; it usually ends with /v1)'
				: '';
	return `${what} failed: HTTP ${res.status}${hint}${detail ? ` - ${detail}` : ''}`;
}

/* ------------------------------------------------------------- payload build */

function toDataUrl(blob: Uint8Array, mime: string): string {
	return `data:${mime};base64,${Buffer.from(blob).toString('base64')}`;
}

/** Cuts text to the cap and marks that it was cut. */
function clip(text: string, cap: number, mark: string): string {
	return text.length > cap ? `${text.slice(0, cap)}\n\n${mark}` : text;
}

/** Images become inline data URLs: portable across every compatible vendor. */
function userParts(msg: Message, options: { docMaxChars: number; textMaxChars: number }): UpstreamContentPart[] | string {
	const docParts: UpstreamContentPart[] = [];
	for (const ref of msg.documents ?? []) {
		const stored = getDocument(ref.id);
		const text = stored?.text.trim();
		if (!text) continue;
		// A PDF always has pages, so a document without them is a text or code file.
		docParts.push(
			ref.pages > 0
				? {
						type: 'text',
						text: `Extracted text of the attached document "${ref.name}" (${ref.pages} pages):\n\n${clip(text, options.docMaxChars, '[document text truncated]')}`
					}
				: { type: 'text', text: textFileBlock(ref.name, text, options.textMaxChars) }
		);
	}
	if (!msg.images.length && !docParts.length) return msg.text;
	const parts: UpstreamContentPart[] = [];
	if (msg.text) parts.push({ type: 'text', text: msg.text });
	parts.push(...docParts);
	for (const ref of msg.images) {
		const image = getImage(ref.id);
		if (image) parts.push({ type: 'image_url', image_url: { url: toDataUrl(image.blob, image.mime) } });
	}
	return parts;
}

/**
 * Maps stored rows to the upstream array. Assistant tool calls are kept so the
 * tool round trip stays valid, and half finished calls are dropped because most
 * vendors reject a tool call that has no matching result.
 */
export function toUpstreamMessages(
	messages: Message[],
	options: { docMaxChars?: number; textMaxChars?: number } = {}
): UpstreamMessage[] {
	const docMaxChars = options.docMaxChars ?? 12000;
	const textMaxChars = options.textMaxChars ?? 20000;
	const answered = new Set(
		messages.filter((m) => m.role === 'tool' && m.toolCallId).map((m) => m.toolCallId as string)
	);
	const called = new Set<string>();
	for (const msg of messages) {
		if (msg.role !== 'assistant') continue;
		for (const call of msg.toolCalls ?? []) if (call.id) called.add(call.id);
	}

	const out: UpstreamMessage[] = [];
	for (const msg of messages) {
		if (msg.role === 'tool') {
			if (!msg.toolCallId || !called.has(msg.toolCallId)) continue;
			out.push({ role: 'tool', tool_call_id: msg.toolCallId, name: msg.toolName, content: msg.text });
			continue;
		}
		if (msg.role === 'assistant') {
			const calls = (msg.toolCalls ?? []).filter((c) => c.id && c.name && answered.has(c.id));
			if (!msg.text && !calls.length) continue;
			const entry: UpstreamMessage = { role: 'assistant', content: msg.text || null };
			if (calls.length) {
				entry.tool_calls = calls.map((c) => ({
					id: c.id,
					type: 'function' as const,
					function: { name: c.name, arguments: jsonArgs(c.args) }
				}));
			}
			if (msg.reasoning) entry.reasoning_content = msg.reasoning;
			out.push(entry);
			continue;
		}
		if (msg.role === 'system') {
			if (msg.text) out.push({ role: 'system', content: msg.text });
			continue;
		}
		out.push({ role: 'user', content: userParts(msg, { docMaxChars, textMaxChars }) });
	}
	return out;
}

function jsonArgs(args: unknown): string {
	if (typeof args === 'string') return args;
	if (args && typeof args === 'object') return JSON.stringify(args);
	return '{}';
}


/* ------------------------------------------------------------------ streaming */

/** Yields the JSON payload of each `data:` line of an SSE response body. */
export async function* sseData(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
	for await (const frame of sseFrames(res, signal)) {
		for (const payload of frameData(frame)) {
			if (payload !== '[DONE]') yield payload;
		}
	}
}

/**
 * Reads the timing report a server includes about its own work. llama.cpp puts
 * it in `timings`, vLLM (with --enable-per-request-metrics) in `metrics`.
 * Rates from here are better than wall clock: they exclude the network and,
 * for llama.cpp, describe the tokens it actually had to process.
 */
function readRuntimeTimings(chunk: Record<string, unknown>): RuntimeTimings | undefined {
	const out: Partial<RuntimeTimings> = {};

	const timings = asRecord(chunk.timings);
	if (Object.keys(timings).length) {
		out.source = 'llamacpp';
		out.ppRate = num(timings.prompt_per_second);
		out.tgRate = num(timings.predicted_per_second);
		out.prompt = num(timings.prompt_n);
		out.completion = num(timings.predicted_n);
		out.cachedPrompt = num(timings.cache_n);
		out.ttftMs = num(timings.prompt_ms);
		out.decodeMs = num(timings.predicted_ms);
	}

	const metrics = asRecord(chunk.metrics);
	if (Object.keys(metrics).length) {
		out.source = 'vllm';
		// TTFT here is prefill only, queue wait is reported separately.
		out.ttftMs = num(metrics.time_to_first_token_ms) ?? out.ttftMs;
		out.decodeMs = num(metrics.generation_time_ms) ?? out.decodeMs;
		out.queueMs = num(metrics.queue_time_ms);
		const itl = num(metrics.mean_itl_ms);
		if (itl && itl > 0) out.tgRate = 1000 / itl;
	}

	return Object.keys(out).length ? (out as RuntimeTimings) : undefined;
}

interface PendingCall {
	id: string;
	name: string;
	args: string;
}

/**
 * Posts a streaming chat request and folds the delta stream into one UpstreamChunk
 * result while handing each incremental piece to `onDelta`.
 */
export async function streamChat(
	provider: Provider,
	payload: ChatPayload,
	onDelta: (delta: { content?: string; reasoning?: string; tokens?: number }) => void,
	signal?: AbortSignal
): Promise<UpstreamChunk> {
	const wait = waitAnswer(signal);
	const res = await fetch(apiUrl(provider.baseUrl, '/chat/completions'), {
		method: 'POST',
		headers: authHeaders(provider),
		body: JSON.stringify(payload),
		signal: wait.signal
	}).finally(() => wait.answered());
	if (!res.ok) throw new Error(await httpError(res, `Request to ${provider.name}`));

	const contentType = res.headers.get('content-type') ?? '';
	const calls: PendingCall[] = [];
	let content = '';
	let reasoning = '';
	let finishReason: string | null = null;
	let usage: Usage | undefined;
	let timings: RuntimeTimings | undefined;
	// Exact counts, when the server reports token ids or per token timings.
	let countedPrompt: number | undefined;
	let countedCompletion: number | undefined;
	let predictedTotal = 0;

	/**
	 * Folds one chunk into the running result. Deltas are handed to the caller
	 * immediately, which is what makes the answer appear token by token.
	 */
	const handleChunk = (chunk: Record<string, unknown>): void => {
		const error = asRecord(chunk.error);
		if (typeof error.message === 'string') throw new Error(error.message);
		const rawUsage = asRecord(chunk.usage);
		if (Object.keys(rawUsage).length) {
			usage = {
				prompt: num(rawUsage.prompt_tokens),
				completion: num(rawUsage.completion_tokens),
				total: num(rawUsage.total_tokens)
			};
		}
		const choice = asRecord(Array.isArray(chunk.choices) ? chunk.choices[0] : undefined);
		if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
		timings = readRuntimeTimings(chunk) ?? timings;

		// vLLM sends the prompt ids on the first chunk and the ids of the generated
		// tokens on every chunk, which is an exact count while the answer streams.
		const promptIds = chunk.prompt_token_ids;
		if (Array.isArray(promptIds) && countedPrompt === undefined) countedPrompt = promptIds.length;
		const deltaIds = chunk.token_ids;
		let chunkTokens = Array.isArray(deltaIds) ? deltaIds.length : 0;
		// llama.cpp reports a running total per token with timings_per_token, so
		// the difference from the last chunk is the count for this one.
		if (!chunkTokens && timings?.completion !== undefined) {
			const step = timings.completion - predictedTotal;
			if (step > 0) chunkTokens = step;
			predictedTotal = timings.completion;
		}
		if (chunkTokens) {
			countedCompletion = (countedCompletion ?? 0) + chunkTokens;
			onDelta({ tokens: chunkTokens });
		}

		const delta = asRecord(choice.delta);
		const message = asRecord(choice.message);
		// Streaming chunks use delta, a plain JSON answer uses message.
		const source = Object.keys(delta).length ? delta : message;
		const piece = text(source.content);
		if (piece) {
			content += piece;
			onDelta({ content: piece });
		}
		const thought = text(source.reasoning_content) ?? text(source.reasoning) ?? text(source.reasoning_text);
		if (thought) {
			reasoning += thought;
			onDelta({ reasoning: thought });
		}
		const toolDeltas = source.tool_calls;
		if (Array.isArray(toolDeltas)) {
			for (const item of toolDeltas) {
				const raw = asRecord(item);
				const index = typeof raw.index === 'number' ? raw.index : calls.length;
				const fn = asRecord(raw.function);
				const slot = calls[index] ?? (calls[index] = { id: '', name: '', args: '' });
				if (typeof raw.id === 'string') slot.id = raw.id;
				if (typeof fn.name === 'string') slot.name += fn.name;
				if (typeof fn.arguments === 'string') slot.args += fn.arguments;
			}
		}
	};

	if (contentType.includes('text/event-stream')) {
		for await (const data of sseData(res, signal)) {
			let chunk: Record<string, unknown>;
			try {
				chunk = JSON.parse(data) as Record<string, unknown>;
			} catch {
				continue;
			}
			handleChunk(chunk);
		}
	} else {
		// Some gateways answer with one JSON object even when asked to stream.
		const raw = await res.text();
		try {
			handleChunk(JSON.parse(raw) as Record<string, unknown>);
		} catch (err) {
			if (err instanceof SyntaxError) throw new Error('The provider sent a body that is not JSON');
			throw err;
		}
	}

	return {
		content,
		reasoning,
		finishReason,
		usage,
		timings,
		// A count from the stream wins over the running total of the timings.
		promptTokens: countedPrompt ?? timings?.prompt,
		completionTokens: countedCompletion ?? timings?.completion,
		toolCalls: calls
			.filter((c) => c && c.name)
			.map((c, i) => ({ id: c.id || `call_${i + 1}`, name: c.name, argsText: c.args || '{}' }))
	};
}

function text(v: unknown): string | null {
	return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | undefined {
	return typeof v === 'number' ? v : undefined;
}
