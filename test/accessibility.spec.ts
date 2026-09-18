import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { render } from 'svelte/server';
import Page from '../src/routes/+page.svelte';
import { app } from '$lib/client/state.svelte';

/**
 * Tridactyl's `gi` (focusinput) focuses the first element matching its own
 * selector: text-like inputs and textareas that are visible and at least 3x3 px.
 * These tests keep the message box as that first element.
 */

const TEXT_INPUT_TYPES = new Set([
	'',
	'text',
	'search',
	'password',
	'datetime',
	'datetime-local',
	'date',
	'month',
	'time',
	'week',
	'number',
	'range',
	'email',
	'url',
	'tel',
	'color'
]);

interface Candidate {
	tag: string;
	attrs: string;
	markup: string;
}

function textFields(html: string): Candidate[] {
	const found: Candidate[] = [];
	const pattern = /<(input|textarea)\b([^>]*)>/g;
	for (const match of html.matchAll(pattern)) {
		const tag = match[1];
		const attrs = match[2] ?? '';
		if (/\bdisabled\b/.test(attrs) || /\breadonly\b/.test(attrs)) continue;
		if (/\btype="hidden"/.test(attrs)) continue;
		if (tag === 'input') {
			const type = /\btype="([^"]*)"/.exec(attrs)?.[1] ?? '';
			if (!TEXT_INPUT_TYPES.has(type)) continue;
		}
		found.push({ tag, attrs, markup: match[0] });
	}
	return found;
}

function attribute(candidate: Candidate, name: string): string | undefined {
	return new RegExp(`\\b${name}="([^"]*)"`).exec(candidate.attrs)?.[1];
}

const original = {
	ready: app.ready,
	conversation: app.conversation,
	conversations: app.conversations
};

beforeEach(() => {
	app.ready = true;
	app.narrow = false;
	app.sidebarOpen = true;
	app.conversation = {
		id: 'test',
		title: 'A chat about accessibility',
		providerId: null,
		model: null,
		system: null,
		params: {},
		createdAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString()
	};
	// One row in the list, so the sidebar has something to show.
	app.conversations = [app.conversation];
	app.folders = [];
});

afterAll(() => {
	app.ready = original.ready;
	app.conversation = original.conversation;
	app.conversations = original.conversations;
});

describe('first text field for Tridactyl gi', () => {
	it('is the message composer', () => {
		const { body } = render(Page);
		const fields = textFields(body);
		expect(fields.length).toBeGreaterThan(0);
		const first = fields[0];
		expect(first.tag).toBe('textarea');
		expect(attribute(first, 'id')).toBe('composer');
		expect(attribute(first, 'aria-label')).toBe('Message');
	});

	it('has no other text input before the composer', () => {
		const { body } = render(Page);
		const fields = textFields(body);
		const index = fields.findIndex((field) => attribute(field, 'id') === 'composer');
		expect(index).toBe(0);
	});

	it('is rendered even before the app finishes loading', () => {
		app.ready = false;
		const { body } = render(Page);
		const fields = textFields(body);
		expect(fields[0] && attribute(fields[0], 'id')).toBe('composer');
	});
});

describe('narrow viewport', () => {
	it('turns the chat list into a drawer over the conversation', () => {
		app.narrow = true;
		const { body } = render(Page);
		// A backdrop and a close control, plus dialog semantics for screen readers.
		expect(body).toContain('aria-label="Close the chat list"');
		expect(body).toContain('role="dialog"');
		expect(body).toContain('aria-modal="true"');
		expect(body).toContain('fixed inset-y-0 left-0 z-30');
	});

	it('keeps it a plain column when there is room', () => {
		const { body } = render(Page);
		expect(body).not.toContain('role="dialog"');
		expect(body).toContain('<aside');
		expect(body).not.toContain('fixed inset-y-0 left-0 z-30');
	});

	it('reports the drawer state on the toggle', () => {
		app.narrow = true;
		app.sidebarOpen = false;
		const { body } = render(Page);
		expect(body).toContain('aria-expanded="false"');
		// Nothing is drawn over the conversation while the drawer is shut.
		expect(body).not.toContain('role="dialog"');
	});
});

describe('page structure', () => {
	it('is focusable through the composer with a visible label', () => {
		const { body } = render(Page);
		const composer = textFields(body).find((field) => attribute(field, 'id') === 'composer');
		expect(composer).toBeDefined();
		expect(composer?.attrs).toContain('autofocus');
	});

	it('shows the chat title as a heading with a rename button, not an input', () => {
		const { body } = render(Page);
		expect(body).toContain('<h1');
		expect(body).toContain('A chat about accessibility');
		expect(body).toMatch(/aria-label="Rename chat"/);
	});

	it('announces the conversation as a live log', () => {
		const { body } = render(Page);
		expect(body).toContain('role="log"');
		expect(body).toContain('aria-live="polite"');
		expect(body).toContain('aria-label="Conversation"');
	});

	it('keeps the conversation first in the document, before the chat list', () => {
		// Keyboard scrolling (Tridactyl j/k and the like) scrolls the first
		// scrollable element in document order, so the conversation has to come
		// before the chat list or the titles scroll instead.
		const { body } = render(Page);
		expect(body.indexOf('<main')).toBeGreaterThan(-1);
		expect(body.indexOf('<aside')).toBeGreaterThan(-1);
		expect(body.indexOf('<main')).toBeLessThan(body.indexOf('<aside'));
	});

	it('labels the main region and the sidebar controls', () => {
		const { body } = render(Page);
		expect(body).toContain('<main');
		expect(body).toContain('aria-label="Chat"');
		expect(body).toContain('<nav');
		expect(body).toMatch(/aria-label="Toggle chat list"/);
	});

	it('keeps the model picker to a single dropdown', () => {
		const { body } = render(Page);
		// One select, no manual entry field and no reload button to press.
		expect(body).toMatch(/<select[^>]*aria-label="Model"/);
		expect(body).not.toContain('aria-label="Reload the model list"');
		expect(body).not.toContain('placeholder="Model id"');
	});

	it('does not mark the page inert while the settings dialog is closed', () => {
		app.showSettings = false;
		const { body } = render(Page);
		expect(body).not.toMatch(/<div[^>]*\binert\b/);
	});

	it('marks the page inert while the settings dialog is open', () => {
		app.showSettings = true;
		const { body } = render(Page);
		// The dialog itself stays interactive, the rest of the page does not.
		expect(body).toMatch(/<div class="flex min-h-0 flex-1" inert=""/);
		app.showSettings = false;
	});

	it('gives icon only controls an accessible name', () => {
		const { body } = render(Page);
		for (const button of body.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)) {
			const attrs = button[1] ?? '';
			const content = (button[2] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, '');
			const named = /aria-label="[^"]+"/.test(attrs) || /title="[^"]+"/.test(attrs) || content.length > 0;
			expect(named, button[0].slice(0, 120)).toBe(true);
		}
	});

	it('keeps utility controls icon only', () => {
		// These carry their meaning through the tooltip, which keeps the chrome quiet.
		const iconOnly = new Set([
			'New chat',
			'Settings',
			'Toggle chat list',
			'Rename chat',
			'Generation parameters',
			'Attach images or a PDF',
			'Send the message',
			'Web tools'
		]);
		const { body } = render(Page);
		for (const button of body.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)) {
			const label = /aria-label="([^"]*)"/.exec(button[1] ?? '')?.[1];
			if (!label || !iconOnly.has(label)) continue;
			const content = (button[2] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, '');
			expect(content, `${label} should not show text`).toBe('');
		}
	});

	it('floats the composer over the conversation instead of using a full width strip', () => {
		const { body } = render(Page);
		// A scrim fades the text out under the floating card.
		expect(body).toContain('composer-scrim');
		// The composer lives in an absolutely positioned layer at the bottom.
		expect(body).toMatch(/absolute inset-x-0 bottom-0 z-20/);
		// The message list reserves room so the last message stays visible.
		expect(body).toContain('pb-32');
	});

	it('keeps one single top bar holding the title and the controls', () => {
		const { body } = render(Page);
		// Only the top bar and no second strip under it.
		const bars = body.match(/border-b border-line bg-surface/g) ?? [];
		expect(bars).toHaveLength(1);
		const header = /<header[\s\S]*?<\/header>/.exec(body)?.[0] ?? '';
		expect(header).toContain('<h1');
		expect(header).toContain('aria-label="Model"');
		expect(header).toContain('aria-label="Generation parameters"');
		expect(header).toContain('aria-label="Settings"');
		expect(header).toContain('aria-label="Toggle chat list"');
	});

	it('keeps the empty state to the wordmark alone', () => {
		const { body } = render(Page);
		expect(body).toContain('>sloppychat</p>');
		// No tagline and no suggested prompts.
		expect(body).not.toContain('Any OpenAI compatible endpoint');
		expect(body).not.toMatch(/Summarize the latest|Compare SQLite/);
	});

	it('drops the standalone brand label from the bar', () => {
		const { body } = render(Page);
		const header = /<header[\s\S]*?<\/header>/.exec(body)?.[0] ?? '';
		expect(header).not.toContain('sloppychat');
	});

	it('keeps one new chat button, in the bar once the list is out of sight', () => {
		const withList = render(Page).body;
		const barWithList = /<header[\s\S]*?<\/header>/.exec(withList)?.[0] ?? '';
		expect(barWithList).not.toContain('aria-label="New chat"');
		expect(withList.match(/aria-label="New chat"/g) ?? [], 'the list holds the button').toHaveLength(1);

		app.sidebarOpen = false;
		const withoutList = render(Page).body;
		const bar = /<header[\s\S]*?<\/header>/.exec(withoutList)?.[0] ?? '';
		expect(bar, 'the bar takes over').toContain('aria-label="New chat"');
		expect(withoutList.match(/aria-label="New chat"/g) ?? [], 'only the bar holds it').toHaveLength(1);
	});

	it('keeps the composer controls inside the floating card', () => {
		const { body } = render(Page);
		const cardStart = body.indexOf('card bg-surface/95');
		expect(cardStart, 'floating card exists').toBeGreaterThan(-1);
		expect(body.indexOf('id="composer"'), 'message box inside the card').toBeGreaterThan(cardStart);
		expect(body.indexOf('Attach images or a PDF'), 'attach button inside the card').toBeGreaterThan(cardStart);
	});

	it('only shows the send button when there is something to send', () => {
		const { body } = render(Page);
		expect(body).not.toContain('aria-label="Send the message"');
	});

	it('drops the tools checkbox and the keyboard hint from the composer', () => {
		const { body } = render(Page);
		const card = /class="card bg-surface\/95([\s\S]*?)<\/div><\/div>/.exec(body)?.[0] ?? '';
		expect(card).not.toContain('type="checkbox"');
		expect(card).not.toContain('Shift+Enter adds a line<');
		// The hint stays reachable as the tooltip of the message box.
		expect(body).toContain('title="Enter sends, Shift+Enter adds a line"');
	});

	it('gives the chat list a search box, folders and a way to move without a drag', () => {
		const { body } = render(Page);
		expect(body).toContain('aria-label="Search chats"');
		expect(body).toContain('aria-label="New folder"');
		// The group that holds the chats that are in no folder.
		expect(body).toContain('aria-label="Chats"');
		// A row belongs to a folder by being dragged onto it.
		expect(body).toContain('draggable="true"');
		expect(body).toContain('aria-label="Rename chat"');
	});

	it('holds the tools menu in the top bar', () => {
		const { body } = render(Page);
		const header = /<header[\s\S]*?<\/header>/.exec(body)?.[0] ?? '';
		expect(header).toContain('aria-label="Tools"');
		expect(header).toContain('aria-haspopup="dialog"');
		expect(header).toContain('aria-expanded="false"');
		// The three modes live in the popover, so the button holds no pressed state.
		expect(header).not.toContain('aria-pressed');
	});
});
