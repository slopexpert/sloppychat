import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractPdf, PdfError } from '$lib/server/pdf';

/**
 * mupdf keeps a PDF, its pages and its rendered pictures in its own memory, and
 * hands that memory back only when each object is destroyed. A page or a
 * document left behind is memory that never returns, so every path out of the
 * extraction has to give the objects back.
 *
 * The counting here needs to see each object, so the module is mocked with
 * objects that count themselves in and out.
 */

const alive = { documents: 0, pages: 0, stexts: 0, pixmaps: 0 };
/** What the fake document reports, and the pages whose work throws. */
let pageCount = 3;
const brokenText = new Set<number>();
const brokenImage = new Set<number>();

vi.mock('mupdf', () => {
	class Stext {
		constructor(readonly index: number) {
			alive.stexts++;
		}
		asText(): string {
			if (brokenText.has(this.index)) throw new Error('broken fonts');
			return `page ${this.index + 1} text`;
		}
		destroy(): void {
			alive.stexts--;
		}
	}
	class Pixmap {
		constructor(readonly index: number) {
			alive.pixmaps++;
		}
		asJPEG(): Uint8Array {
			if (brokenImage.has(this.index)) throw new Error('render failed');
			return new Uint8Array([1, 2, 3]);
		}
		getWidth(): number {
			return 100;
		}
		getHeight(): number {
			return 130;
		}
		destroy(): void {
			alive.pixmaps--;
		}
	}
	class Page {
		constructor(readonly index: number) {
			alive.pages++;
		}
		toStructuredText(): Stext {
			return new Stext(this.index);
		}
		getBounds(): number[] {
			return [0, 0, 612, 792];
		}
		toPixmap(): Pixmap {
			return new Pixmap(this.index);
		}
		destroy(): void {
			alive.pages--;
		}
	}
	class Document {
		static openDocument(): Document {
			alive.documents++;
			return new Document();
		}
		countPages(): number {
			return pageCount;
		}
		loadPage(index: number): Page {
			return new Page(index);
		}
		destroy(): void {
			alive.documents--;
		}
	}
	return {
		Document,
		Matrix: { scale: () => [1, 0, 0, 1, 0, 0] },
		ColorSpace: { DeviceRGB: 'rgb' }
	};
});

function nothingLeftAlive(): Record<string, number> {
	return { ...alive };
}

beforeEach(() => {
	alive.documents = 0;
	alive.pages = 0;
	alive.stexts = 0;
	alive.pixmaps = 0;
	pageCount = 3;
	brokenText.clear();
	brokenImage.clear();
});

describe('reading a PDF', () => {
	it('gives back every object it was handed', async () => {
		const out = await extractPdf(new Uint8Array([1]), { maxImages: 2 });

		expect(out.pageCount).toBe(3);
		expect(out.pages.map((page) => page.text)).toEqual(['page 1 text', 'page 2 text', 'page 3 text']);
		expect(out.images).toHaveLength(2);
		expect(nothingLeftAlive()).toEqual({ documents: 0, pages: 0, stexts: 0, pixmaps: 0 });
	});

	it('gives the page back when its text cannot be read', async () => {
		brokenText.add(1);

		const out = await extractPdf(new Uint8Array([1]), { maxImages: 0 });

		expect(out.pages.map((page) => page.page)).toEqual([1, 3]);
		expect(nothingLeftAlive()).toEqual({ documents: 0, pages: 0, stexts: 0, pixmaps: 0 });
	});

	it('gives the page and the picture back when a page will not render', async () => {
		brokenImage.add(0);

		const out = await extractPdf(new Uint8Array([1]), { maxImages: 2 });

		expect(out.images.map((image) => image.page)).toEqual([2]);
		expect(nothingLeftAlive()).toEqual({ documents: 0, pages: 0, stexts: 0, pixmaps: 0 });
	});

	it('gives the document back when the file has no pages', async () => {
		pageCount = 0;

		await expect(extractPdf(new Uint8Array([1]), { maxImages: 1 })).rejects.toBeInstanceOf(PdfError);
		expect(nothingLeftAlive()).toEqual({ documents: 0, pages: 0, stexts: 0, pixmaps: 0 });
	});
});
