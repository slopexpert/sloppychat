/** The small conversions every part of the store needs when it maps a row. */

export type Row = Record<string, unknown>;

export function str(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}

export function num(v: unknown): number | undefined {
	return typeof v === 'number' ? v : undefined;
}

export function json<T>(v: unknown, fallback: T): T {
	if (typeof v !== 'string' || !v) return fallback;
	try {
		return JSON.parse(v) as T;
	} catch {
		return fallback;
	}
}

export function text(v: unknown): string | null {
	return typeof v === 'string' ? v : null;
}
