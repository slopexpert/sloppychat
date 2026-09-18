import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ContextGauge from '$lib/components/ContextGauge.svelte';
import { app } from '$lib/client/state.svelte';
import { contextWindowFor } from '$lib/shared/context';
import { withReportedWindow } from '$lib/server/tokens';
import { DEFAULT_SETTINGS } from '$lib/shared/types';
import type { Conversation, Message, ModelInfo } from '$lib/shared/types';

/** The window table and the gauge that uses it. */

describe('contextWindowFor', () => {
	it('prefers the window the provider reported', () => {
		expect(contextWindowFor('gpt-4o', 256_000)).toEqual({ window: 256_000, assumed: false });
	});

	it('knows common model families', () => {
		expect(contextWindowFor('gpt-4o')).toEqual({ window: 128_000, assumed: true });
		expect(contextWindowFor('gpt-4-turbo')).toEqual({ window: 128_000, assumed: true });
		expect(contextWindowFor('gpt-4')).toEqual({ window: 8_192, assumed: true });
		expect(contextWindowFor('gpt-3.5-turbo')).toEqual({ window: 4_096, assumed: true });
		expect(contextWindowFor('claude-3-5-sonnet-20241022')).toEqual({ window: 200_000, assumed: true });
		expect(contextWindowFor('gemini-2.0-flash')).toEqual({ window: 1_000_000, assumed: true });
		expect(contextWindowFor('llama-3.3-70b')).toEqual({ window: 128_000, assumed: true });
	});

	it('ignores a provider prefix', () => {
		expect(contextWindowFor('openai/gpt-4o')).toEqual({ window: 128_000, assumed: true });
		expect(contextWindowFor('meta-llama/llama-3.1-8b')).toEqual({ window: 128_000, assumed: true });
	});

	it('says nothing for a model it does not know', () => {
		expect(contextWindowFor('my-local-model')).toEqual({ assumed: false });
		expect(contextWindowFor(undefined)).toEqual({ assumed: false });
	});

	it('ignores a useless reported value', () => {
		expect(contextWindowFor('gpt-4o', 0)).toEqual({ window: 128_000, assumed: true });
		expect(contextWindowFor('mystery', 0)).toEqual({ assumed: false });
	});
});

function assistant(usage: Message['usage']): Message {
	return {
		id: 'a1',
		conversationId: 'c1',
		role: 'assistant',
		text: 'an answer',
		images: [],
		usage,
		createdAt: new Date(0).toISOString()
	};
}

function seed(model: string, models: ModelInfo[], usage?: Message['usage']) {
	const conversation: Conversation = {
		id: 'c1',
		title: 'Gauge',
		providerId: 'p1',
		model,
		system: null,
		params: {},
		createdAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString()
	};
	app.settings = structuredClone(DEFAULT_SETTINGS);
	app.conversation = conversation;
	app.providers = [
		{
			id: 'p1',
			name: 'Provider',
			baseUrl: 'http://127.0.0.1:1/v1',
			kind: 'openai',
			defaultModel: model,
			enabled: true,
			sort: 0,
			createdAt: new Date(0).toISOString(),
			hasKey: false
		}
	];
	app.models = { p1: models };
	app.messages = [assistant(usage)];
}

beforeEach(() => {
	app.messages = [];
	app.models = {};
});

describe('ContextGauge', () => {
	it('is a bar with a percentage when the window is known', () => {
		seed('gpt-4o', [{ id: 'gpt-4o', contextLength: 128_000 }], {
			prompt: 12_400,
			completion: 400,
			total: 12_800
		});
		const body = render(ContextGauge).body;
		expect(body).toContain('role="progressbar"');
		expect(body).toContain('10%');
		// Hover detail: totals, what is left, and the last turn.
		expect(body).toContain('12.8k of 128k tokens used');
		expect(body).toContain('115.2k left');
		expect(body).toContain('last turn: 12.4k in, 400 out');
	});

	it('draws the same bar for a model whose window it assumes', () => {
		seed('gpt-4o', [{ id: 'gpt-4o' }], { prompt: 32_000, completion: 0, total: 32_000 });
		const body = render(ContextGauge).body;
		expect(body).toContain('role="progressbar"');
		expect(body).toContain('25%');
		expect(body).toContain('window assumed for this model');
	});

	it('keeps the bar and says the window is unknown', () => {
		seed('mystery-model', [{ id: 'mystery-model' }], { prompt: 900, completion: 100, total: 1000 });
		const body = render(ContextGauge).body;
		expect(body).toContain('role="progressbar"');
		expect(body).toContain('1k tok');
		expect(body).toContain('no context window known for this model');
	});

	it('renders nothing when there is nothing at all to count', () => {
		seed('gpt-4o', [{ id: 'gpt-4o', contextLength: 128_000 }]);
		// No messages and no system prompt.
		app.messages = [];
		app.settings = {
			...structuredClone(DEFAULT_SETTINGS),
			generation: { ...DEFAULT_SETTINGS.generation, system: '' }
		};
		expect(render(ContextGauge).body).not.toContain('progressbar');
	});

	it('counts the system prompt of an otherwise empty chat', () => {
		seed('gpt-4o', [{ id: 'gpt-4o', contextLength: 128_000 }]);
		app.messages = [];
		// The default system prompt occupies context before anything is sent.
		expect(render(ContextGauge).body).toContain('progressbar');
	});
});

describe('withReportedWindow', () => {
	const support = {
		counter: 'llamacpp' as const,
		tokenIds: false,
		perToken: true,
		continueFinal: false,
		contextLength: 4096
	};

	it('applies the window a llama.cpp server reports for its model', () => {
		expect(withReportedWindow([{ id: 'mock-model' }], support)).toEqual([
			{ id: 'mock-model', contextLength: 4096 }
		]);
	});

	it('leaves a list alone when the server reports no window', () => {
		const models = [{ id: 'mock-model' }];
		expect(
			withReportedWindow(models, { counter: 'none', tokenIds: false, perToken: false, continueFinal: false })
		).toBe(models);
	});

	it('leaves a list of several models as the provider gave it', () => {
		const models = [{ id: 'a' }, { id: 'b' }];
		expect(withReportedWindow(models, support)).toBe(models);
	});
});
