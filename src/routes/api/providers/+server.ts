import type { RequestHandler } from './$types';
import { bad, body } from '$lib/server/http';
import { createProvider, listProviders } from '$lib/server/store';
import { toDTO } from '$lib/server/dto';
import type { Provider } from '$lib/shared/types';

export const GET = (() => {
	return Response.json({ providers: listProviders().map(toDTO) });
}) satisfies RequestHandler;

export const POST = (async ({ request }) => {
	const input = await body<Partial<Provider> & { name?: string; baseUrl?: string }>(request);
	if (!input.name?.trim()) return bad('Provider needs a name');
	if (!input.baseUrl?.trim()) return bad('Provider needs a base URL');
	let url: URL;
	try {
		url = new URL(input.baseUrl.trim());
	} catch {
		return bad('Base URL must be absolute, for example https://api.openai.com/v1');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return bad('Base URL must use http or https');
	const provider = createProvider({
		name: input.name.trim(),
		baseUrl: input.baseUrl.trim(),
		apiKey: input.apiKey ?? '',
		defaultModel: input.defaultModel ?? null,
		enabled: input.enabled !== false
	});
	return Response.json({ provider: toDTO(provider) }, { status: 201 });
}) satisfies RequestHandler;
