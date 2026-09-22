import type { RequestHandler } from './$types';
import { getSettings, saveSettings } from '$lib/server/store';
import { body } from '$lib/server/http';
import { toSettingsDTO } from '$lib/server/dto';
import { cleanSettings } from '$lib/shared/settings';

export const GET = (() => {
	// The answer carries no search key: the page is told whether one is set.
	return new Response(JSON.stringify(toSettingsDTO(getSettings())), {
		headers: { 'content-type': 'application/json' }
	});
}) satisfies RequestHandler;

export const PUT = (async ({ request }) => {
	// Every field is checked before it is written, because the code that reads the
	// settings trusts the types it gets back.
	const patch = cleanSettings(await body<unknown>(request));
	// API keys for search arrive here, so never log the payload.
	return new Response(JSON.stringify(toSettingsDTO(saveSettings(patch))), {
		headers: { 'content-type': 'application/json' }
	});
}) satisfies RequestHandler;
