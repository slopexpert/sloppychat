/**
 * PDF handling for chat attachments: pull the text out and render the pages to
 * JPEG so a vision model can look at the layout too.
 *
 * mupdf is WASM, loaded with a dynamic import because the module initialises
 * asynchronously. It is kept in a module level promise so the runtime is only
 * paid for once, and only when a PDF is actually uploaded.
 */

type MupdfModule = typeof import('mupdf');

let mupdfPromise: Promise<MupdfModule> | undefined;

async function loadMupdf(): Promise<MupdfModule> {
	mupdfPromise ??= import('mupdf');
	return mupdfPromise;
}

export class PdfError extends Error {}

export interface PdfPageImage {
	page: number;
	mime: string;
	bytes: Uint8Array;
	width: number;
	height: number;
}

export interface PdfExtract {
	pageCount: number;
	text: string;
	/** Pages kept separate so the model can be told where text came from. */
	pages: { page: number; text: string }[];
	images: PdfPageImage[];
}

export interface PdfOptions {
	/** Pages rendered to images, from the first page onwards. */
	maxImages: number;
	/** Long edge target in pixels for a rendered page. */
	targetEdge?: number;
	/** JPEG quality for rendered pages. */
	quality?: number;
	/** Pages whose text is extracted. */
	maxTextPages?: number;
	/** Characters of text kept per page. */
	maxCharsPerPage?: number;
}

const MAX_TEXT_PAGES = 100;
const MAX_CHARS_PER_PAGE = 20000;
const TARGET_EDGE = 1400;

function cleanText(raw: string): string {
	return raw
		// Reader artefacts mupdf emits for hyphenation and empty lines.
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** True when the bytes start with the PDF header. */
export function looksLikePdf(bytes: Uint8Array): boolean {
	const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
	return head.includes('%PDF-');
}

export async function extractPdf(bytes: Uint8Array, options: PdfOptions): Promise<PdfExtract> {
	const mupdf = await loadMupdf();
	let document: import('mupdf').Document;
	try {
		document = mupdf.Document.openDocument(bytes, 'application/pdf');
	} catch (err) {
		throw new PdfError(`Could not open the PDF: ${err instanceof Error ? err.message : String(err)}`);
	}

	try {
		const pageCount = document.countPages();
		if (!pageCount) throw new PdfError('The PDF has no pages');

		const maxTextPages = options.maxTextPages ?? MAX_TEXT_PAGES;
		const maxCharsPerPage = options.maxCharsPerPage ?? MAX_CHARS_PER_PAGE;
		const pages: { page: number; text: string }[] = [];
		const textParts: string[] = [];
		const images: PdfPageImage[] = [];
		const targetEdge = options.targetEdge ?? TARGET_EDGE;
		const quality = options.quality ?? 80;

		for (let index = 0; index < Math.min(pageCount, maxTextPages); index++) {
			const page = document.loadPage(index);
			let text = '';
			try {
				const stext = page.toStructuredText('');
				try {
					text = cleanText(stext.asText());
				} finally {
					stext.destroy();
				}
			} catch {
				// A page with broken fonts can fail to produce text; keep going.
				text = '';
			} finally {
				page.destroy();
			}
			if (text.length > maxCharsPerPage) text = `${text.slice(0, maxCharsPerPage)}\n[page truncated]`;
			if (text) {
				pages.push({ page: index + 1, text });
				textParts.push(`--- page ${index + 1} ---\n${text}`);
			}
		}

		for (let index = 0; index < Math.min(pageCount, Math.max(0, options.maxImages)); index++) {
			const page = document.loadPage(index);
			try {
				const bounds = page.getBounds();
				const width = Math.max(1, bounds[2] - bounds[0]);
				const height = Math.max(1, bounds[3] - bounds[1]);
				// Keep small pages crisp and large pages inside the limit.
				const scale = Math.min(2.5, Math.max(0.5, targetEdge / Math.max(width, height)));
				const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
				try {
					images.push({
						page: index + 1,
						mime: 'image/jpeg',
						bytes: new Uint8Array(pixmap.asJPEG(quality)),
						width: pixmap.getWidth(),
						height: pixmap.getHeight()
					});
				} finally {
					pixmap.destroy();
				}
			} catch {
				// Leave the page out rather than failing the whole upload.
			} finally {
				page.destroy();
			}
		}

		return { pageCount, text: textParts.join('\n\n'), pages, images };
	} finally {
		// mupdf keeps the whole file in its own memory, so the document goes with
		// the pages: a page or a document left behind is memory that never returns.
		document.destroy();
	}
}
