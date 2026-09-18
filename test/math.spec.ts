import { beforeEach, describe, expect, it } from 'vitest';
import { renderMarkdown } from '$lib/shared/markdown';
import { clearMathCache, mathCacheSize, renderMath, renderMathBlock } from '$lib/shared/math';

/** LaTeX must render as MathML, and never be mangled by the other rules. */

beforeEach(() => {
	clearMathCache();
});

describe('renderMath', () => {
	it('renders MathML without any stylesheet', () => {
		const html = renderMath('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', true);
		expect(html).toContain('<math');
		expect(html).toContain('<mfrac>');
		expect(html).toContain('<msqrt>');
		// MathML is used on purpose: no katex CSS class markup is emitted.
		expect(html).not.toContain('katex-html');
	});

	it('keeps the TeX source as an annotation for screen readers', () => {
		const html = renderMath('a^2 + b^2 = c^2', false);
		expect(html).toContain('application/x-tex');
		expect(html).toContain('a^2 + b^2 = c^2');
	});

	it('marks display math as a block', () => {
		expect(renderMath('x', true)).toContain('display="block"');
		expect(renderMath('x', false)).not.toContain('display="block"');
	});

	it('returns undefined for invalid LaTeX', () => {
		expect(renderMath('\\frac{1}', false)).toBeUndefined();
		expect(renderMath('\\notacommand{2}', false)).toBeUndefined();
	});

	it('caches results because the renderer reruns while streaming', () => {
		const first = renderMath('\\alpha', false);
		const size = mathCacheSize();
		const second = renderMath('\\alpha', false);
		expect(second).toBe(first);
		expect(mathCacheSize()).toBe(size);
		// A failure is cached too, so a broken formula is not retried per frame.
		renderMath('\\frac{1}', false);
		const afterFailure = mathCacheSize();
		renderMath('\\frac{1}', false);
		expect(mathCacheSize()).toBe(afterFailure);
	});

	it('wraps the output in the element the stylesheet targets', () => {
		expect(renderMathBlock('x', true)).toMatch(/^<span class="math-display">/);
		expect(renderMathBlock('x', false)).toMatch(/^<span class="math-inline">/);
	});
});

describe('math in markdown', () => {
	it('renders inline math', () => {
		const html = renderMarkdown('The area is $A = \\pi r^2$ exactly.');
		expect(html).toContain('class="math-inline"');
		expect(html).toContain('<math');
		// The raw delimiters are gone; the TeX source only survives in the
		// MathML annotation that screen readers and copy-paste use.
		expect(html).not.toContain('$A = \\pi r^2$');
	});

	it('does not let emphasis rules eat math characters', () => {
		const html = renderMarkdown('$a * b * c$ and $x_1 + x_2$');
		expect(html).not.toContain('<em>');
		expect(html.match(/class="math-inline"/g)).toHaveLength(2);
	});

	it('renders display math on its own line', () => {
		const html = renderMarkdown('Before\n\n$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$\n\nAfter');
		expect(html).toContain('class="math-display"');
		expect(html).toContain('<msubsup>');
		expect(html).toContain('<p>Before</p>');
		expect(html).toContain('<p>After</p>');
	});

	it('renders display math that spans several lines', () => {
		const html = renderMarkdown('$$\n\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n$$');
		expect(html).toContain('class="math-display"');
		expect(html).toContain('<mtable');
	});

	it('renders display math inside a paragraph', () => {
		const html = renderMarkdown('The sum is $$\\sum_{n=1}^{\\infty} \\frac{1}{n^2}$$ for reference.');
		expect(html).toContain('class="math-display"');
		expect(html).toContain('<munderover>');
	});

	it('accepts the parenthesis delimiters too', () => {
		const html = renderMarkdown('Inline \\(x^2\\) and display \\[y^3\\]');
		expect(html).toContain('class="math-inline"');
		expect(html).toContain('class="math-display"');
	});

	it('leaves unclosed math as text while streaming', () => {
		const html = renderMarkdown('Working on it: $$\\frac{-b \\pm \\sqrt{b^2 - 4');
		expect(html).not.toContain('<math');
		expect(html).toContain('\\frac');
	});

	it('leaves an unclosed inline formula as text', () => {
		const html = renderMarkdown('The value $x = 1');
		expect(html).not.toContain('<math');
		expect(html).toContain('$x = 1');
	});

	it('does not treat prices as math', () => {
		const html = renderMarkdown('I paid $5 and $10 for it, plus $3.');
		expect(html).not.toContain('<math');
		expect(html).toContain('$5 and $10');
	});

	it('keeps code spans intact', () => {
		const html = renderMarkdown('Use `$x$` in the shell.');
		expect(html).toContain('<code>$x$</code>');
		expect(html).not.toContain('<math');
	});

	it('keeps fenced code intact', () => {
		const html = renderMarkdown('```tex\n$$x = 1$$\n```');
		expect(html).not.toContain('<math');
		expect(html).toContain('<pre');
		expect(html).toContain('$$x');
		expect(html).toContain('$$</code>');
	});

	it('falls back to the raw text when the LaTeX is broken', () => {
		const html = renderMarkdown('Broken: $\\frac{1}$ here.');
		expect(html).not.toContain('<math');
		expect(html).toContain('\\frac{1}');
	});
});
