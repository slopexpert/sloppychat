import { DEFAULT_PARAMS, type GenerationParams } from './types';

/**
 * Merges parameter layers from the least to the most specific: built in
 * defaults, then global settings, then the conversation overrides. A null value
 * survives the merge so "unset" stays distinguishable from "send 0".
 */
export function resolveParams(
	...layers: (Partial<GenerationParams> | null | undefined)[]
): GenerationParams {
	let merged: GenerationParams = { ...DEFAULT_PARAMS, stop: [...DEFAULT_PARAMS.stop] };
	for (const layer of layers) {
		if (!layer) continue;
		const next: GenerationParams = { ...merged };
		for (const [key, value] of Object.entries(layer) as [keyof GenerationParams, unknown][]) {
			if (value === undefined) continue;
			if (key === 'stop') {
				next.stop = Array.isArray(value) ? value.map(String) : [];
				continue;
			}
			// @ts-expect-error each key is written with its own type
			next[key] = value;
		}
		merged = next;
	}
	return merged;
}

/** Counts how many fields a conversation overrides, for the UI badge. */
export function countOverrides(params: Partial<GenerationParams> | undefined): number {
	if (!params) return 0;
	return Object.values(params).filter((value) => {
		if (value === undefined || value === null) return false;
		if (Array.isArray(value)) return value.length > 0;
		if (typeof value === 'string') return value.trim() !== '';
		return true;
	}).length;
}

/** True when a JSON text field holds a usable object. */
export function parseExtra(extra: string): Record<string, unknown> | undefined {
	const trimmed = extra.trim();
	if (!trimmed) return undefined;
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
	} catch {
		/* fall through to undefined */
	}
	return undefined;
}

/** Keys that the app owns, so `extra` cannot break the request shape. */
export const PROTECTED_BODY_KEYS = new Set(['messages', 'model', 'stream', 'stream_options', 'tools']);
