/**
 * Where the quote chip goes once the reader has selected text. The rectangle comes
 * from the selection, which is in viewport coordinates, so the spot is too.
 */

export interface SelectionBox {
	top: number;
	bottom: number;
	left: number;
}

/** Width the chip needs, so it never hangs off the right edge. */
const CHIP_WIDTH = 116;
/** Height of the chip, plus the small gap it floats above the text. */
const CHIP_ROOM = 34;

/**
 * Places the chip above the selection, or under it when the selection starts too
 * near the top of the window to leave room.
 */
export function quoteSpot(
	rect: SelectionBox,
	viewportWidth: number,
	room = CHIP_ROOM,
	width = CHIP_WIDTH
): { x: number; y: number } {
	return {
		x: Math.max(8, Math.min(rect.left, viewportWidth - width)),
		y: rect.top > room + 8 ? rect.top - room : rect.bottom + 6
	};
}
