import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { deleteProvider, getProvider, updateProvider } from '$lib/server/store';
import { toDTO } from '$lib/server/dto';
import type { Provider } from '$lib/shared/types';

export const PATCH = (async ({ params, request }) => {
	const id = params.id;
	if (!getProvider(id)) return bad('Provider not found', 404);
	const patch = await body<Partial<Provider> & { apiKey?: string }>(request);
	const clean: Partial<Provider> = {};
	if (patch.name !== undefined) clean.name = String(patch.name).trim();
	if (patch.baseUrl !== undefined) clean.baseUrl = String(patch.baseUrl).trim();
	if (patch.defaultModel !== undefined) clean.defaultModel = patch.defaultModel ? String(patch.defaultModel) : null;
	if (patch.enabled !== undefined) clean.enabled = !!patch.enabled;
	if (patch.sort !== undefined) clean.sort = Number(patch.sort) || 0;
	// An empty string clears the key, a missing field keeps it.
	if (patch.apiKey !== undefined) clean.apiKey = String(patch.apiKey);
	const updated = updateProvider(id, clean);
	if (!updated) return bad('Provider not found', 404);
	return Response.json({ provider: toDTO(updated) });
}) satisfies RequestHandler;

export const DELETE = (async ({ params }) => {
	deleteProvider(params.id);
	return Response.json({ ok: true });
}) satisfies RequestHandler;
