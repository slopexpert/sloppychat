import type {
	McpServerConfig,
	Provider,
	ProviderDTO,
	Settings,
	SettingsDTO
} from '$lib/shared/types';

/** Providers never leave the server with their API key attached. */
export function toDTO(provider: Provider): ProviderDTO {
	const { apiKey, ...rest } = provider;
	return { ...rest, hasKey: apiKey.length > 0 };
}

/** The settings likewise: the search key stays here, only its presence travels. */
export function toSettingsDTO(settings: Settings): SettingsDTO {
	const { apiKey, ...search } = settings.search;
	return { ...settings, search: { ...search, hasKey: apiKey.length > 0 } };
}

/**
 * One MCP server without the values it dials with. A stdio environment and the
 * headers of an http endpoint hold tokens, and the page has no use for them.
 */
export function toMcpDTO<T extends { config: McpServerConfig }>(
	server: T
): Omit<T, 'config'> & { config: Omit<McpServerConfig, 'env' | 'headers'> } {
	const { env, headers, ...config } = server.config;
	return { ...server, config };
}
