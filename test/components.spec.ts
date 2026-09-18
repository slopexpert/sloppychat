import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Icon from '$lib/components/Icon.svelte';
import ToolList from '$lib/components/ToolList.svelte';
import ToolCallCard from '$lib/components/ToolCallCard.svelte';
import Markdown from '$lib/components/Markdown.svelte';
import MessageItem from '$lib/components/MessageItem.svelte';
import { ICONS } from '$lib/shared/icons';
import { TOOL_CATALOG } from '$lib/shared/tools';
import { app } from '$lib/client/state.svelte';
import type { Message } from '$lib/shared/types';

/** Server rendering keeps the components honest without a browser. */
describe('Icon', () => {
	it('renders the paths of the requested name', () => {
		const { body } = render(Icon, { props: { name: 'trash', size: 20 } });
		expect(body).toContain('<svg');
		expect(body).toContain('width="20"');
		expect(body).toContain('stroke="currentColor"');
		expect(body).toContain(ICONS.trash.split('/>')[0].replace('<path d="', ''));
	});

	it('marks the icon as decorative and can spin', () => {
		const { body } = render(Icon, { props: { name: 'refresh', spin: true } });
		expect(body).toContain('aria-hidden="true"');
		expect(body).toContain('animate-spin');
	});

	it('has no empty icon entries', () => {
		for (const [name, markup] of Object.entries(ICONS)) {
			expect(markup.length, name).toBeGreaterThan(10);
			expect(markup, name).toContain('<');
		}
	});

	it('draws the settings icon as a cog, not a sun', () => {
		const settings = ICONS.settings;
		// A closed cog outline plus a hub, rather than spokes from the centre.
		expect(settings).toContain('Z"');
		expect(settings).toMatch(/<circle cx="12" cy="12" r="[\d.]+"\/>/);
		expect(settings).not.toContain('M12 3v2.2');
		const outline = settings.match(/<path d="M\d/g) ?? [];
		expect(outline, 'one closed cog outline').toHaveLength(1);
	});
});

describe('Markdown component', () => {
	it('emits strong and em elements for the coloured emphasis', () => {
		const { body } = render(Markdown, { props: { text: '**bold** and *soft*' } });
		expect(body).toContain('<strong>bold</strong>');
		expect(body).toContain('<em>soft</em>');
	});

	it('keeps unsafe markup escaped', () => {
		const { body } = render(Markdown, { props: { text: '<script>alert(1)</script>' } });
		expect(body).not.toContain('<script>');
	});

	it('renders a highlighted fence', () => {
		const { body } = render(Markdown, { props: { text: '```js\nconst a = 1;\n```' } });
		expect(body).toContain('<pre');
		expect(body).toContain('tok-key');
	});
});

/** Reasoning should be visible while the model thinks, then get out of the way. */
function assistant(overrides: Partial<Message> = {}): Message {
	return {
		id: 'a1',
		conversationId: 'c1',
		role: 'assistant',
		text: '',
		reasoning: 'First I check the numbers.',
		images: [],
		createdAt: new Date(0).toISOString(),
		...overrides
	};
}

function userMessage(text: string, overrides: Partial<Message> = {}): Message {
	return {
		id: 'u1',
		conversationId: 'c1',
		role: 'user',
		text,
		images: [],
		createdAt: new Date(0).toISOString(),
		...overrides
	};
}

function renderMessage(
	message: Message,
	streaming: boolean,
	extra: { streamRate?: number; prefillRate?: number; prefillStats?: string; prefilling?: boolean } = {}
): string {
	return render(MessageItem, { props: { message, toolResults: {}, toolProgress: {}, streaming, ...extra } }).body;
}

describe('live reasoning', () => {
	it('shows the reasoning while the model is still thinking', () => {
		const body = renderMessage(assistant(), true);
		expect(body).toContain('First I check the numbers.');
		expect(body).toContain('thinking...');
		expect(body).toContain('aria-expanded="true"');
	});

	it('collapses the reasoning once the answer starts streaming', () => {
		const body = renderMessage(assistant({ text: 'The answer is 4.' }), true);
		expect(body).toContain('The answer is 4.');
		expect(body).not.toContain('First I check the numbers.');
		expect(body).toContain('aria-expanded="false"');
		expect(body).not.toContain('thinking...');
	});

	it('keeps the reasoning collapsed on a finished message', () => {
		const body = renderMessage(assistant({ text: 'Done.' }), false);
		expect(body).not.toContain('First I check the numbers.');
		expect(body).toContain('thinking');
	});

	it('leaves the assistant message empty while the prompt is being read', () => {
		// The wait is shown on the user message that asked for the answer.
		const waiting = renderMessage(assistant({ reasoning: undefined }), true, { prefillRate: 245.4 });
		expect(waiting).not.toContain('reading the prompt');
		expect(waiting).not.toContain('tok/s');
	});

	it('shows the persisted prefill under the user message', () => {
		const body = renderMessage(userMessage('count slowly'), false, {
			prefillStats: '1234 tok/s'
		});
		expect(body).toContain('1234 tok/s');
	});

	it('marks the prefill with the gauge icon rather than a word', () => {
		const persisted = renderMessage(userMessage('hi'), false, { prefillStats: '1234 tok/s' });
		expect(persisted).not.toContain('prefill 1234');
		expect(persisted).toMatch(/prompt processing">[\s\S]*<svg[\s\S]*1234 tok\/s/);

		const live = renderMessage(userMessage('hi'), false, { prefilling: true, prefillRate: 236.7 });
		expect(live).toContain('237 tok/s');
		expect(live).not.toContain('prefill 237');
	});

	it('does not let the statistics widen the message bubble', () => {
		// The same message with and without a statistics line must produce the
		// same bubble: only the caption below it may get wider.
		const withoutStats = renderMessage(userMessage('hi'), false);
		const withStats = renderMessage(userMessage('hi'), false, { prefillStats: '20000 tok/s' });
		const bubble = (html: string) => /<div class="[^"]*bg-accent[^"]*"[^>]*>/.exec(html)?.[0] ?? '';
		expect(bubble(withoutStats)).toContain('w-fit');
		expect(bubble(withStats)).toBe(bubble(withoutStats));
	});

	it('keeps the hover actions on the same line as the statistics', () => {
		const user = renderMessage(userMessage('hi'), false, { prefillStats: '1234 tok/s' });
		// One row holds the buttons and the statistic, buttons first so the
		// statistic lands flush against the right edge.
		expect(user).toMatch(
			/class="flex[^"]*items-center[^"]*text-xs text-faint"[\s\S]*Edit and send again[\s\S]*1234 tok\/s[\s\S]*<\/div>/
		);

		const answer = renderMessage(
			assistant({ text: 'done', usage: { completion: 256, tgRate: 40 } }),
			false
		);
		expect(answer).toMatch(
			/class="flex[^"]*items-center[^"]*text-xs text-faint"[\s\S]*40\.0 tok\/s[\s\S]*Copy the answer/
		);
	});

	it('shows the prefill rate under the user message during prefill', () => {
		const user = userMessage('count slowly');
		const body = renderMessage(user, false, { prefilling: true, prefillRate: 236.7 });
		expect(body).toContain('237 tok/s');
		// And nothing once the prefill is over.
		const done = renderMessage(user, false, { prefilling: false, prefillRate: undefined });
		expect(done).not.toContain('tok/s');
	});

	it('says the prompt is being read before there is a rate', () => {
		expect(renderMessage(userMessage('hi'), false, { prefilling: true })).toContain('reading the prompt');
	});

	it('shows the generation rate under a streaming answer', () => {
		const body = renderMessage(assistant({ text: 'half an answer' }), true, { streamRate: 13.82 });
		expect(body).toContain('about 13.8 tok/s');
	});

	it('shows brief statistics on a finished answer without hovering', () => {
		const body = renderMessage(
			assistant({
				text: 'finished',
				usage: { prompt: 2048, completion: 256, ttftMs: 1000, decodeMs: 6400, tgRate: 40 }
			}),
			false
		);
		expect(body).toContain('40.0 tok/s');
		expect(body).toContain('256 tok');
		// The full breakdown stays available in the tooltip.
		expect(body).toContain('pp and tg measured around the HTTP call');
	});

	it('has no statistics line while an answer is still empty', () => {
		const body = renderMessage(assistant({ text: '' }), false);
		expect(body).not.toContain('tok/s');
	});
});

describe('ToolList', () => {
	it('shows the tool id and a three way switch', () => {
		const { body } = render(ToolList);
		const rows = TOOL_CATALOG.length;
		expect(rows).toBeGreaterThan(0);
		// One switch per tool, with three positions and one active position each.
		expect(body.match(/role="radiogroup"/g) ?? []).toHaveLength(rows);
		expect(body.match(/role="radio"/g) ?? []).toHaveLength(rows * 3);
		expect(body.match(/aria-checked="true"/g) ?? []).toHaveLength(rows);
		// Each position has an accessible name, because the switch holds icons only.
		expect(body.match(/aria-label="Off"/g) ?? []).toHaveLength(rows);
		expect(body.match(/aria-label="Ask first"/g) ?? []).toHaveLength(rows);
		expect(body.match(/aria-label="On"/g) ?? []).toHaveLength(rows);
		for (const spec of TOOL_CATALOG) {
			expect(body).toContain(`aria-label="${spec.name} mode"`);
			// The row shows the tool id, and no human label stands in for the tool.
			expect(body).toContain(`>${spec.name}</span>`);
		}
		expect(body).not.toContain('>Search<');
		expect(body).not.toContain('>Skill<');
		expect(body).not.toContain('>Fetch<');
	});
});

describe('ToolCallCard icons', () => {
	const mcpTool = {
		id: 'sample_add',
		serverId: 's1',
		serverName: 'sample',
		name: 'add',
		description: 'Add two numbers.',
		parameters: {}
	};

	it('wears the protocol mark for a tool an MCP server owns', () => {
		app.mcpServers = [
			{
				id: 's1',
				name: 'sample',
				enabled: true,
				config: { transport: 'stdio', command: 'node' },
				status: 'ready',
				tools: [mcpTool],
				createdAt: '',
				updatedAt: ''
			}
		];
		try {
			const { body } = render(ToolCallCard, { props: { call: { id: 'c1', name: 'sample_add', args: {} } } });
			// The mark is a filled shape, so it is drawn without a stroke.
			expect(body).toContain('M13.85 0a4.16');
			expect(body).toContain('fill="currentColor"');
			expect(body).toContain('stroke="none"');
		} finally {
			app.mcpServers = [];
		}
	});

	it('gives each tool the shape that matches it', () => {
		const icon = (name: string, args: Record<string, unknown> = {}) =>
			render(ToolCallCard, { props: { call: { id: 'c', name, args } } }).body;
		// The skill wears an open book, not the two panels it had before.
		expect(icon('read_skill', { name: 'release-notes' })).toContain('M12 7v14');
		expect(icon('web_search', { query: 'x' })).toContain('<circle cx="11" cy="11" r="6"/>');
		expect(icon('web_fetch', { url: 'https://example.com' })).toContain('<circle cx="12" cy="12" r="8"/>');
		// A name nobody knows keeps the tools mark.
		expect(icon('something-else')).toContain('M14.7 6.3a1 1');
	});
});
