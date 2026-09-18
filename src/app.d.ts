// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			/** Absolute path of the sqlite database, resolved per request. */
			db: import('$lib/server/db').DB;
		}
	}
}

export {};
