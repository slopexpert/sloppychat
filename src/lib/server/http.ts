import { error, json } from '@sveltejs/kit';

/** Small helpers so route handlers stay one expression deep. */

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
