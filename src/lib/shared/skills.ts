/**
 * Skills, following the usual agent skills layout: one markdown file per skill
 * with YAML frontmatter for `name` and `description`, then the instructions.
 *
 *   ---
 *   name: release-notes
 *   description: Use when the user asks for release notes.
 *   ---
 *
 *   # Steps
 *   ...
 *
 * Only the name and description are read from the frontmatter; other keys are
 * kept in the file but ignored here. Skills are advertised to the model by name
 * and description, and its full text is loaded on demand through a tool, which
 * is what keeps a large library cheap on context.
 */

export interface Skill {
	id: string;
	name: string;
	description: string;
	body: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface ParsedSkill {
	name: string;
	description: string;
	body: string;
}

const MAX_NAME = 64;
const MAX_DESCRIPTION = 400;

/** Lowercase words joined by hyphens, as the standard expects. */
export function skillSlug(value: string): string {
	const slug = (value ?? '')
		.trim()
		.toLowerCase()
		.replace(/\.md$/i, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_NAME)
		.replace(/-+$/, '');
	return slug || 'skill';
}

/** `key: value` lines, with optional quotes around the value. */
function parseFrontmatter(block: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const line of block.split('\n')) {
		const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
		if (!match) continue;
		let value = match[2].trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		values[match[1].toLowerCase()] = value;
	}
	return values;
}

function firstHeading(body: string): string | undefined {
	const match = /^#{1,3}\s+(.+)$/m.exec(body);
	return match?.[1]?.trim();
}

/** First line of prose, used when there is no description in the frontmatter. */
function firstParagraph(body: string): string {
	for (const line of body.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---')) continue;
		return trimmed.slice(0, MAX_DESCRIPTION);
	}
	return '';
}

/** Reads a markdown file into a skill, filling gaps from the content itself. */
export function parseSkillMarkdown(text: string, fallbackName = 'skill'): ParsedSkill {
	const normalized = (text ?? '').replace(/\r\n?/g, '\n');
	const frontmatter = /^---\n([\s\S]*?)\n---[ \t]*\n?/.exec(normalized);
	const fields = frontmatter ? parseFrontmatter(frontmatter[1]) : {};
	const body = (frontmatter ? normalized.slice(frontmatter[0].length) : normalized).replace(/^\n+/, '');

	return {
		name: skillSlug(fields.name || firstHeading(body) || fallbackName),
		description: (fields.description || firstParagraph(body)).slice(0, MAX_DESCRIPTION).trim(),
		body: body.trimEnd()
	};
}

/** The block added to the system prompt: names and descriptions only. */
export function skillsSection(skills: Pick<Skill, 'name' | 'description'>[]): string {
	if (!skills.length) return '';
	const lines = skills.map((skill) => `- ${skill.name}: ${skill.description || 'no description'}`);
	return [
		'## Skills',
		'When a task matches one of these, call read_skill with its name and follow the instructions it returns.',
		...lines
	].join('\n');
}

/** The catalog entry the model sees as a tool result. */
export function skillToolResult(skill: Pick<Skill, 'name' | 'description' | 'body'>): string {
	const header = [`skill: ${skill.name}`, skill.description ? `description: ${skill.description}` : '']
		.filter(Boolean)
		.join('\n');
	return `${header}\n\n${skill.body}`;
}
