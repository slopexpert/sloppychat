import { faviconSvg } from '$lib/shared/mark';

/**
 * The browser tab icon follows the theme: it is drawn from the accent colours
 * the stylesheet resolved, so it changes with the palette and with light and
 * dark. The static favicon.svg stays as the fallback for the first paint, and
 * for a browser that never runs this.
 */

/** Last icon written, so repeated theme calls do not touch the DOM again. */
let painted = '';

export function applyFavicon(): void {
	// The icon is decoration, so nothing here may break the theme it follows: a
	// document without these pieces, or a stylesheet that has not loaded yet,
	// simply leaves the icon as it is.
	if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return;
	const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
	if (!link) return;

	const styles = getComputedStyle(document.documentElement);
	const accent = styles.getPropertyValue('--accent').trim();
	const contrast = styles.getPropertyValue('--accent-fg').trim();
	if (!accent || !contrast) return;

	const href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(accent, contrast))}`;
	if (href === painted) return;
	painted = href;
	link.type = 'image/svg+xml';
	link.href = href;
}
