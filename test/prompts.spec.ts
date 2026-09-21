import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	clockVars,
	commandEntry,
	expandCommands,
	expandPromptVars,
	filterPrompts,
	firstBlank,
	promptKey,
	promptTitle,
	slashQuery
} from '$lib/shared/prompts';

/** The library holds reusable texts with blanks and variables in them. */

describe('promptTitle and promptKey', () => {
	it('trims the title and keeps one space between words', () => {
		expect(promptTitle('  Weekly   report  ')).toBe('Weekly report');
		expect(promptTitle('')).toBe('prompt');
	});

	it('turns a title into the token typed after the slash', () => {
		expect(promptKey('Weekly report')).toBe('weekly-report');
		expect(promptKey('Release_Notes.md')).toBe('release-notes');
		expect(promptKey('!!!')).toBe('prompt');
	});
});

describe('expandPromptVars', () => {
	const vars = { ...clockVars(new Date('2026-08-14T17:05:00')), model: 'qwen', provider: 'Ollama', chat: 'Drafts' };

	it('fills the names it knows, spaces and case aside', () => {
		expect(expandPromptVars('On {{date}} at {{ time }}', vars)).toBe('On 2026-08-14 at 17:05');
		expect(expandPromptVars('{{MODEL}} on {{Provider}} in {{CHAT}}', vars)).toBe('qwen on Ollama in Drafts');
		expect(expandPromptVars('{{datetime}}', vars)).toBe('2026-08-14 17:05');
	});

	it('leaves an unknown name as the blank it is', () => {
		expect(expandPromptVars('Topic: {{topic}}. Signed {{date}}', vars)).toBe('Topic: {{topic}}. Signed 2026-08-14');
	});

	it('leaves a known name alone while its value is missing', () => {
		expect(expandPromptVars('Model {{model}}', { date: '2026-08-14' })).toBe('Model {{model}}');
	});

	it('is empty on empty input and plain on text with no braces', () => {
		expect(expandPromptVars('', vars)).toBe('');
		expect(expandPromptVars('Plain text', vars)).toBe('Plain text');
	});

	it('does not treat a template hole as a variable', () => {
		expect(expandPromptVars('const t = {{ key: 1 }}', vars)).toBe('const t = {{ key: 1 }}');
	});
});

describe('firstBlank', () => {
	it('finds the first name the app cannot fill', () => {
		const text = 'Summarise {{topic}} for {{chat}}';
		const blank = firstBlank(text);
		expect(blank?.name).toBe('topic');
		expect(text.slice(blank!.start, blank!.end)).toBe('{{topic}}');
	});

	it('skips the names it knows and returns null when nothing is left', () => {
		expect(firstBlank('{{date}} {{model}}')).toBeNull();
		expect(firstBlank('no blanks')).toBeNull();
	});
});

describe('slashQuery', () => {
	it('reads a token opened by a slash at the start of a line', () => {
		expect(slashQuery('/week', 5)).toEqual({ start: 0, query: 'week' });
		expect(slashQuery('note\n/rel', 9)).toEqual({ start: 5, query: 'rel' });
		expect(slashQuery('/', 1)).toEqual({ start: 0, query: '' });
	});

	it('keeps the hyphen of a slug together', () => {
		expect(slashQuery('/bug-report', 11)).toEqual({ start: 0, query: 'bug-report' });
	});

	it('ignores a slash that is not at the start of a line', () => {
		expect(slashQuery('a/b', 3)).toBeNull();
		expect(slashQuery('http://', 7)).toBeNull();
	});

	it('ignores a token with a space or a word character it cannot match', () => {
		expect(slashQuery('/two words', 11)).toBeNull();
		expect(slashQuery('/under_score', 12)).toBeNull();
	});

	it('reads up to the caret, and nothing before the slash', () => {
		// With the caret inside a longer word, only the text before it counts.
		expect(slashQuery('/week', 3)).toEqual({ start: 0, query: 'we' });
		expect(slashQuery('/week', 0)).toBeNull();
	});
});

describe('commandEntry', () => {
	const entries = [
		{ title: 'Bug report', kind: 'user' as const, body: 'Steps:' },
		{ title: 'Notes', kind: 'system' as const, body: 'You take notes.' }
	];

	it('wants the whole slug, case aside', () => {
		expect(commandEntry(entries, 'bug-report')?.title).toBe('Bug report');
		expect(commandEntry(entries, ' BUG-Report ')?.title).toBe('Bug report');
	});

	it('will not guess from a prefix, so a path stays a path', () => {
		expect(commandEntry(entries, 'bug')).toBeUndefined();
		expect(commandEntry(entries, 'etc')).toBeUndefined();
	});

	it('stays inside its kind', () => {
		expect(commandEntry(entries, 'notes')).toBeUndefined();
		expect(commandEntry(entries, 'notes', 'system')?.title).toBe('Notes');
	});
});

describe('expandCommands', () => {
	const entries = [
		{ title: 'Bug report', kind: 'user' as const, body: 'Steps:\n1. {{topic}}' },
		{ title: 'Notes', kind: 'user' as const, body: 'Note for {{date}}:' },
		{ title: 'Reporter', kind: 'system' as const, body: 'You report.' },
		{ title: 'Hollow', kind: 'user' as const, body: '   ' }
	];
	const vars = { ...clockVars(new Date('2026-08-14T17:05:00')), chat: 'Drafts' };

	it('fills a command at the start of a line and keeps what follows', () => {
		expect(expandCommands('/notes draft this', entries, vars)).toBe('Note for 2026-08-14: draft this');
	});

	it('fills each line of a multi line message', () => {
		expect(expandCommands('/notes one\n/notes two', entries, vars)).toBe(
			'Note for 2026-08-14: one\nNote for 2026-08-14: two'
		);
	});

	it('leaves a slash that is not a prompt as it was typed', () => {
		expect(expandCommands('/etc/hosts is missing', entries, vars)).toBe('/etc/hosts is missing');
		expect(expandCommands('see /notes here', entries, vars)).toBe('see /notes here');
		expect(expandCommands('/reporter prompt', entries, vars)).toBe('/reporter prompt');
	});

	it('leaves a prompt with no text visible rather than sending nothing', () => {
		expect(expandCommands('/hollow please', entries, vars)).toBe('/hollow please');
	});

	it('is unchanged when the library is empty or the text has no slash', () => {
		expect(expandCommands('/notes', [], vars)).toBe('/notes');
		expect(expandCommands('plain words', entries, vars)).toBe('plain words');
		expect(expandCommands('', entries, vars)).toBe('');
	});
});

describe('filterPrompts', () => {
	const items = [
		{ title: 'Weekly report', kind: 'user' as const },
		{ title: 'Release notes', kind: 'user' as const },
		{ title: 'Release plan', kind: 'user' as const },
		{ title: 'Code review', kind: 'system' as const },
		{ title: 'Reporter role', kind: 'system' as const }
	];

	it('puts a prefix before a partial match, and both before a title match', () => {
		const titles = filterPrompts(items, 're').map((item) => item.title);
		expect(titles[0]).toBe('Release notes');
		expect(titles).toContain('Weekly report');
	});

	it('lists one kind only, so a system prompt is not offered as a snippet', () => {
		expect(filterPrompts(items, '', 'user').map((item) => item.title)).toEqual([
			'Release notes',
			'Release plan',
			'Weekly report'
		]);
		expect(filterPrompts(items, 'code', 'system').map((item) => item.title)).toEqual(['Code review']);
	});

	it('drops what does not match at all', () => {
		expect(filterPrompts(items, 'zzz', 'user')).toEqual([]);
	});
});

/* ------------------------------------------------------------- the store side */

const dir = mkdtempSync(join(tmpdir(), 'sloppychat-prompts-'));
process.env.SLOPPYCHAT_DB = join(dir, 'prompts.db');

const store = await import('$lib/server/store');

describe('the prompt library in the database', () => {
	it('saves, reads and updates one prompt', () => {
		const created = store.savePrompt({
			title: '  Weekly   report ',
			description: 'Friday summary',
			body: 'Summarise {{topic}} since {{date}}.',
			kind: 'user'
		});
		expect(created.title).toBe('Weekly report');
		expect(store.getPrompt(created.id)?.body).toContain('{{topic}}');

		const updated = store.savePrompt({ id: created.id, title: created.title, body: 'Rewritten', kind: 'system' });
		expect(updated.body).toBe('Rewritten');
		expect(updated.kind).toBe('system');
		expect(updated.description).toBe('Friday summary');
		expect(updated.createdAt).toBe(created.createdAt);
	});

	it('keeps the two kinds apart in the list', () => {
		store.savePrompt({ title: 'Reporter role', body: 'You report.', kind: 'system' });
		store.savePrompt({ title: 'Bug report', body: 'Steps to reproduce:', kind: 'user' });
		const systems = store.listPrompts('system').map((entry) => entry.title);
		const snippets = store.listPrompts('user').map((entry) => entry.title);
		expect(systems).toContain('Reporter role');
		expect(snippets).toEqual(['Bug report']);
		expect(store.listPrompts().length).toBeGreaterThanOrEqual(3);
	});

	it('sorts by the sort field first, then by title', () => {
		const late = store.savePrompt({ title: 'Zebra', body: '', kind: 'user', sort: 5 });
		const first = store.savePrompt({ title: 'Aardvark', body: '', kind: 'user', sort: 1 });
		const titles = store.listPrompts('user').map((entry) => entry.title);
		expect(titles.indexOf('Aardvark')).toBeLessThan(titles.indexOf('Zebra'));
		store.deletePrompt(first.id);
		store.deletePrompt(late.id);
	});

	it('deletes without touching the others', () => {
		const doomed = store.savePrompt({ title: 'Doomed', body: 'x', kind: 'user' });
		const keep = store.savePrompt({ title: 'Kept', body: 'y', kind: 'user' });
		store.deletePrompt(doomed.id);
		expect(store.getPrompt(doomed.id)).toBeUndefined();
		expect(store.getPrompt(keep.id)?.title).toBe('Kept');
	});
});
