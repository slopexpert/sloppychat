/** The prompt library: message snippets and system prompts. */

import { all, one, run, newId, now } from '../db';
import { str, type Row } from './rows';
import { promptDescription, promptTitle, type PromptEntry, type PromptKind } from '$lib/shared/prompts';

function mapPrompt(row: Row): PromptEntry {
	return {
		id: str(row.id),
		title: str(row.title, 'prompt'),
		description: str(row.description),
		body: str(row.body),
		kind: row.kind === 'system' ? 'system' : 'user',
		sort: typeof row.sort === 'number' ? row.sort : 0,
		createdAt: str(row.created_at),
		updatedAt: str(row.updated_at)
	};
}

export function listPrompts(kind?: PromptKind): PromptEntry[] {
	const rows = kind
		? all('SELECT * FROM prompts WHERE kind = ? ORDER BY sort, title', kind)
		: all('SELECT * FROM prompts ORDER BY sort, title');
	return rows.map(mapPrompt);
}

export function getPrompt(id: string): PromptEntry | undefined {
	const row = one('SELECT * FROM prompts WHERE id = ?', id);
	return row ? mapPrompt(row) : undefined;
}

/** Creates a prompt, or updates the one with the same id. */
export function savePrompt(input: {
	id?: string;
	title: string;
	description?: string;
	body?: string;
	kind?: PromptKind;
	sort?: number;
}): PromptEntry {
	const existing = input.id ? getPrompt(input.id) : undefined;
	const id = input.id ?? newId();
	const stamp = now();
	run(
		`INSERT INTO prompts (id, title, description, body, kind, sort, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description,
		 body = excluded.body, kind = excluded.kind, sort = excluded.sort, updated_at = excluded.updated_at`,
		id,
		promptTitle(input.title),
		promptDescription(input.description ?? existing?.description ?? ''),
		input.body ?? existing?.body ?? '',
		input.kind ?? existing?.kind ?? 'user',
		input.sort ?? existing?.sort ?? 0,
		existing?.createdAt ?? stamp,
		stamp
	);
	return getPrompt(id)!;
}

export function deletePrompt(id: string): void {
	run('DELETE FROM prompts WHERE id = ?', id);
}
