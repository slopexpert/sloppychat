import type { RequestHandler } from './$types';
import { newId } from '$lib/server/db';
import { bad } from '$lib/server/http';
import { ACCEPTED_IMAGE_MIME, MAX_IMAGE_BYTES, imageDims, sniffMime } from '$lib/server/images';
import { saveImage } from '$lib/server/store';

/** Accepts one image file and returns the reference the message row stores. */
export const POST = (async ({ request }) => {
	const form = await request.formData().catch(() => undefined);
	const file = form?.get('file');
	if (!(file instanceof File)) return bad('Send the image as multipart form field "file"');
	if (file.size === 0) return bad('Image is empty');
	if (file.size > MAX_IMAGE_BYTES) return bad(`Image is larger than ${Math.round(MAX_IMAGE_BYTES / 1048576)} MB`);
	const bytes = new Uint8Array(await file.arrayBuffer());
	const mime = sniffMime(bytes);
	if (!mime) return bad('Only PNG, JPEG, WebP, GIF and AVIF images are supported');
	if (!ACCEPTED_IMAGE_MIME.has(mime)) return bad(`Unsupported image type: ${mime}`);
	const id = newId();
	saveImage(id, mime, bytes);
	const dims = imageDims(bytes, mime);
	return Response.json(
		{
			image: {
				id,
				mime,
				name: file.name || undefined,
				width: dims?.width,
				height: dims?.height
			}
		},
		{ status: 201 }
	);
}) satisfies RequestHandler;
