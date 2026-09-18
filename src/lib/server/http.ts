import { error, json, type RequestEvent } from '@sveltejs/kit';

/** Small helpers so route handlers stay one expression deep. */

export function ok<T>(data: T): Response {
	return json(data);
}

export function bad(message: string, status = 400): Response {
	return json({ error: message }, { status });
}

export function fail(status: number, message: string): never {
	error(status, message);
}

export async function body<T>(request: Request): Promise<T> {
	try {
		return (await request.json()) as T;
	} catch {
		return {} as T;
	}
}

export function paramString(value: FormDataEntryValue | null): string {
	return typeof value === 'string' ? value : '';
}

export function requireId(params: RequestEvent['params'], name = 'id'): string {
	const value = (params as Record<string, string | undefined>)[name];
	if (!value) fail(400, `Missing ${name}`);
	return value;
}

/** Wraps a handler so thrown upstream errors become readable JSON errors. */
export function guard<T extends Response>(fn: () => Promise<T>): Promise<T> | Response {
	try {
		return fn();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return bad(message, 500);
	}
}
