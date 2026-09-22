import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '$lib/client/state.svelte';
import type { Conversation, Settings } from '$lib/shared/types';

/**
 * A write that fails quietly is worse than one that fails loudly: the screen
 * keeps showing the value that was never stored, and the user believes it held.
 * So every settings write ends in a toast when the server says no.
 */

const failure = new Error('disk is full');

vi.mock('$lib/client/api', () => {
	class ApiError extends Error {
		constructor(
			message: string,
			readonly status: number
		) {
			super(message);
		}
	}
	return {
		ApiError,
		api: {
			updateConversation: vi.fn(async () => {
				throw new Error('disk is full');
			}),
			saveSettings: vi.fn(async () => {
				throw new Error('disk is full');
			}),
			updateProvider: vi.fn(async () => {
				throw new Error('disk is full');
			}),
			listProviders: vi.fn(async () => ({ providers: [] }))
		},
		postStream: vi.fn(),
		getStream: vi.fn(async () => undefined),
		readEventStream: vi.fn()
	};
});

const { AppState: Runtime } = await import('$lib/client/state.svelte');
const { api } = await import('$lib/client/api');

const conversation: Conversation = {
	id: 'c1',
	title: 'Chat',
	providerId: null,
	model: 'old-model',
	system: null,
	params: {},
	createdAt: new Date(0).toISOString(),
	updatedAt: new Date(0).toISOString()
};

function freshState(): AppState {
	const state = new Runtime();
	state.ready = true;
	state.conversation = conversation;
	return state;
}

/** The text of the last toast, or nothing when no toast was raised. */
function lastToast(state: AppState): string | undefined {
	return state.toasts.at(-1)?.text;
}

beforeEach(() => {
	vi.mocked(api.updateConversation).mockClear();
	vi.mocked(api.saveSettings).mockClear();
});

describe('a conversation write that fails', () => {
	it('says so instead of failing quietly', async () => {
		const state = freshState();

		await state.patchConversation({ title: 'Notes on the parser' });

		expect(lastToast(state)).toContain('disk is full');
	});

	it('leaves the fields on screen as they were', async () => {
		const state = freshState();

		await state.setModel('new-model');

		expect(state.conversation?.model, 'the model did not change on the server').toBe('old-model');
	});
});

describe('a settings write that fails', () => {
	it('says so instead of failing quietly', async () => {
		const state = freshState();
		const patch: Partial<Settings> = { tools: { ...state.settings.tools, maxRounds: 3 } };

		await state.saveSettings(patch);

		expect(lastToast(state)).toContain('disk is full');
	});

	it('keeps the settings the server still holds', async () => {
		const state = freshState();
		const rounds = state.settings.tools.maxRounds;

		await state.saveSettings({ tools: { ...state.settings.tools, maxRounds: rounds + 4 } });

		expect(state.settings.tools.maxRounds).toBe(rounds);
	});
});
