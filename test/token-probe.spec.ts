import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenSupport } from '$lib/server/tokens';
import type { Provider } from '$lib/shared/types';

/**
 * The app asks a provider one time what it can count, and keeps the answer for
 * the rest of the session. A provider that was briefly unreachable is not a
 * provider without support: keeping that answer would leave the context gauge
 * estimating forever, even after the server comes back.
 */

let id = 0;

function provider(): Provider {
	id++;
	return {
		id: `p${id}`,
		name: `Provider ${id}`,
		baseUrl: 'http://127.0.0.1:1/v1',
		kind: 'openai',
		apiKey: '',
		enabled: true,
		sort: 0,
		createdAt: new Date(0).toISOString()
	};
}

/** The llama.cpp answer that says the server counts tokens. */
const llamaProps = {
	default_generation_settings: { n_ctx: 8192 }
};

const refused = () => new Response('no', { status: 404 });

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the probe of one provider', () => {
	it('asks again after a probe that reached nothing', async () => {
		const fetchMock = vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
		const item = provider();

		const first = await tokenSupport(item);

		expect(first.counter).toBe('none');
		expect(fetchMock).toHaveBeenCalled();

		fetchMock.mockClear();
		await tokenSupport(item);

		expect(fetchMock, 'a probe that heard nothing is not an answer').toHaveBeenCalled();
	});

	it('learns the truth when the provider comes back', async () => {
		const fetchMock = vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
		const item = provider();
		await tokenSupport(item);

		fetchMock.mockReset();
		fetchMock.mockImplementation(async (url) =>
			String(url).endsWith('/props') ? Response.json(llamaProps) : refused()
		);

		expect((await tokenSupport(item)).counter).toBe('llamacpp');
	});

	it('keeps the answer of a server that answered and has no support', async () => {
		const fetchMock = vi.mocked(fetch).mockImplementation(async () => refused());
		const item = provider();

		expect((await tokenSupport(item)).counter).toBe('none');
		const asked = fetchMock.mock.calls.length;
		expect(asked).toBeGreaterThan(0);

		const again = await tokenSupport(item);

		expect(again.counter).toBe('none');
		expect(fetchMock.mock.calls.length, 'a present server is asked once').toBe(asked);
	});

	it('keeps what llama.cpp said about the model window', async () => {
		const fetchMock = vi.mocked(fetch).mockImplementation(async (url) =>
			String(url).endsWith('/props') ? Response.json(llamaProps) : refused()
		);
		const item = provider();

		const support = await tokenSupport(item);

		expect(support).toMatchObject({ counter: 'llamacpp', perToken: true, contextLength: 8192 });
		expect(fetchMock).toHaveBeenCalled();
	});
});
