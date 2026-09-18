import katex from 'katex';

/**
 * LaTeX to MathML.
 *
 * The MathML output is used on purpose: it needs no stylesheet and no webfonts,
 * so nothing extra is downloaded and the browser renders the formula itself.
 * Results are cached because the renderer runs again on every streamed token.
 */

const cache = new Map<string, string>();
const MAX_CACHE = 600;

export interface MathRender {
	html: string;
	display: boolean;
}

/**
 * Renders one formula. Returns undefined when the LaTeX is not valid, so the
 * caller can fall back to showing the source text.
 */
export function renderMath(tex: string, display: boolean): string | undefined {
	const key = `${display ? 'd' : 'i'}:${tex}`;
	const cached = cache.get(key);
	if (cached !== undefined) return cached || undefined;

	let html = '';
	try {
		html = katex.renderToString(tex, {
			displayMode: display,
			output: 'mathml',
			throwOnError: true,
			strict: false,
			trust: false,
			maxExpand: 2000
		});
	} catch {
		// Invalid LaTeX stays as plain text for the reader.
		html = '';
	}

	if (cache.size >= MAX_CACHE) cache.clear();
	cache.set(key, html);
	return html || undefined;
}

/** Wraps rendered math in the element the stylesheet expects. */
export function renderMathBlock(tex: string, display: boolean): string | undefined {
	const html = renderMath(tex, display);
	if (!html) return undefined;
	const className = display ? 'math-display' : 'math-inline';
	return `<span class="${className}">${html}</span>`;
}

/** Only used by the tests, to prove the cache is doing its job. */
export function mathCacheSize(): number {
	return cache.size;
}

export function clearMathCache(): void {
	cache.clear();
}
