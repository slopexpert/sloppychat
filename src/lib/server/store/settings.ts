/** The one settings row, merged over the defaults and clamped on the way in. */

import { one, run } from '../db';
import { json } from './rows';
import { DEFAULT_PARAMS, DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '$lib/shared/types';
import { migrateToolModes } from '$lib/shared/tools';

export function getSettings(): Settings {
	const row = one('SELECT data FROM settings WHERE id = 1');
	const saved = json<Partial<Settings>>(row?.data, {});
	return {
		theme: { ...DEFAULT_SETTINGS.theme, ...saved.theme },
		search: { ...DEFAULT_SETTINGS.search, ...saved.search },
		generation: { ...DEFAULT_PARAMS, ...saved.generation },
		tools: normalizeTools(saved.tools),
		defaults: { ...DEFAULT_SETTINGS.defaults, ...saved.defaults }
	};
}

/**
 * The tools keep one mode per tool. Older rows hold a boolean per web tool, and
 * this function turns those booleans into modes, so an upgrade keeps the choice.
 * The old keys fall away on the next save.
 */
function normalizeTools(
	saved?: Partial<Settings['tools']> & { webSearch?: boolean; webFetch?: boolean }
): Settings['tools'] {
	const { webSearch, webFetch, ...rest } = saved ?? {};
	return {
		...DEFAULT_SETTINGS.tools,
		...rest,
		modes: migrateToolModes({ modes: rest.modes, webSearch, webFetch })
	};
}

export function saveSettings(patch: SettingsPatch): Settings {
	const next = {
		...getSettings(),
		...patch,
		theme: { ...getSettings().theme, ...patch.theme },
		search: { ...getSettings().search, ...patch.search },
		generation: { ...getSettings().generation, ...patch.generation },
		tools: normalizeTools({ ...getSettings().tools, ...patch.tools }),
		defaults: { ...getSettings().defaults, ...patch.defaults }
	};
	run(
		`INSERT INTO settings (id, data) VALUES (1, ?)
		 ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
		JSON.stringify(next)
	);
	return next;
}
