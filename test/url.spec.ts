import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '$lib/shared/types';

/**
 * The address bar holds the open chat, so a reload, a bookmark or a second tab
 * lands on the same conversation. The api module is mocked, and the window is a
 * stub, because the state module only needs the location from it.
 */

const replaceState = vi.fn();
vi.mock('$app/navigation', () => ({ replaceState }));

function conversation(id: string, title: string): Conversation {
	return {
		id,
		title,
		providerId: null,
		model: null,
		system: null,
		params: {},
		createdAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString(),
		messageCount: 0
	};
}

const conversations = [conversation('c1', 'First chat'), conversation('c2', 'Second chat')];

vi.mock('$lib/client/api', () => ({
	ApiError: class ApiError extends Error {},
	api: {
		getSettings: vi.fn(async () => ({
			theme: {
				name: 'sloppy',
				font: 'system',
				fontFamily: '',
				textSize: 'default',
				radius: 'default',
				density: 'default'
			},
			search: { url: '', apiKey: '', maxResults: 5 },
			generation: {},
			tools: {
				modes: {},
				maxRounds: 6,
				fetchMaxChars: 20000,
				fetchAllowPrivate: false,
				pdfImages: true,
				pdfMaxImages: 8,
				pdfMaxChars: 12000
			},
			defaults: { providerId: null, model: null }
		})),
		listProviders: vi.fn(async () => ({ providers: [] })),
		listConversations: vi.fn(async () => ({ conversations })),
		getConversation: vi.fn(async (id: string) => ({
			conversation: conversations.find((item) => item.id === id) ?? conversations[0],
			messages: []
		})),
		listSkills: vi.fn(async () => ({ skills: [] })),
		listModels: vi.fn(async () => ({ models: [] })),
		stopTurn: vi.fn(async () => ({ stopped: false })),
		addMessage: vi.fn(),
		saveSettings: vi.fn(async () => ({})),
		search: vi.fn(),
		fetchPage: vi.fn()
	},
	getStream: vi.fn(async () => undefined),
	postStream: vi.fn(async () => undefined),
	readEventStream: vi.fn()
}));

const { app } = await import('$lib/client/state.svelte');

/** Points the stubbed address bar at a URL, as a reload would. */
function addressBar(search: string): void {
	(globalThis as unknown as Record<string, unknown>).window = {
		location: { href: `http://localhost/${search}` }
	};
}

beforeEach(() => {
	replaceState.mockClear();
});

describe('the chat in the address bar', () => {
	it('opens the chat that the URL names', async () => {
		addressBar('?c=c2');
		await app.init();
		expect(app.conversation?.id).toBe('c2');
	});

	it('falls back to the newest chat when the URL names an unknown chat', async () => {
		addressBar('?c=gone');
		await app.init();
		expect(app.conversation?.id).toBe('c1');
	});

	it('writes the chat that the user opens into the URL', async () => {
		addressBar('');
		await app.init();
		replaceState.mockClear();
		await app.open('c2');
		const url = replaceState.mock.calls.at(-1)?.[0] as URL | undefined;
		expect(url?.searchParams.get('c')).toBe('c2');
	});
});
