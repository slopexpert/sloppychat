/**
 * The pig mark, defined once: the sidebar logo and the browser tab icon both
 * read this geometry, so the two drawings cannot drift apart. Sizes are in the
 * 32 unit viewBox that both use.
 *
 * The head and its ears take the accent colour, the snout and eyes take the
 * contrast colour, and the nostrils are cut back out in the accent colour.
 */

export const MARK_BOX = 32;

export const MARK = {
	head: { x: 3, y: 7, width: 26, height: 21, rx: 10 },
	ears: ['M6 13L8.5 3L14.5 8Z', 'M26 13L23.5 3L17.5 8Z'],
	snout: { x: 9.5, y: 17, width: 13, height: 8.5, rx: 4.2 },
	eyes: [
		{ cx: 11.5, cy: 11.5, r: 1.4 },
		{ cx: 20.5, cy: 11.5, r: 1.4 }
	],
	nostrils: [
		{ cx: 13.4, cy: 21.2, r: 1.5 },
		{ cx: 18.6, cy: 21.2, r: 1.5 }
	]
} as const;

/** The mark as SVG markup: `body` is the head, ears and nostrils, `face` the snout and eyes. */
export function markSvg(body: string, face: string): string {
	const rect = (r: { x: number; y: number; width: number; height: number; rx: number }) =>
		`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="${r.rx}"/>`;
	const dot = (c: { cx: number; cy: number; r: number }) =>
		`<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}"/>`;
	return [
		`<g fill="${body}">`,
		rect(MARK.head),
		...MARK.ears.map((d) => `<path d="${d}"/>`),
		'</g>',
		`<g fill="${face}">`,
		rect(MARK.snout),
		...MARK.eyes.map(dot),
		'</g>',
		`<g fill="${body}">`,
		...MARK.nostrils.map(dot),
		'</g>'
	].join('');
}

/**
 * The tab icon: the mark in the contrast colour on a tile of the accent colour,
 * which is what makes it readable against any browser chrome.
 */
export function faviconSvg(accent: string, contrast: string): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_BOX} ${MARK_BOX}">` +
		`<rect width="${MARK_BOX}" height="${MARK_BOX}" rx="8" fill="${accent}"/>` +
		markSvg(contrast, accent) +
		'</svg>'
	);
}
