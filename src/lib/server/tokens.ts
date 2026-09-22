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
	/** The server can continue an answer that is already partly written. */
	continueFinal: boolean;
	/** Context size of the loaded model, when the server reports it. */
	contextLength?: number;
}

const PROBE_TIMEOUT_MS = 2500;

/** Answers are kept per provider and address, so a changed address probes again. */
const cache = new Map<string, TokenSupport>();

/** What the app does when the provider cannot count anything. */
const NO_SUPPORT: TokenSupport = {
	counter: 'none',
	tokenIds: false,
	perToken: false,
	continueFinal: false
};

/** The server root, without the /v1 suffix the chat endpoints use. */
export function serverRoot(baseUrl: string): string {
	return baseUrl
		.trim()
		.replace(/\/+$/, '')
		.replace(/\/v1$/, '');
}

/**
 * Asks one thing of the server. `seen` records that the server answered at all,
 * which is not the same as an answer that helped: a plain server that says no to
 * every probe is present, and a server that is down is not.
 */
async function fetchJson(
	url: string,
	provider: Provider,
	seen: { reached: boolean },
	init: RequestInit = {}
): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			...init,
			headers: { ...authHeaders(provider), ...(init.headers ?? {}) },
			signal: controller.signal
		});
		seen.reached = true;
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

/**
 * What the provider can do. The answer is cached, unless `refresh` is true. A
 * provider that did not answer is not a provider without support, so that answer
 * is not kept: the next turn asks again instead of living with it.
 */
export async function tokenSupport(provider: Provider, refresh = false): Promise<TokenSupport> {
	const key = `${provider.id} ${provider.baseUrl}`;
	if (!refresh) {
		const hit = cache.get(key);
		if (hit) return hit;
	}
	const probed = await probe(provider);
	if (!probed) return NO_SUPPORT;
	cache.set(key, probed);
	return probed;
}

async function probe(provider: Provider): Promise<TokenSupport | undefined> {
	const seen = { reached: false };
	const root = serverRoot(provider.baseUrl);
	// llama.cpp answers GET /props with the settings of the loaded model.
	const props = (await fetchJson(`${root}/props`, provider, seen)) as Record<string, unknown> | undefined;
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
			// llama.cpp continues a partial assistant message like the Claude API does.
			continueFinal: false,
			contextLength: Number.isFinite(nCtx) && nCtx > 0 ? nCtx : undefined
		};
	}
	// vLLM answers POST /tokenize, reports the prompt on the first chunk, and can
	// continue a partial answer with continue_final_message.
	if ((await countText(provider, 'count', seen)) !== undefined) {
		return { counter: 'vllm', tokenIds: true, perToken: false, continueFinal: true };
	}
	// Nothing was heard at all: say nothing rather than remember the wrong thing.
	return seen.reached ? NO_SUPPORT : undefined;
}

/** Counts one piece of text, in the shapes the two servers accept. */
async function countText(
	provider: Provider,
	text: string,
	seen: { reached: boolean } = { reached: false }
): Promise<number | undefined> {
	const root = serverRoot(provider.baseUrl);
	const bodies: Record<string, unknown>[] = [{ content: text }, { model: provider.defaultModel ?? '', prompt: text }];
	for (const body of bodies) {
		const answer = await fetchJson(`${root}/tokenize`, provider, seen, {
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
	const rendered = (await fetchJson(`${root}/apply-template`, provider, { reached: false }, {
		method: 'POST',
		body: JSON.stringify({ messages })
	})) as Record<string, unknown> | undefined;
	const prompt = typeof rendered?.prompt === 'string' ? rendered.prompt : undefined;
	if (!prompt) return undefined;
	return countText(provider, prompt);
}
