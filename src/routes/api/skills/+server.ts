import type { RequestHandler } from './$types';
import { bad } from '$lib/server/http';
import { getSkillByName, listSkills, saveSkill } from '$lib/server/store';
import { parseSkillMarkdown, skillSlug } from '$lib/shared/skills';

/** Lists the skills, or adds them from uploaded markdown files. */
export const GET = (({ url }) => {
	// The read_skill tool looks a skill up by the name the model was given.
	const name = url.searchParams.get('name');
	if (name) {
		const skill = getSkillByName(skillSlug(name));
		if (!skill) return bad(`No skill called ${name}`, 404);
		return Response.json({ skill });
	}
	return Response.json({ skills: listSkills() });
}) satisfies RequestHandler;

/**
 * Accepts either one or more markdown files (multipart, field "file"), or a
 * JSON body when a skill is written by hand in the settings.
 */
export const POST = (async ({ request }) => {
	const contentType = request.headers.get('content-type') ?? '';

	if (contentType.includes('multipart/form-data')) {
		const form = await request.formData().catch(() => undefined);
		if (!form) return bad('Could not read the upload');
		const files = form.getAll('file').filter((entry): entry is File => entry instanceof File);
		if (!files.length) return bad('Attach one or more markdown files');
		const saved = [];
		for (const file of files) {
			if (file.size > 512 * 1024) return bad(`${file.name} is larger than 512 KB`);
			const text = await file.text();
			const parsed = parseSkillMarkdown(text, skillSlug(file.name));
			saved.push(saveSkill(parsed));
		}
		return Response.json({ skills: saved }, { status: 201 });
	}

	const input = (await request.json().catch(() => ({}))) as {
		name?: string;
		description?: string;
		body?: string;
		enabled?: boolean;
	};
	if (!input.name?.trim()) return bad('A skill needs a name');
	return Response.json(
		{
			skill: saveSkill({
				name: skillSlug(input.name),
				description: input.description ?? '',
				body: input.body ?? '',
				enabled: input.enabled !== false
			})
		},
		{ status: 201 }
	);
}) satisfies RequestHandler;
