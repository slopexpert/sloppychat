import {
	DEFAULT_PARAMS,
	DEFAULT_SETTINGS,
	DEFAULT_THEME,
	type GenerationParams,
	type SearchConfig,
	type Settings,
	type ThemeSettings
} from './types';

/**
 * Settings arrive from the browser as a patch, and the code that reads them
 * trusts the types. Every field is checked here first: a value of the wrong type
 * is dropped, and a number is pulled inside the range the app can work with.
 * A field that the patch does not carry is left out, so the stored value stays.
 */

const FONTS = ['system', 'custom'] as const;
const TEXT_SIZES = ['small', 'default', 'large'] as const;
const RADII = ['square', 'small', 'default', 'large', 'round'] as const;
const DENSITIES = ['compact', 'default', 'spacious'] as const;
const EFFORTS = ['auto', 'low', 'medium', 'high'] as const;
const CHOICES = ['auto', 'none', 'required'] as const;
const MODES = ['off', 'ask', 'on'] as const;

/** Marks a generation knob the patch carried in a shape that cannot be used. */
const SKIP = Symbol('skip');

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function word(value: unknown, fallback: string, max = 500): string {
	return typeof value === 'string' ? value.slice(0, max) : fallback;
}

/** A choice the app knows, or the value it had before. */
function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}

/** A whole number pulled inside the range, or the skip marker. */
function whole(value: unknown, min: number, max: number): number | typeof SKIP {
	if (typeof value !== 'number' || !Number.isFinite(value)) return SKIP;
	return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Writes one whole number field when the patch carries a usable one. A field in
 * the wrong shape is left out, so the value that is stored keeps its force.
 */
function numberField(
	clean: Record<string, unknown>,
	saved: Record<string, unknown>,
	key: string,
	min: number,
	max: number
): void {
	if (!present(saved[key])) return;
	const value = whole(saved[key], min, max);
	if (value !== SKIP) clean[key] = value;
}

/** A switch that is on or off, or the skip marker for anything else. */
function flagField(clean: Record<string, unknown>, saved: Record<string, unknown>, key: string): void {
	if (typeof saved[key] === 'boolean') clean[key] = saved[key];
}

/** Same, for a field where null means "do not ask the provider for this". */
function knob(value: unknown, min: number, max: number): number | null | typeof SKIP {
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value)) return SKIP;
	return Math.min(max, Math.max(min, value));
}

function present(value: unknown): boolean {
	return value !== undefined;
}

/** The look of the app: a palette name, and four fixed choices. */
export function cleanTheme(saved: Record<string, unknown>): Partial<ThemeSettings> {
	const clean: Record<string, unknown> = {};
	if (present(saved.name)) clean.name = word(saved.name, DEFAULT_THEME.name, 60);
	if (present(saved.font)) clean.font = choice(saved.font, FONTS, DEFAULT_THEME.font);
	if (present(saved.fontFamily)) clean.fontFamily = word(saved.fontFamily, DEFAULT_THEME.fontFamily, 200);
	if (present(saved.textSize)) clean.textSize = choice(saved.textSize, TEXT_SIZES, DEFAULT_THEME.textSize);
	if (present(saved.radius)) clean.radius = choice(saved.radius, RADII, DEFAULT_THEME.radius);
	if (present(saved.density)) clean.density = choice(saved.density, DENSITIES, DEFAULT_THEME.density);
	return clean;
}

/** The search endpoint. The key is kept as it came, inside a length that is sane. */
export function cleanSearch(saved: Record<string, unknown>): Partial<SearchConfig> {
	const clean: Record<string, unknown> = {};
	if (present(saved.url)) clean.url = word(saved.url, DEFAULT_SETTINGS.search.url);
	if (present(saved.apiKey)) clean.apiKey = word(saved.apiKey, DEFAULT_SETTINGS.search.apiKey);
	if (present(saved.maxResults)) numberField(clean, saved, 'maxResults', 1, 20);
	return clean;
}

/** One generation knob, or the marker that says the patch had nothing usable. */
function knobField(saved: Record<string, unknown>, key: string, min: number, max: number): number | null | typeof SKIP {
	return present(saved[key]) ? knob(saved[key], min, max) : SKIP;
}

/**
 * The knobs of one request. Each is null when the user cleared it, which tells
 * the app not to send the field to the provider at all.
 */
export function cleanGeneration(saved: Record<string, unknown>): Partial<GenerationParams> {
	const clean: Record<string, unknown> = {};
	if (present(saved.system)) clean.system = word(saved.system, DEFAULT_PARAMS.system, 20000);
	const numbers: [string, number, number][] = [
		['temperature', 0, 2],
		['topP', 0, 1],
		['topK', 0, 1000],
		['minP', 0, 1],
		['frequencyPenalty', -2, 2],
		['presencePenalty', -2, 2],
		['repetitionPenalty', 0.5, 2]
	];
	for (const [key, min, max] of numbers) {
		const value = knobField(saved, key, min, max);
		if (value !== SKIP) clean[key] = value;
	}
	if (present(saved.maxTokens) && saved.maxTokens !== null) numberField(clean, saved, 'maxTokens', 1, 4_000_000);
	else if (saved.maxTokens === null) clean.maxTokens = null;
	if (present(saved.seed) && saved.seed !== null) numberField(clean, saved, 'seed', -2_147_483_648, 2_147_483_647);
	else if (saved.seed === null) clean.seed = null;
	if (present(saved.stop)) {
		clean.stop = Array.isArray(saved.stop) ? saved.stop.map((stop) => String(stop).slice(0, 64)).slice(0, 8) : [];
	}
	if (present(saved.reasoningEffort)) {
		clean.reasoningEffort = choice(saved.reasoningEffort, EFFORTS, DEFAULT_PARAMS.reasoningEffort);
	}
	if (present(saved.toolChoice)) {
		clean.toolChoice = choice(saved.toolChoice, CHOICES, DEFAULT_PARAMS.toolChoice);
	}
	// The raw JSON is passed to the provider as it stands, so only the length is held.
	if (present(saved.extra)) clean.extra = word(saved.extra, DEFAULT_PARAMS.extra, 8000);
	return clean;
}

/** The tool switches, the round cap, and the sizes that bound what is sent. */
export function cleanTools(saved: Record<string, unknown>): Partial<Settings['tools']> {
	const clean: Record<string, unknown> = {};
	if (saved.modes && typeof saved.modes === 'object' && !Array.isArray(saved.modes)) {
		const modes: Record<string, (typeof MODES)[number]> = {};
		for (const [id, mode] of Object.entries(saved.modes as Record<string, unknown>)) {
			// A tool id is free text, because a MCP server brings new ones.
			if (allowed(mode)) modes[id.slice(0, 120)] = mode;
		}
		clean.modes = modes;
	}
	numberField(clean, saved, 'maxRounds', 0, 32);
	numberField(clean, saved, 'fetchMaxChars', 1000, 200000);
	flagField(clean, saved, 'fetchAllowPrivate');
	flagField(clean, saved, 'pdfImages');
	numberField(clean, saved, 'pdfMaxImages', 0, 24);
	numberField(clean, saved, 'pdfMaxChars', 1000, 200000);
	numberField(clean, saved, 'textMaxChars', 1000, 200000);
	return clean;
}

function allowed(mode: unknown): mode is (typeof MODES)[number] {
	return MODES.includes(mode as (typeof MODES)[number]);
}

/** The provider and model a new chat starts with. */
function cleanDefaults(saved: Record<string, unknown>): Partial<Settings['defaults']> {
	const clean: Record<string, unknown> = {};
	if (present(saved.providerId)) {
		clean.providerId = typeof saved.providerId === 'string' ? saved.providerId.slice(0, 60) : null;
	}
	if (present(saved.model)) {
		clean.model = typeof saved.model === 'string' ? saved.model.slice(0, 200) : null;
	}
	return clean;
}

/**
 * Brings a settings patch into the shape the app reads back. Unknown fields are
 * dropped, so a stale or hand written payload cannot store anything else.
 */
export function cleanSettings(patch: unknown): Partial<Settings> {
	const incoming = object(patch);
	const clean: Record<string, unknown> = {};
	const theme = object(incoming.theme);
	if (Object.keys(theme).length) clean.theme = cleanTheme(theme);
	const search = object(incoming.search);
	if (Object.keys(search).length) clean.search = cleanSearch(search);
	const generation = object(incoming.generation);
	if (Object.keys(generation).length) clean.generation = cleanGeneration(generation);
	const tools = object(incoming.tools);
	if (Object.keys(tools).length) clean.tools = cleanTools(tools);
	const defaults = object(incoming.defaults);
	if (Object.keys(defaults).length) clean.defaults = cleanDefaults(defaults);
	return clean;
}
