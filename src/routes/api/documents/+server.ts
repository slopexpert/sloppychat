import type { RequestHandler } from './$types';
import { newId } from '$lib/server/db';
import { bad } from '$lib/server/http';
import { saveImage, saveDocument } from '$lib/server/store';
import { getSettings } from '$lib/server/store';
import { PdfError, extractPdf, looksLikePdf } from '$lib/server/pdf';
import type { DocumentRef, ImageRef } from '$lib/shared/types';

/** Uploads a PDF, stores its text, and renders pages for vision models. */

const MAX_PDF_BYTES = 32 * 1024 * 1024;

export const POST = (async ({ request }) => {
	const form = await request.formData().catch(() => undefined);
	const file = form?.get('file');
	if (!(file instanceof File)) return bad('Send the PDF as multipart form field "file"');
	if (file.size === 0) return bad('The PDF is empty');
	if (file.size > MAX_PDF_BYTES) return bad(`PDF is larger than ${Math.round(MAX_PDF_BYTES / 1048576)} MB`);

	const bytes = new Uint8Array(await file.arrayBuffer());
	if (!looksLikePdf(bytes)) return bad('That file is not a PDF');

	const settings = getSettings();
	try {
		const extracted = await extractPdf(bytes, { maxImages: settings.tools.pdfImages ? settings.tools.pdfMaxImages : 0 });
		const id = newId();
		const name = file.name || 'document.pdf';
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

		const document: DocumentRef = {
			id,
			name,
			pages: extracted.pageCount,
			chars: extracted.text.length
		};
		return Response.json(
			{ document, images, preview: extracted.pages[0]?.text.slice(0, 600) ?? '' },
			{ status: 201 }
		);
	} catch (err) {
		if (err instanceof PdfError) return bad(err.message);
		const message = err instanceof Error ? err.message : String(err);
		return bad(`Could not read the PDF: ${message}`, 500);
	}
}) satisfies RequestHandler;
