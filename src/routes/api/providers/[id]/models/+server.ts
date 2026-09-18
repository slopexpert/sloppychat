import type { RequestHandler } from './$types';
import { bad } from '$lib/server/http';
import { getProvider } from '$lib/server/store';
import { listModels } from '$lib/server/openai';

/** Live model discovery for one provider (GET /v1/models). */
export const GET = (async ({ params }) => {
	const provider = getProvider(params.id);
	if (!provider) return bad('Provider not found', 404);
	try {
		const models = await listModels(provider, AbortSignal.timeout(20000));
		return Response.json({ models, count: models.length });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const timedOut = /abort|timeout|time out/i.test(message);
		return bad(timedOut ? `Model list timed out for ${provider.name}` : message, 502);
	}
}) satisfies RequestHandler;
