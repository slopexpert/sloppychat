/** The provider rows, including the API key, which never leaves the server. */

import { all, one, run, tx, newId, now } from '../db';
import { str, text, type Row } from './rows';
import { type Provider } from '$lib/shared/types';
import { getSettings } from './settings';

export function mapProvider(row: Row): Provider {
	return {
		id: str(row.id),
		name: str(row.name),
		baseUrl: str(row.base_url).replace(/\/+$/, ''),
		apiKey: str(row.api_key),
		kind: 'openai',
		defaultModel: text(row.default_model),
		enabled: row.enabled === 1,
		sort: typeof row.sort === 'number' ? row.sort : 0,
		createdAt: str(row.created_at)
	};
}

export function listProviders(): Provider[] {
	return all('SELECT * FROM providers ORDER BY sort, name').map(mapProvider);
}

export function getProvider(id: string): Provider | undefined {
	const row = one('SELECT * FROM providers WHERE id = ?', id);
	return row ? mapProvider(row) : undefined;
}

/** First enabled provider, used when a conversation has no explicit pick. */
export function defaultProvider(): Provider | undefined {
	const settings = getSettings();
	if (settings.defaults.providerId) {
		const picked = getProvider(settings.defaults.providerId);
		if (picked?.enabled) return picked;
	}
	return listProviders().find((p) => p.enabled);
}

export function createProvider(input: Partial<Provider> & { name: string; baseUrl: string }): Provider {
	const id = newId();
	const sort = listProviders().length;
	run(
		`INSERT INTO providers (id, name, base_url, api_key, kind, default_model, enabled, sort, created_at)
		 VALUES (?, ?, ?, ?, 'openai', ?, ?, ?, ?)`,
		id,
		input.name,
		input.baseUrl.replace(/\/+$/, ''),
		input.apiKey ?? '',
		input.defaultModel ?? null,
		input.enabled === false ? 0 : 1,
		input.sort ?? sort,
		now()
	);
	return getProvider(id)!;
}

export function updateProvider(id: string, patch: Partial<Provider>): Provider | undefined {
	const current = getProvider(id);
	if (!current) return undefined;
	const next = { ...current, ...patch };
	run(
		`UPDATE providers SET name = ?, base_url = ?, kind = 'openai', default_model = ?, enabled = ?, sort = ?,
		 api_key = ? WHERE id = ?`,
		next.name,
		next.baseUrl.replace(/\/+$/, ''),
		next.defaultModel ?? null,
		next.enabled ? 1 : 0,
		next.sort,
		patch.apiKey === undefined ? current.apiKey : patch.apiKey,
		id
	);
	return getProvider(id);
}

export function deleteProvider(id: string): void {
	tx(() => {
		run('DELETE FROM providers WHERE id = ?', id);
		run('UPDATE conversations SET provider_id = NULL WHERE provider_id = ?', id);
	});
}
