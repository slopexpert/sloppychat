import type { RequestHandler } from './$types';
import { bad } from '$lib/server/http';
import { getImage } from '$lib/server/store';

/** Serves a stored image. Ids are random, so access is unlisted but unauthenticated. */
export const GET = (async ({ params }) => {
	const image = getImage(params.id);
	if (!image) return bad('Image not found', 404);
	return new Response(image.blob as unknown as BodyInit, {
		headers: {
			'content-type': image.mime,
			'content-length': String(image.blob.byteLength),
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
}) satisfies RequestHandler;
