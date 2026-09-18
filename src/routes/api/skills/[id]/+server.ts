import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { deleteSkill, getSkill, saveSkill } from '$lib/server/store';
import { skillSlug } from '$lib/shared/skills';

/** One skill in full, which is what the read_skill tool fetches. */
export const GET = (({ params }) => {
	const skill = getSkill(params.id);
	if (!skill) return bad('Skill not found', 404);
	return Response.json({ skill });
}) satisfies RequestHandler;

export const PATCH = (async ({ params, request }) => {
	const current = getSkill(params.id);
	if (!current) return bad('Skill not found', 404);
	const patch = await body<{ name?: string; description?: string; body?: string; enabled?: boolean }>(request);
	return Response.json({
		skill: saveSkill({
			id: current.id,
			name: patch.name !== undefined ? skillSlug(patch.name) : current.name,
			description: patch.description ?? current.description,
			body: patch.body ?? current.body,
			enabled: patch.enabled ?? current.enabled
		})
	});
}) satisfies RequestHandler;

export const DELETE = (({ params }) => {
	deleteSkill(params.id);
	return Response.json({ ok: true });
}) satisfies RequestHandler;
