import type { RequestHandler } from './$types';
import { bad } from '$lib/server/http';
import { listPrompts, savePrompt } from '$lib/server/store';
import { promptTitle, type PromptKind } from '$lib/shared/prompts';

/** Lists the library, newest order last: by sort, then by title. */
export const GET = (({ url }) => {
	const kind = url.searchParams.get('kind');
	if (kind && kind !== 'user' && kind !== 'system') return bad('kind is user or system');
	return Response.json({ prompts: listPrompts(kind ? (kind as PromptKind) : undefined) });
}) satisfies RequestHandler;

/** Adds one prompt, written by hand in Settings. */
export const POST = (async ({ request }) => {
	const input = (await request.json().catch(() => ({}))) as {
		title?: string;
		description?: string;
		body?: string;
		kind?: string;
	};
	if (!input.title?.trim()) return bad('A prompt needs a title');
	return Response.json(
		{
			prompt: savePrompt({
				title: promptTitle(input.title),
				description: input.description ?? '',
				body: input.body ?? '',
				kind: input.kind === 'system' ? 'system' : 'user'
			})
		},
		{ status: 201 }
	);
}) satisfies RequestHandler;
