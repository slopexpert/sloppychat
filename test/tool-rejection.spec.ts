import { describe, expect, it } from 'vitest';
import { isToolRejection } from '$lib/server/bridge';

/**
 * The one line that decides whether a turn loses its tools. A provider that cannot
 * take them has to be recognised, or the turn fails for good; a provider that
 * failed for another reason must keep them, or the answer comes back without the
 * tools the reader asked for.
 */

describe('a provider that refuses tools', () => {
	it('knows the ways it says so', () => {
		for (const message of [
			'Request to llama failed: HTTP 400 - this model does not support tools',
			'Request to llama failed: HTTP 400 - tools is not supported by this model',
			'HTTP 400 - Unsupported parameter: tools',
			'HTTP 400 - function calling is not supported by qwen2.5',
			'HTTP 400 - unknown parameter: tool_choice',
			'HTTP 400 - 1 validation error: Extra inputs are not permitted',
			'HTTP 400 - The server does not recognize the tools field'
		]) {
			expect(isToolRejection(message), message).toBe(true);
		}
	});
});

describe('a provider that failed for another reason', () => {
	it('keeps the tools of the turn', () => {
		for (const message of [
			'Request to llama failed: HTTP 401 - Invalid API key (check the API key)',
			'Request to llama failed: HTTP 404 - The model does not exist (check the base URL)',
			'The provider did not answer in 30 s',
			'HTTP 500 - CUDA out of memory: tried to allocate 2.00 GiB',
			'HTTP 400 - invalid message role: assistant2',
			'HTTP 413 - the prompt is longer than the context of the model',
			// Both words are here, but they are far apart, and nothing was refused.
			'HTTP 500 - an unexpected error happened in the worker that serves the tool server'
		]) {
			expect(isToolRejection(message), message).toBe(false);
		}
	});
});
