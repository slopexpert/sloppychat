import type { Handle } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/** Opens the database on the first request so dev boots stay fast. */
export const handle: Handle = async ({ event, resolve }) => {
	getDB();
	return resolve(event);
};
