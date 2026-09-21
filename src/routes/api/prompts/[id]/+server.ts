import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { deletePrompt, getPrompt, savePrompt } from '$lib/server/store';
import { promptTitle, type PromptKind } from '$lib/shared/prompts';

export const GET = (({ params }) => {
	const prompt = getPrompt(params.id);
	if (!prompt) return bad('Prompt not found', 404);
	return Response.json({ prompt });
}) satisfies RequestHandler;

export const PATCH = (async ({ params, request }) => {
	const current = getPrompt(params.id);
	if (!current) return bad('Prompt not found', 404);
	const patch = await body<{
		title?: string;
		description?: string;
		body?: string;
		kind?: PromptKind;
		sort?: number;
	}>(request);
	return Response.json({
		prompt: savePrompt({
			id: current.id,
			title: patch.title !== undefined ? promptTitle(patch.title) : current.title,
			description: patch.description ?? current.description,
			body: patch.body ?? current.body,
			kind: patch.kind === 'system' || patch.kind === 'user' ? patch.kind : current.kind,
			sort: patch.sort ?? current.sort
		})
	});
}) satisfies RequestHandler;

export const DELETE = (({ params }) => {
	deletePrompt(params.id);
	return Response.json({ ok: true });
}) satisfies RequestHandler;
