import type { Provider, ProviderDTO } from '$lib/shared/types';

/** Providers never leave the server with their API key attached. */
export function toDTO(provider: Provider): ProviderDTO {
	const { apiKey, ...rest } = provider;
	return { ...rest, hasKey: apiKey.length > 0 };
}
