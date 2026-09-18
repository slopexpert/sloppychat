import type { RequestHandler } from './$types';
import { getSettings, saveSettings } from '$lib/server/store';
import { body } from '$lib/server/http';
import type { Settings } from '$lib/shared/types';

export const GET = (() => {
	return new Response(JSON.stringify(getSettings()), {
		headers: { 'content-type': 'application/json' }
	});
}) satisfies RequestHandler;

export const PUT = (async ({ request }) => {
	const patch = await body<Partial<Settings>>(request);
	// API keys for search arrive here, so never log the payload.
	return new Response(JSON.stringify(saveSettings(patch)), {
		headers: { 'content-type': 'application/json' }
	});
}) satisfies RequestHandler;
