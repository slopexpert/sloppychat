/**
 * The prompt library: short texts the user reuses.
 *
 * Two kinds. A `user` prompt is a composer snippet, inserted where the caret
 * sits by typing `/name` and pressing Tab. A `system` prompt fills the system
 * prompt field, from the params panel or from Settings.
 *
 * Both kinds can hold variables such as `{{date}}` or `{{model}}`. A known name
 * is replaced with its value; any other `{{name}}` is left alone, so it stays
 * visible as a blank to fill in.
 */

export type PromptKind = 'user' | 'system';

export interface PromptEntry {
	id: string;
	title: string;
	description: string;
	body: string;
	kind: PromptKind;
	sort: number;
	createdAt: string;
	updatedAt: string;
}

/** Fields a new prompt needs; the rest is filled by the store. */
export type PromptInput = Partial<Pick<PromptEntry, 'id' | 'title' | 'description' | 'body' | 'kind' | 'sort'>>;

const MAX_TITLE = 64;
const MAX_DESCRIPTION = 300;

/** Names the app can fill in, shown as the hint in Settings. */
export const PROMPT_VARS = ['date', 'time', 'datetime', 'model', 'provider', 'chat'] as const;

const VAR_PATTERN = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

/** Title as typed, trimmed and capped; the slash key is derived from it. */
export function promptTitle(value: string): string {
	const title = (value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE);
	return title || 'prompt';
}

export function promptDescription(value: string): string {
	return (value ?? '').trim().slice(0, MAX_DESCRIPTION);
}

/** The token typed after `/`: lowercase words joined by hyphens. */
export function promptKey(value: string): string {
	const key = (value ?? '')
		.trim()
		.toLowerCase()
		.replace(/\.[a-z]+$/i, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_TITLE)
		.replace(/-+$/, '');
	return key || 'prompt';
}

export interface PromptVars {
	date?: string;
	time?: string;
	datetime?: string;
	model?: string;
	provider?: string;
	chat?: string;
}

/** Local date and clock as `2026-08-14` and `17:05`, no locale in the way. */
export function clockVars(now: Date = new Date()): PromptVars {
	const pad = (value: number) => String(value).padStart(2, '0');
	const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
	return { date, time, datetime: `${date} ${time}` };
}

/** True when the name is one the app can fill in. */
export function knownVar(name: string): boolean {
	return (PROMPT_VARS as readonly string[]).includes(name.trim().toLowerCase());
}

/**
 * Replaces every known variable. Unknown names are kept as they stand, which is
 * how a snippet marks a blank the user still has to fill in.
 */
export function expandPromptVars(text: string, vars: PromptVars): string {
	if (!text) return '';
	return text.replace(VAR_PATTERN, (whole, name: string) => {
		const key = name.trim().toLowerCase();
		if (!knownVar(key)) return whole;
		const value = vars[key as keyof PromptVars];
		return value === undefined || value === '' ? whole : value;
	});
}

/** The first `{{name}}` the app cannot fill in, as offsets into the text. */
export function firstBlank(text: string): { start: number; end: number; name: string } | null {
	if (!text) return null;
	VAR_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = VAR_PATTERN.exec(text))) {
		if (knownVar(match[1])) continue;
		return { start: match.index, end: match.index + match[0].length, name: match[1] };
	}
	return null;
}

/** A live `/query` at the caret, with the offset the token started at. */
export function slashQuery(text: string, caret: number): { start: number; query: string } | null {
	if (!text || caret < 1 || caret > text.length) return null;
	const before = text.slice(0, caret);
	const match = /(?:^|\n)\/([a-z0-9-]*)$/i.exec(before);
	if (!match) return null;
	return { start: caret - match[1].length - 1, query: match[1] };
}

/** The body of the snippet whose slug is exactly this token, if there is one. */
export function commandEntry<T extends Pick<PromptEntry, 'title' | 'kind'>>(
	entries: T[],
	name: string,
	kind: PromptKind = 'user'
): T | undefined {
	const wanted = name.trim().toLowerCase();
	return entries.find((entry) => entry.kind === kind && promptKey(entry.title) === wanted);
}

/**
 * Fills every `/slug` command at the start of a line into its text, which is what
 * happens when a message is sent. Only a whole slug that names a prompt is
 * touched, so a path or a fraction stays as it was typed.
 */
export function expandCommands<T extends Pick<PromptEntry, 'title' | 'kind' | 'body'>>(
	text: string,
	entries: T[],
	vars: PromptVars
): string {
	if (!text || !entries.length) return text;
	return text.replace(/(^|\n)\/([a-z0-9-]+)(?![a-z0-9-])/g, (whole, edge: string, name: string) => {
		const entry = commandEntry(entries, name);
		if (!entry) return whole;
		const body = expandPromptVars(entry.body, vars);
		// A prompt nobody filled in yet is better left visible than sent empty.
		return body.trim() ? edge + body : whole;
	});
}

/** Prompts that match a slash query, best first. An empty query lists them all. */
export function filterPrompts<T extends Pick<PromptEntry, 'title' | 'kind'>>(
	items: T[],
	query: string,
	kind: PromptKind = 'user'
): T[] {
	const wanted = query.trim().toLowerCase();
	const ranked: { item: T; rank: number }[] = [];
	for (const item of items) {
		if (item.kind !== kind) continue;
		const key = promptKey(item.title);
		let rank = -1;
		if (!wanted) rank = 0;
		else if (key.startsWith(wanted)) rank = 1;
		else if (key.includes(wanted)) rank = 2;
		else if (item.title.toLowerCase().includes(wanted)) rank = 3;
		if (rank >= 0) ranked.push({ item, rank });
	}
	return ranked
		.sort((a, b) => a.rank - b.rank || promptKey(a.item.title).localeCompare(promptKey(b.item.title)))
		.slice(0, 8)
		.map((entry) => entry.item);
}
