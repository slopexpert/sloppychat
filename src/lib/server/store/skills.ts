/** The skill files the model can read, stored as markdown. */

import { all, one, run, newId, now } from '../db';
import { str, type Row } from './rows';
import { type Skill } from '$lib/shared/skills';

function mapSkill(row: Row): Skill {
	return {
		id: str(row.id),
		name: str(row.name, 'skill'),
		description: str(row.description),
		body: str(row.body),
		enabled: row.enabled === 1,
		createdAt: str(row.created_at),
		updatedAt: str(row.updated_at)
	};
}

export function listSkills(): Skill[] {
	return all('SELECT * FROM skills ORDER BY name').map(mapSkill);
}

export function getSkill(id: string): Skill | undefined {
	const row = one('SELECT * FROM skills WHERE id = ?', id);
	return row ? mapSkill(row) : undefined;
}

export function getSkillByName(name: string): Skill | undefined {
	const row = one('SELECT * FROM skills WHERE name = ?', name);
	return row ? mapSkill(row) : undefined;
}

/** Reads the skills the model should be told about. */
export function enabledSkills(): Skill[] {
	return all('SELECT * FROM skills WHERE enabled = 1 ORDER BY name').map(mapSkill);
}

/** Creates a skill, or replaces the one with the same name. */
export function saveSkill(input: {
	id?: string;
	name: string;
	description?: string;
	body?: string;
	enabled?: boolean;
}): Skill {
	const existing = getSkillByName(input.name);
	const id = input.id ?? existing?.id ?? newId();
	const stamp = now();
	if (existing?.id && existing.id !== id) run('DELETE FROM skills WHERE id = ?', existing.id);
	run(
		`INSERT INTO skills (id, name, description, body, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
		 body = excluded.body, enabled = excluded.enabled, updated_at = excluded.updated_at`,
		id,
		input.name,
		input.description ?? existing?.description ?? '',
		input.body ?? existing?.body ?? '',
		(input.enabled ?? existing?.enabled ?? true) ? 1 : 0,
		existing?.createdAt ?? stamp,
		stamp
	);
	return getSkill(id)!;
}

export function deleteSkill(id: string): void {
	run('DELETE FROM skills WHERE id = ?', id);
}
