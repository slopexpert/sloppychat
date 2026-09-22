import type { RequestHandler } from './$types';
import { newId } from '$lib/server/db';
import { bad } from '$lib/server/http';
import { saveImage, saveDocument, getSettings } from '$lib/server/store';
import { PdfError, extractPdf, looksLikePdf } from '$lib/server/pdf';
import { MAX_TEXT_BYTES, TextFileError, countLines, decodeText, isTextFile } from '$lib/shared/files';
import type { DocumentRef, ImageRef } from '$lib/shared/types';

/**
 * Uploads an attachment and returns the row it became.
 *
 * A PDF is read page by page: text always, page images for vision models. A text
 * or code file is stored as it is, and reaches the model inside a fence.
 */

const MAX_PDF_BYTES = 32 * 1024 * 1024;

export const POST = (async ({ request }) => {
	const form = await request.formData().catch(() => undefined);
	const file = form?.get('file');
	if (!(file instanceof File)) return bad('Send the file as multipart form field "file"');
	if (file.size === 0) return bad('The file is empty');
	if (file.size > MAX_PDF_BYTES) return bad(`File is larger than ${Math.round(MAX_PDF_BYTES / 1048576)} MB`);

	const bytes = new Uint8Array(await file.arrayBuffer());
	const name = file.name || 'attachment';

	// The bytes decide a PDF, so a renamed text file cannot slip into the slow path.
	if (looksLikePdf(bytes)) return await uploadPdf(bytes, name);
	if (isTextFile({ name, type: file.type })) return uploadText(bytes, name);
	return bad(`${name} is neither a PDF nor a text file`);
}) satisfies RequestHandler;

async function uploadPdf(bytes: Uint8Array, name: string): Promise<Response> {
	const settings = getSettings();
	try {
		const extracted = await extractPdf(bytes, {
			maxImages: settings.tools.pdfImages ? settings.tools.pdfMaxImages : 0
		});
		const id = newId();
		saveDocument(id, name, 'application/pdf', extracted.pageCount, extracted.text);

		const images: ImageRef[] = [];
		if (settings.tools.pdfImages) {
			for (const page of extracted.images) {
				const imageId = newId();
				saveImage(imageId, page.mime, page.bytes);
				images.push({
					id: imageId,
					mime: page.mime,
					name: `${name} page ${page.page}`,
					width: page.width,
					height: page.height
				});
			}
		}

		const document: DocumentRef = { id, name, pages: extracted.pageCount, chars: extracted.text.length };
		return Response.json(
			{ document, images, preview: extracted.pages[0]?.text.slice(0, 600) ?? '' },
			{ status: 201 }
		);
	} catch (err) {
		if (err instanceof PdfError) return bad(err.message);
		const message = err instanceof Error ? err.message : String(err);
		return bad(`Could not read the PDF: ${message}`, 500);
	}
}

/** Stores a text or code file. Pages stay 0, which is how the prompt builder spots one. */
function uploadText(bytes: Uint8Array, name: string): Response {
	if (bytes.length > MAX_TEXT_BYTES) {
		return bad(`${name} is larger than ${Math.round(MAX_TEXT_BYTES / 1024 / 1024)} MB`);
	}
	try {
		const text = decodeText(bytes, name);
		const id = newId();
		saveDocument(id, name, 'text/plain', 0, text);
		const document: DocumentRef = { id, name, pages: 0, lines: countLines(text), chars: text.length };
		return Response.json({ document, images: [], preview: text.slice(0, 600) }, { status: 201 });
	} catch (err) {
		if (err instanceof TextFileError) return bad(err.message);
		const message = err instanceof Error ? err.message : String(err);
		return bad(`Could not read the file: ${message}`, 500);
	}
}
