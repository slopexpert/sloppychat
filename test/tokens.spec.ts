import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countPrompt, tokenSupport } from '$lib/server/tokens';
import { contextUsage } from '$lib/shared/stats';
import type { Provider } from '$lib/shared/types';

/**
 * The token probe: llama.cpp counts and reports, vLLM counts, and anything else
 * keeps the estimate. Each mock shows one of those shapes.
 */

const hits = { props: 0, tokenize: 0, template: 0 };

function provider(id: string, port: number): Provider {
	return {
		id,
		name: id,
		baseUrl: `http://127.0.0.1:${port}/v1`,
		apiKey: '',
		kind: 'openai',
		defaultModel: 'mock-model',
		enabled: true,
		sort: 0,
		createdAt: new Date(0).toISOString()
	};
}

/** llama.cpp: /props, /apply-template and /tokenize all answer. */
const llama = createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://127.0.0.1:5401');
	const json = (body: unknown) => {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify(body));
	};
	if (url.pathname === '/props') {
		hits.props++;
		json({ default_generation_settings: { n_ctx: 4096 }, total_slots: 1 });
		return;
	}
	if (url.pathname === '/apply-template') {
		hits.template++;
		json({ prompt: '<|im_start|>user\nhello<|im_end|>\n<|im_start|>assistant\n' });
		return;
	}
	if (url.pathname === '/tokenize') {
		hits.tokenize++;
		// Six tokens for the rendered prompt, two for anything else.
		json({ tokens: Array.from({ length: 6 }, (_, index) => index + 1) });
		return;
	}
	res.writeHead(404).end();
});

/** vLLM: /tokenize answers and /props does not exist. */
const vllm = createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://127.0.0.1:5402');
	if (url.pathname === '/tokenize') {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ count: 2, tokens: [11, 12] }));
		return;
	}
	res.writeHead(404).end();
});

/** A plain OpenAI compatible API: no counting at all. */
const plain = createServer((_req, res) => {
	res.writeHead(404).end();
});

beforeAll(async () => {
	await new Promise<void>((resolve) => llama.listen(5401, '127.0.0.1', () => resolve()));
	await new Promise<void>((resolve) => vllm.listen(5402, '127.0.0.1', () => resolve()));
	await new Promise<void>((resolve) => plain.listen(5403, '127.0.0.1', () => resolve()));
});

afterAll(() => {
	llama.close();
	vllm.close();
	plain.close();
});

describe('the token probe', () => {
	it('reads the llama.cpp shape, window included', async () => {
		const support = await tokenSupport(provider('llama', 5401));
		expect(support.counter).toBe('llamacpp');
		expect(support.perToken).toBe(true);
		expect(support.tokenIds).toBe(false);
		expect(support.contextLength).toBe(4096);
	});

	it('reads the vLLM shape', async () => {
		const support = await tokenSupport(provider('vllm', 5402));
		expect(support.counter).toBe('vllm');
		expect(support.tokenIds).toBe(true);
		expect(support.perToken).toBe(false);
		expect(support.contextLength).toBeUndefined();
	});

	it('finds nothing on a plain API', async () => {
		const support = await tokenSupport(provider('plain', 5403));
		expect(support).toEqual({ counter: 'none', tokenIds: false, perToken: false });
	});

	it('probes one time and then answers from the cache', async () => {
		const before = hits.props;
		await tokenSupport(provider('cached', 5401));
		await tokenSupport(provider('cached', 5401));
		expect(hits.props).toBe(before + 1);
	});

	it('counts a rendered llama.cpp prompt exactly', async () => {
		const count = await countPrompt(provider('llama', 5401), [{ role: 'user', content: 'hello' }]);
		expect(count).toBe(6);
		expect(hits.template).toBeGreaterThan(0);
	});

	it('leaves the prompt count to the turn on vLLM', async () => {
		expect(await countPrompt(provider('vllm', 5402), [{ role: 'user', content: 'hello' }])).toBeUndefined();
	});
});

describe('the exact prompt count', () => {
	it('uses the count the provider made, system prompt included', () => {
		const usage = contextUsage({
			messages: [{ id: 'm1', conversationId: 'c1', role: 'user', text: 'hi', images: [], createdAt: '' }],
			system: 'be nice',
			window: 1000,
			exact: 250
		});
		expect(usage.used).toBe(250);
		expect(usage.measured).toBe(true);
		expect(usage.exact).toBe(true);
		expect(usage.ratio).toBeCloseTo(0.25);
	});

	it('falls back to the estimate when the provider cannot count', () => {
		const usage = contextUsage({
			messages: [{ id: 'm1', conversationId: 'c1', role: 'user', text: 'hi', images: [], createdAt: '' }],
			system: 'be nice',
			window: 1000,
			exact: null
		});
		expect(usage.exact).toBeUndefined();
		expect(usage.used).toBeGreaterThan(0);
	});
});
