import type { Message, Usage } from './types';

/** Throughput helpers for the numbers shown under an answer. */

export interface Rates {
	/** Prefill speed: prompt tokens per second. */
	pp?: number;
	/** Generation speed: completion tokens per second. */
	tg?: number;
	ttftMs?: number;
	decodeMs?: number;
}

function perSecond(tokens: number | undefined, ms: number | undefined): number | undefined {
	if (!tokens || !ms || ms <= 0) return undefined;
	return tokens / (ms / 1000);
}

/** Tokens per second over a window, used for prefill as well as decode. */
export function ratePerSecond(tokens: number, ms: number): number | undefined {
	return perSecond(tokens, ms);
}

export function ratesOf(usage: Usage | undefined): Rates {
	if (!usage) return {};
	return {
		// Rates the server measured itself beat anything this app can time.
		pp: usage.ppRate ?? perSecond(usage.prompt, usage.ttftMs),
		tg: usage.tgRate ?? perSecond(usage.completion, usage.decodeMs),
		ttftMs: usage.ttftMs,
		decodeMs: usage.decodeMs
	};
}

function round(value: number): string {
	if (value >= 100) return value.toFixed(0);
	if (value >= 10) return value.toFixed(1);
	return value.toFixed(2);
}

export function formatRate(value: number | undefined): string | undefined {
	return value === undefined ? undefined : `${round(value)} tok/s`;
}

export function formatSeconds(ms: number | undefined): string | undefined {
	if (ms === undefined) return undefined;
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${round(ms / 1000)} s`;
}

/**
 * One line for a finished answer, for example
 * "pp 1280 tok/s / tg 42.5 tok/s / ttft 0.31 s / 96 tok".
 * Missing measurements are left out instead of shown as zero.
 */
export function formatUsageLine(usage: Usage | undefined): string {
	if (!usage) return '';
	const rates = ratesOf(usage);
	const parts: string[] = [];
	const pp = formatRate(rates.pp);
	const tg = formatRate(rates.tg);
	if (pp) parts.push(`pp ${pp}`);
	if (tg) parts.push(`tg ${tg}`);
	const ttft = formatSeconds(rates.ttftMs);
	if (ttft) parts.push(`ttft ${ttft}`);
	if (usage.completion) parts.push(`${usage.completion} tok${usage.estimated ? ' est' : ''}`);
	// Marks that the numbers come from the server, not from wall clock here.
	if (usage.reported && (rates.pp !== undefined || rates.tg !== undefined)) parts.push('server');
	return parts.join(' / ');
}

/**
 * The short version shown without hovering: how fast the answer was generated
 * and how long it was. The full breakdown lives in the tooltip.
 */
export function formatBriefStats(usage: Usage | undefined): string {
	if (!usage) return '';
	const rates = ratesOf(usage);
	const parts: string[] = [];
	const tg = formatRate(rates.tg);
	if (tg) parts.push(tg);
	if (usage.completion) parts.push(`${usage.completion} tok`);
	return parts.join(' · ');
}

/**
 * The prefill figure kept under the message that asked for the answer: the speed
 * the prompt was read at. Time to first token stays in the tooltip, which is
 * where the rest of the breakdown lives.
 */
export function formatPrefillStats(usage: Usage | undefined): string {
	if (!usage) return '';
	return formatRate(ratesOf(usage).pp) ?? '';
}

/** Tooltip for the statistics line, explaining where the numbers came from. */
export function usageTooltip(usage: Usage | undefined): string {
	if (!usage) return '';
	const notes: string[] = [];
	notes.push(
		usage.reported
			? 'pp and tg reported by the server for its own work'
			: 'pp and tg measured around the HTTP call'
	);
	if (usage.queueMs !== undefined) notes.push(`queue wait ${formatSeconds(usage.queueMs)}`);
	if (usage.cachedPrompt) notes.push(`${usage.cachedPrompt} prompt tokens from the prefix cache`);
	if (usage.estimated) notes.push('token counts estimated from text length');
	return notes.join('; ');
}

/** Live estimate while a stream is running, from characters received so far. */
export function liveRate(chars: number, ms: number): number | undefined {
	if (chars <= 0 || ms <= 0) return undefined;
	return chars / 4 / (ms / 1000);
}

/* ------------------------------------------------------------ context gauge */

/** Rough token cost of one image, used only when no usage report covers it. */
const IMAGE_TOKENS = 750;
const CHARS_PER_TOKEN = 4;

function estimateMessage(message: Message): number {
	const chars = message.text.length + (message.reasoning?.length ?? 0);
	return Math.ceil(chars / CHARS_PER_TOKEN) + message.images.length * IMAGE_TOKENS;
}

function estimateText(text: string | null | undefined): number {
	return text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0;
}

export interface ContextUsage {
	/** Tokens in the conversation as far as we can tell. */
	used: number;
	/** The model window, when the provider reports one. */
	window?: number;
	/** used divided by window, when the window is known. */
	ratio?: number;
	/** True when a real usage report is behind the count. */
	measured: boolean;
	/** True when the provider counted the prompt itself. */
	exact?: boolean;
}

/**
 * How full the context window is.
 *
 * A usage report from the last turn is authoritative for everything up to that
 * message, so only the messages after it are estimated. Without any report the
 * whole conversation is estimated from its length.
 */
export function contextUsage(input: {
	messages: Message[];
	system?: string | null;
	window?: number;
	/** Exact prompt tokens the provider counted for the whole prompt. */
	exact?: number | null;
}): ContextUsage {
	// A count from the provider's own tokenizer covers the system prompt and every
	// message, so nothing else has to be estimated.
	if (typeof input.exact === 'number' && input.exact > 0) {
		const window = input.window;
		return {
			used: input.exact,
			window,
			ratio: window && window > 0 ? input.exact / window : undefined,
			measured: true,
			exact: true
		};
	}
	const messages = input.messages;
	let lastReport = -1;
	for (let at = messages.length - 1; at >= 0; at--) {
		const usage = messages[at].usage;
		if (usage && (usage.prompt || usage.completion)) {
			lastReport = at;
			break;
		}
	}

	let used = 0;
	let measured = false;
	if (lastReport >= 0) {
		const usage = messages[lastReport].usage ?? {};
		// The measured prompt already contains the system prompt and history.
		used = (usage.prompt ?? 0) + (usage.completion ?? 0);
		measured = true;
		for (const message of messages.slice(lastReport + 1)) used += estimateMessage(message);
	} else {
		used = estimateText(input.system);
		for (const message of messages) used += estimateMessage(message);
	}

	const window = input.window;
	return {
		used,
		window,
		ratio: window && window > 0 ? used / window : undefined,
		measured
	};
}

/** Compact token counts for tight spaces: 980, 12.8k, 128k, 1.05M. */
export function formatTokens(tokens: number | undefined): string {
	if (tokens === undefined) return '';
	if (tokens < 1000) return String(tokens);
	if (tokens < 1_000_000) {
		// Keep one decimal so 12.8k does not turn into 13k.
		const k = tokens / 1000;
		return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
	}
	return `${(tokens / 1_000_000).toFixed(2)}M`;
}
