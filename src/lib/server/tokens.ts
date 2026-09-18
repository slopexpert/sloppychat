import type { ModelInfo, Provider } from '$lib/shared/types';
import { authHeaders } from './openai';

/**
 * Some servers count tokens themselves, and some report the numbers of a
 * generation. The app asks each provider one time which of these it can do, and
 * remembers the answer. A provider without this support keeps the estimate.
 */

export interface TokenSupport {
	/** How the prompt can be counted before it is sent. */
	counter: 'llamacpp' | 'vllm' | 'none';
	/** The server sends the token ids of each stream chunk. */
	tokenIds: boolean;
	/** The server reports its own generation timings, for each token. */
	perToken: boolean;
	/** Context size of the loaded model, when the server reports it. */
	contextLength?: number;
}

const PROBE_TIMEOUT_MS = 2500;

/** Answers are kept per provider and address, so a changed address probes again. */
const cache = new Map<string, TokenSupport>();

/** The server root, without the /v1 suffix the chat endpoints use. */
export function serverRoot(baseUrl: string): string {
	return baseUrl
		.trim()
		.replace(/\/+$/, '')
		.replace(/\/v1$/, '');
}

async function fetchJson(url: string, provider: Provider, init: RequestInit = {}): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			...init,
			headers: { ...authHeaders(provider), ...(init.headers ?? {}) },
			signal: controller.signal
		});
		if (!res.ok) return undefined;
		return (await res.json()) as unknown;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

/** Reads the token ids out of a tokenize answer, with or without the pieces. */
function tokensOf(body: unknown): number[] | undefined {
	const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const tokens = record.tokens;
	if (!Array.isArray(tokens)) return undefined;
	return tokens.map((token) =>
		typeof token === 'number' ? token : Number((token as Record<string, unknown>)?.id ?? NaN)
	);
}

/** What the provider can do. The answer is cached, unless `refresh` is true. */
export async function tokenSupport(provider: Provider, refresh = false): Promise<TokenSupport> {
	const key = `${provider.id} ${provider.baseUrl}`;
	if (!refresh) {
		const hit = cache.get(key);
		if (hit) return hit;
	}
	const support = await probe(provider);
	cache.set(key, support);
	return support;
}

async function probe(provider: Provider): Promise<TokenSupport> {
	const root = serverRoot(provider.baseUrl);
	// llama.cpp answers GET /props with the settings of the loaded model.
	const props = (await fetchJson(`${root}/props`, provider)) as Record<string, unknown> | undefined;
	const settings =
		props && typeof props.default_generation_settings === 'object'
			? (props.default_generation_settings as Record<string, unknown>)
			: undefined;
	const nCtx = Number(settings?.n_ctx ?? props?.n_ctx);
	if (props && (settings || Number.isFinite(nCtx))) {
		return {
			counter: 'llamacpp',
			tokenIds: false,
			perToken: true,
			contextLength: Number.isFinite(nCtx) && nCtx > 0 ? nCtx : undefined
		};
	}
	// vLLM answers POST /tokenize, and reports the prompt on the first chunk.
	if ((await countText(provider, 'count')) !== undefined) {
		return { counter: 'vllm', tokenIds: true, perToken: false };
	}
	return { counter: 'none', tokenIds: false, perToken: false };
}

/** Counts one piece of text, in the shapes the two servers accept. */
async function countText(provider: Provider, text: string): Promise<number | undefined> {
	const root = serverRoot(provider.baseUrl);
	const bodies: Record<string, unknown>[] = [{ content: text }, { model: provider.defaultModel ?? '', prompt: text }];
	for (const body of bodies) {
		const answer = await fetchJson(`${root}/tokenize`, provider, {
			method: 'POST',
			body: JSON.stringify(body)
		});
		const tokens = tokensOf(answer);
		if (tokens) return tokens.length;
	}
	return undefined;
}

/**
 * llama.cpp reports the window of the model it holds, and its model list often
 * leaves the window out. The reported value wins for a single model list, which
 * is what such a server returns.
 */
export function withReportedWindow(models: ModelInfo[], support: TokenSupport): ModelInfo[] {
	const window = support.contextLength;
	if (!window || models.length !== 1) return models;
	return [{ ...models[0], contextLength: window }];
}

/**
 * The exact token count of the prompt a turn will send. llama.cpp renders the
 * prompt with /apply-template first, so the count includes the chat template.
 * vLLM reports the prompt tokens at the start of the turn instead.
 */
export async function countPrompt(provider: Provider, messages: unknown[]): Promise<number | undefined> {
	const support = await tokenSupport(provider);
	if (support.counter !== 'llamacpp') return undefined;
	const root = serverRoot(provider.baseUrl);
	const rendered = (await fetchJson(`${root}/apply-template`, provider, {
		method: 'POST',
		body: JSON.stringify({ messages })
	})) as Record<string, unknown> | undefined;
	const prompt = typeof rendered?.prompt === 'string' ? rendered.prompt : undefined;
	if (!prompt) return undefined;
	return countText(provider, prompt);
}
