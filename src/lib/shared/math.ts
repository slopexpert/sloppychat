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
 * A unit argument as upright text. The unit names of siunitx are macros of their own
 * that KaTeX does not know, so `\metre\per\second` becomes `metre/second`, which reads
 * the same and needs no package.
 */
function uprightUnit(unit: string): string {
	const words = unit
		.replace(/\\per(?![a-zA-Z])/g, '/')
		.replace(/\\([a-zA-Z]+)/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
	return `\\mathrm{${words}}`;
}

/**
 * Siunitx style unit macros are not part of KaTeX, yet models write them constantly.
 * The common ones are rewritten into plain TeX first, with the unit kept upright, which
 * is what the package does. Only simple arguments match: a nested brace is left alone
 * rather than guessed at.
 */
export function expandUnits(tex: string): string {
	const arg = '\\{([^{}]*)\\}';
	let out = tex;
	// A number with an empty unit keeps the number only.
	out = out.replace(
		new RegExp(`\\\\(?:quantity|qty|SI)${arg}${arg}`, 'g'),
		(_match, value: string, unit: string) =>
			value.trim() && unit.trim() ? `${value}\\,${uprightUnit(unit)}` : value
	);
	out = out.replace(new RegExp(`\\\\(?:unit|si)${arg}`, 'g'), (_match, unit: string) => uprightUnit(unit));
	// A number may hold its own grouping mark, as in `\num{12{,}345}`.
	out = out.replace(
		new RegExp(`\\\\num\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`, 'g'),
		(_match, value: string) => value.replace(/\{,\}/g, ',')
	);
	out = out.replace(/\\percent(?![a-zA-Z])/g, '\\%');
	out = out.replace(/\\degree(?![a-zA-Z])/g, '^{\\circ}');
	return out;
}

/**
 * Some models close a group one time too often, for example `\quantity{65536}{}}`.
 * KaTeX then refuses the whole formula, so the reader loses the parts that were
 * correct. When the stray braces sit at the end, dropping them recovers the rest.
 * Nothing else is touched, and this is only tried after the source failed.
 */
export function repairBraces(tex: string): string | undefined {
	let depth = 0;
	let stray = 0;
	for (let at = 0; at < tex.length; at++) {
		const char = tex[at];
		if (char === '\\') {
			at++;
			continue;
		}
		if (char === '{') depth++;
		else if (char === '}') {
			if (depth === 0) stray++;
			else depth--;
		}
	}
	// Mixed mistakes are left alone: which brace was meant to close what is a guess.
	if (!stray || depth) return undefined;
	let out = tex;
	for (let removed = 0; removed < stray; removed++) {
		const tail = /\s*\}\s*$/.exec(out);
		if (!tail) return undefined;
		out = out.slice(0, tail.index);
	}
	return out === tex ? undefined : out;
}

/** True when KaTeX gave up on the input and echoed it back in red. */
function failed(html: string): boolean {
	return html.includes('katex-error');
}

/**
 * Renders one formula. KaTeX is asked not to throw, so an unknown symbol stays
 * visible inside an otherwise correct formula. Returns undefined when nothing could
 * be made of the input, which lets the caller show the source instead.
 */
export function renderMath(tex: string, display: boolean): string | undefined {
	const key = `${display ? 'd' : 'i'}:${tex}`;
	const cached = cache.get(key);
	if (cached !== undefined) return cached || undefined;

	const draw = (value: string) =>
		katex.renderToString(value, {
			displayMode: display,
			output: 'mathml',
			// One bad token should not cost the whole formula.
			throwOnError: false,
			strict: false,
			trust: false,
			maxExpand: 2000
		});

	let html = '';
	try {
		// The unit macros are expanded first, so the repair step sees the same text
		// KaTeX sees.
		const source = expandUnits(tex);
		html = draw(source);
		if (failed(html)) {
			const fixed = repairBraces(source);
			if (fixed) {
				const retry = draw(fixed);
				if (!failed(retry)) html = retry;
			}
		}
	} catch {
		// KaTeX can still throw on a few inputs, such as a runaway macro.
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
