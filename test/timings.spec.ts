import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from '$lib/server/openai';
import type { Provider } from '$lib/shared/types';

/**
 * Servers can report their own timings. llama.cpp puts them in `timings`,
 * vLLM (behind --enable-per-request-metrics) in `metrics`. Those numbers beat
 * anything measured around the HTTP call, so they must be picked up.
 */

const provider: Provider = {
	id: 'p1',
	name: 'Local',
	baseUrl: 'http://127.0.0.1:8080/v1',
	apiKey: '',
	kind: 'openai',
	defaultModel: null,
	enabled: true,
	sort: 0,
	createdAt: new Date(0).toISOString()
};

function sseResponse(chunks: unknown[]): Response {
	const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
	return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

async function run(chunks: unknown[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => sseResponse(chunks))
	);
	const deltas: string[] = [];
	const tokens: number[] = [];
	const result = await streamChat(provider, { model: 'm', messages: [], stream: true }, (delta) => {
		if (delta.content) deltas.push(delta.content);
		if (delta.tokens) tokens.push(delta.tokens);
	});
	return { result, deltas, tokens };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('llama.cpp timings', () => {
	it('reads the timing block from the final chunk', async () => {
		const { result, deltas } = await run([
			{ choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] },
			{
				choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
				timings: {
					cache_n: 236,
					prompt_n: 1,
					prompt_ms: 30.958,
					prompt_per_token_ms: 30.958,
					prompt_per_second: 32.3018,
					predicted_n: 35,
					predicted_ms: 661.064,
					predicted_per_token_ms: 18.887,
					predicted_per_second: 52.9449
				}
			},
			{ choices: [], usage: { prompt_tokens: 237, completion_tokens: 35, total_tokens: 272 } }
		]);

		expect(deltas).toEqual(['hi']);
		expect(result.timings).toEqual({
			source: 'llamacpp',
			ppRate: 32.3018,
			tgRate: 52.9449,
			prompt: 1,
			completion: 35,
			cachedPrompt: 236,
			ttftMs: 30.958,
			decodeMs: 661.064
		});
		// The counts from the provider usage object still win for display.
		expect(result.usage?.prompt).toBe(237);
		expect(result.usage?.completion).toBe(35);
	});

	it('survives a timings block without rates', async () => {
		const { result } = await run([
			{ choices: [{ index: 0, delta: { content: 'x' }, finish_reason: 'stop' }], timings: { cache_n: 12 } }
		]);
		expect(result.timings).toEqual({ source: 'llamacpp', cachedPrompt: 12 });
	});

	it('ignores an empty timings object', async () => {
		const { result } = await run([
			{ choices: [{ index: 0, delta: { content: 'x' }, finish_reason: 'stop' }], timings: {} }
		]);
		expect(result.timings).toBeUndefined();
	});
});

describe('vLLM per request metrics', () => {
	it('reads the metrics block and derives the generation rate', async () => {
		const { result } = await run([
			{ choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }] },
			{
				choices: [],
				usage: { prompt_tokens: 1024, completion_tokens: 254, total_tokens: 1278 },
				metrics: {
					time_to_first_token_ms: 41.2,
					generation_time_ms: 1830.5,
					queue_time_ms: 3.1,
					mean_itl_ms: 12.7,
					tokens_per_second: 34.8
				}
			}
		]);

		expect(result.timings?.source).toBe('vllm');
		expect(result.timings?.ttftMs).toBe(41.2);
		expect(result.timings?.decodeMs).toBe(1830.5);
		expect(result.timings?.queueMs).toBe(3.1);
		// 1000 / mean inter token latency is the decode rate.
		expect(result.timings?.tgRate).toBeCloseTo(78.74, 1);
	});
});

describe('token counts from the stream', () => {
	it('counts the token ids a vLLM stream reports', async () => {
		const { result, tokens } = await run([
			{
				choices: [{ index: 0, delta: { content: 'a' }, finish_reason: null }],
				prompt_token_ids: [1, 2, 3, 4]
			},
			{ choices: [{ index: 0, delta: { content: 'b' }, finish_reason: null }], token_ids: [10] },
			{ choices: [{ index: 0, delta: { content: 'c' }, finish_reason: 'stop' }], token_ids: [11, 12] }
		]);
		expect(result.promptTokens).toBe(4);
		expect(result.completionTokens).toBe(3);
		// The count reaches the client one chunk at a time.
		expect(tokens).toEqual([1, 2]);
	});

	it('counts the running total that llama.cpp reports per token', async () => {
		const timing = { prompt_n: 12, predicted_n: 1, prompt_per_second: 100, predicted_per_second: 40 };
		const { result, tokens } = await run([
			{ choices: [{ index: 0, delta: { content: 'a' }, finish_reason: null }], timings: timing },
			{
				choices: [{ index: 0, delta: { content: 'b' }, finish_reason: null }],
				timings: { ...timing, predicted_n: 2 }
			},
			{
				choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
				timings: { ...timing, predicted_n: 2 }
			}
		]);
		expect(result.promptTokens).toBe(12);
		expect(result.completionTokens).toBe(2);
		expect(tokens).toEqual([1, 1]);
	});
});
