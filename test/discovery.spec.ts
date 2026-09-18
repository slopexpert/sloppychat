import { afterEach, describe, expect, it, vi } from 'vitest';
import { listModels } from '$lib/server/openai';
import type { Provider } from '$lib/shared/types';

/**
 * The context window comes from the provider whenever it reports one, and each
 * server uses a different key. The fallback table is only for the providers that
 * report nothing at all (OpenAI's own API being the notable one).
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

async function modelsFrom(payload: unknown) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } }))
	);
	return listModels(provider);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('context window discovery', () => {
	it('reads vLLM, which reports max_model_len', async () => {
		const models = await modelsFrom({
			object: 'list',
			data: [
				{
					id: 'Qwen/Qwen2.5-7B-Instruct',
					object: 'model',
					max_model_len: 32768,
					root: '/models/qwen'
				}
			]
		});
		expect(models[0].contextLength).toBe(32768);
	});

	it('reads llama.cpp, which reports meta.n_ctx_train', async () => {
		const models = await modelsFrom({
			object: 'list',
			data: [
				{
					id: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
					object: 'model',
					owned_by: 'llamacpp',
					meta: { n_vocab: 128256, n_ctx_train: 131072, n_embd: 4096 }
				}
			]
		});
		expect(models[0].contextLength).toBe(131072);
	});

	it('reads OpenRouter, which reports context_length and a top provider figure', async () => {
		const models = await modelsFrom({
			data: [
				{
					id: 'anthropic/claude-3.5-sonnet',
					context_length: 200000,
					architecture: { input_modalities: ['text', 'image'] },
					top_provider: { context_length: 200000, max_completion_tokens: 8192 }
				},
				{
					id: 'meta-llama/llama-3-8b',
					top_provider: { context_length: 8192 }
				}
			]
		});
		expect(models.find((model) => model.id === 'anthropic/claude-3.5-sonnet')?.contextLength).toBe(200000);
		expect(models.find((model) => model.id === 'anthropic/claude-3.5-sonnet')?.vision).toBe(true);
		// Falls back to the nested value when the top level has none.
		expect(models.find((model) => model.id === 'meta-llama/llama-3-8b')?.contextLength).toBe(8192);
	});

	it('reads the other spellings some servers use', async () => {
		const models = await modelsFrom({
			models: [
				{ name: 'a', context_window: 64000 },
				{ name: 'b', max_context_length: 16000 },
				{ name: 'c', details: { context_length: 4096 } }
			]
		});
		expect(models.map((model) => model.contextLength)).toEqual([64000, 16000, 4096]);
	});

	it('reports no window when the provider sends none', async () => {
		// OpenAI's own list looks like this: ids only.
		const models = await modelsFrom({
			object: 'list',
			data: [
				{ id: 'gpt-4o', object: 'model', created: 1715367049, owned_by: 'openai' },
				{ id: 'gpt-4o-mini', object: 'model', created: 1721172741, owned_by: 'openai' }
			]
		});
		expect(models.every((model) => model.contextLength === undefined)).toBe(true);
	});

	it('ignores a useless reported value', async () => {
		const models = await modelsFrom({ data: [{ id: 'odd', context_length: 0, max_model_len: -1 }] });
		expect(models[0].contextLength).toBeUndefined();
	});
});
