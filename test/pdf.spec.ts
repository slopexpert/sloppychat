import { describe, expect, it } from 'vitest';
import { extractPdf, looksLikePdf, PdfError } from '$lib/server/pdf';

/**
 * Builds a small but valid PDF so the test does not depend on a binary fixture.
 * The cross reference table needs exact byte offsets, so the objects are laid
 * out first and the offsets are recorded while the body is assembled.
 */
function buildPdf(pageTexts: string[]): Uint8Array {
	const objects: string[] = [];
	const pageObjectNumbers = pageTexts.map((_, index) => 3 + index * 2);
	objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
	objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`;
	objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>';

	pageTexts.forEach((text, index) => {
		const pageNumber = pageObjectNumbers[index];
		const contentNumber = pageNumber + 1;
		const content = `BT /F1 18 Tf 40 120 Td (${text}) Tj ET`;
		objects[pageNumber] =
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${contentNumber} 0 R ` +
			'/Resources << /Font << /F1 5 0 R >> >> >>';
		objects[contentNumber] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
	});

	const total = objects.length;
	let body = '%PDF-1.4\n';
	const offsets: number[] = [];
	for (let number = 1; number < total; number++) {
		const object = objects[number];
		if (!object) continue;
		offsets[number] = body.length;
		body += `${number} 0 obj\n${object}\nendobj\n`;
	}
	const xrefOffset = body.length;
	body += `xref\n0 ${total}\n0000000000 65535 f \n`;
	for (let number = 1; number < total; number++) {
		body += `${String(offsets[number] ?? 0).padStart(10, '0')} 00000 n \n`;
	}
	body += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return new TextEncoder().encode(body);
}

describe('looksLikePdf', () => {
	it('recognises the header anywhere near the start', () => {
		expect(looksLikePdf(buildPdf(['hello']))).toBe(true);
		expect(looksLikePdf(new TextEncoder().encode('GIF89a'))).toBe(false);
	});
});

describe('extractPdf', () => {
	it('extracts the text of every page', async () => {
		const result = await extractPdf(buildPdf(['Page one text', 'Page two text']), { maxImages: 0 });
		expect(result.pageCount).toBe(2);
		expect(result.pages).toHaveLength(2);
		expect(result.text).toContain('Page one text');
		expect(result.text).toContain('Page two text');
		expect(result.text).toContain('--- page 2 ---');
	});

	it('renders pages to jpeg when asked', async () => {
		const result = await extractPdf(buildPdf(['Rendered page']), { maxImages: 2, targetEdge: 600 });
		expect(result.images).toHaveLength(1);
		const [image] = result.images;
		expect(image.mime).toBe('image/jpeg');
		expect(image.page).toBe(1);
		// JPEG magic bytes and a size close to the requested long edge.
		expect(image.bytes[0]).toBe(0xff);
		expect(image.bytes[1]).toBe(0xd8);
		expect(Math.max(image.width, image.height)).toBeGreaterThan(100);
		expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(700);
	});

	it('caps the rendered pages', async () => {
		const result = await extractPdf(buildPdf(['One', 'Two', 'Three']), { maxImages: 2 });
		expect(result.images).toHaveLength(2);
		expect(result.pageCount).toBe(3);
	});

	it('rejects input that is not a PDF', async () => {
		await expect(extractPdf(new TextEncoder().encode('not a pdf at all'), { maxImages: 1 })).rejects.toThrow(
			PdfError
		);
	});
});
