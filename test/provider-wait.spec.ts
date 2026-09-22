import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { listModels, streamChat } from '$lib/server/openai';
import type { Provider } from '$lib/shared/types';

/**
 * A provider that is up answers, and a busy one takes a moment. A provider that
 * is gone without closing the connection would hold the turn open for as long as
 * the process lives, so the wait for an answer to start has a limit.
 */

const provider: Provider = {
	id: 'p1',
	name: 'Hanging',
	baseUrl: 'http://127.0.0.1:5407/v1',
	kind: 'openai',
	apiKey: '',
	enabled: true,
	sort: 0,
	createdAt: new Date(0).toISOString()
};

/** A server that accepts the request and never answers it. */
const hanging = createServer(() => {
	/* keep the socket open and say nothing */
});

beforeAll(async () => {
	await new Promise<void>((resolve) => hanging.listen(5407, '127.0.0.1', () => resolve()));
});

afterAll(() => {
	hanging.close();
});

describe('the wait for a provider', () => {
	it('gives up on a model list that never starts', async () => {
		vi.useFakeTimers();
		try {
			const pending = listModels(provider);
			const failure = expect(pending).rejects.toThrow(/did not answer in 30 s/);
			await vi.advanceTimersByTimeAsync(30_000);
			await failure;
		} finally {
			vi.useRealTimers();
		}
	});

	it('gives up on a chat request that never starts', async () => {
		vi.useFakeTimers();
		try {
			const pending = streamChat(
				provider,
				{ model: 'm', messages: [], stream: true },
				() => {}
			);
			const failure = expect(pending).rejects.toThrow(/did not answer in 30 s/);
			await vi.advanceTimersByTimeAsync(30_000);
			await failure;
		} finally {
			vi.useRealTimers();
		}
	});

	it('still stops at once when the caller stops', async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			const pending = streamChat(
				provider,
				{ model: 'm', messages: [], stream: true },
				() => {},
				controller.signal
			);
			controller.abort();
			await expect(pending).rejects.toThrow();
			// The wait limit is off now, so the caller alone stopped the request.
			await vi.advanceTimersByTimeAsync(60_000);
		} finally {
			vi.useRealTimers();
		}
	});
});
