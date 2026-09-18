import { describe, expect, it } from 'vitest';
import { parseSkillMarkdown, skillSlug, skillsSection, skillToolResult } from '$lib/shared/skills';

/** Skills follow the usual layout: frontmatter, then instructions. */

const FILE = `---
name: release-notes
description: Use when the user asks for release notes.
---

# Release notes

1. Collect the merged pull requests.
2. Group them by area.
`;

describe('skillSlug', () => {
	it('lowercases and hyphenates', () => {
		expect(skillSlug('Release Notes')).toBe('release-notes');
		expect(skillSlug('pdf_report.md')).toBe('pdf-report');
		expect(skillSlug('  Spaced   Out  ')).toBe('spaced-out');
		expect(skillSlug('already-fine')).toBe('already-fine');
	});

	it('never returns an empty name', () => {
		expect(skillSlug('')).toBe('skill');
		expect(skillSlug('!!!')).toBe('skill');
	});

	it('caps the length', () => {
		expect(skillSlug('a'.repeat(200)).length).toBeLessThanOrEqual(64);
	});
});

describe('parseSkillMarkdown', () => {
	it('reads name and description from the frontmatter', () => {
		const skill = parseSkillMarkdown(FILE, 'fallback');
		expect(skill.name).toBe('release-notes');
		expect(skill.description).toBe('Use when the user asks for release notes.');
		expect(skill.body.startsWith('# Release notes')).toBe(true);
		expect(skill.body).toContain('Collect the merged pull requests');
		expect(skill.body).not.toContain('---');
	});

	it('accepts quoted values and ignores other keys', () => {
		const skill = parseSkillMarkdown(
			'---\nname: "quoted-name"\ndescription: \'Single quoted\'\nallowed-tools: web_search\n---\n\nBody here.\n'
		);
		expect(skill.name).toBe('quoted-name');
		expect(skill.description).toBe('Single quoted');
		expect(skill.body).toBe('Body here.');
	});

	it('derives the name from the file name without frontmatter', () => {
		const skill = parseSkillMarkdown('# My Skill\n\nDoes a thing.\n', 'My Skill.md');
		expect(skill.name).toBe('my-skill');
		expect(skill.description).toBe('Does a thing.');
	});

	it('uses the first heading when the body has no prose', () => {
		const skill = parseSkillMarkdown('## Only A Heading\n', 'file.md');
		expect(skill.name).toBe('only-a-heading');
	});

	it('handles CRLF, a missing closing body and a leading blank line', () => {
		const skill = parseSkillMarkdown('---\r\nname: crlf\r\n---\r\n\r\nStep one.\r\n');
		expect(skill.name).toBe('crlf');
		expect(skill.body).toBe('Step one.');
	});

	it('keeps a description that is only in the frontmatter empty when absent', () => {
		const skill = parseSkillMarkdown('---\nname: bare\n---\n\n# Heading only\n');
		expect(skill.description).toBe('');
	});

	it('does not treat a body that starts with a rule as frontmatter', () => {
		const skill = parseSkillMarkdown('---\n\n# Not frontmatter\n');
		expect(skill.name).toBe('not-frontmatter');
	});

	it('survives empty input', () => {
		const skill = parseSkillMarkdown('', 'empty-skill');
		expect(skill.name).toBe('empty-skill');
		expect(skill.body).toBe('');
	});
});

describe('prompt and tool text', () => {
	it('lists skills by name and description only', () => {
		const section = skillsSection([
			{ name: 'release-notes', description: 'Use for release notes.' },
			{ name: 'silent', description: '' }
		]);
		expect(section).toContain('## Skills');
		expect(section).toContain('read_skill');
		expect(section).toContain('- release-notes: Use for release notes.');
		expect(section).toContain('- silent: no description');
		// The instructions themselves stay out of the prompt.
		expect(section).not.toContain('Collect the merged pull requests');
	});

	it('is empty when there are no skills', () => {
		expect(skillsSection([])).toBe('');
	});

	it('gives the whole skill to the tool result', () => {
		const text = skillToolResult(parseSkillMarkdown(FILE));
		expect(text.startsWith('skill: release-notes')).toBe(true);
		expect(text).toContain('description: Use when the user asks for release notes.');
		expect(text).toContain('Collect the merged pull requests');
	});
});
