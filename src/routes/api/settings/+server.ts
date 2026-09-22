import type { RequestHandler } from './$types';
import { getSettings, saveSettings } from '$lib/server/store';
import { body } from '$lib/server/http';
import { cleanSettings } from '$lib/shared/settings';

export const GET = (() => {
	return new Response(JSON.stringify(getSettings()), {
		headers: { 'content-type': 'application/json' }
	});
}) satisfies RequestHandler;

export const PUT = (async ({ request }) => {
	// Every field is checked before it is written, because the code that reads the
	// settings trusts the types it gets back.
	const patch = cleanSettings(await body<unknown>(request));
	// API keys for search arrive here, so never log the payload.
	return new Response(JSON.stringify(saveSettings(patch)), {
		headers: { 'content-type': 'application/json' }
	});
}) satisfies RequestHandler;
