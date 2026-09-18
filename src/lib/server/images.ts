/** Reads pixel dimensions from a few common image formats without a dependency. */

export interface Dims {
	width: number;
	height: number;
}

function u16be(b: Uint8Array, at: number): number {
	return (b[at] << 8) | b[at + 1];
}

function u32be(b: Uint8Array, at: number): number {
	return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function u24le(b: Uint8Array, at: number): number {
	return b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
}

function jpegDims(b: Uint8Array): Dims | undefined {
	let at = 2;
	while (at + 9 < b.length) {
		if (b[at] !== 0xff) {
			at++;
			continue;
		}
		const marker = b[at + 1];
		// Standalone markers without a length field.
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			at += 2;
			continue;
		}
		const len = u16be(b, at + 2);
		// SOF0..SOF15 except the coding-practice and DHT/JPG variants.
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { height: u16be(b, at + 5), width: u16be(b, at + 7) };
		}
		at += 2 + len;
	}
	return undefined;
}

function webpDims(b: Uint8Array): Dims | undefined {
	const fourcc = new TextDecoder().decode(b.slice(12, 16));
	if (fourcc === 'VP8X' && b.length >= 30) {
		return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
	}
	if (fourcc === 'VP8L' && b.length >= 25) {
		const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
	}
	if (fourcc === 'VP8 ' && b.length >= 30) {
		return { width: u16leAt(b, 26) & 0x3fff, height: u16leAt(b, 28) & 0x3fff };
	}
	return undefined;
}

function u16leAt(b: Uint8Array, at: number): number {
	return b[at] | (b[at + 1] << 8);
}

export function imageDims(b: Uint8Array, mime: string): Dims | undefined {
	if (b.length < 16) return undefined;
	if (mime === 'image/png' && b[1] === 0x50) {
		return { width: u32be(b, 16), height: u32be(b, 20) };
	}
	if (mime === 'image/gif') {
		return { width: u16leAt(b, 6), height: u16leAt(b, 8) };
	}
	if (mime === 'image/jpeg') return jpegDims(b);
	if (mime === 'image/webp') return webpDims(b);
	return undefined;
}

export const ACCEPTED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Sniffs the real type from magic bytes so a wrong extension cannot slip in. */
export function sniffMime(b: Uint8Array): string | undefined {
	if (b.length < 12) return undefined;
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
	if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
	if (
		b.length >= 12 &&
		new TextDecoder().decode(b.slice(4, 12)) .includes('ftyp') &&
		/avif/i.test(new TextDecoder().decode(b.slice(8, 12)))
	) {
		return 'image/avif';
	}
	return undefined;
}
