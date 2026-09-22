import { beforeEach, describe, expect, it } from 'vitest';
import { renderMarkdown } from '$lib/shared/markdown';
import {
	clearMathCache,
	expandUnits,
	mathCacheSize,
	repairBraces,
	renderMath,
	renderMathBlock
} from '$lib/shared/math';

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

	it('marks a formula it cannot parse instead of giving up silently', () => {
		expect(renderMath('\\frac{1}', false)).toContain('katex-error');
	});

	it('keeps the readable part when one symbol is unknown', () => {
		// A model that writes a macro KaTeX does not know should not cost the formula.
		const html = renderMath('p\\le C-O=\\quantity{33536}', false);
		expect(html).toContain('<math');
		expect(html).toContain('mstyle mathcolor');
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

	it('renders an inline formula that holds a macro KaTeX does not know', () => {
		const html = renderMarkdown('Context: \\(C=\\quantity{65536}\\) tokens.');
		expect(html).toContain('class="math-inline"');
		expect(html).not.toContain('\\(');
	});

	it('recovers a formula whose last brace is one too many', () => {
		const html = renderMarkdown('Ceiling: \\(p\\le C-O=\\quantity{33536}{}}\\).');
		expect(html).toContain('class="math-inline"');
		expect(html).not.toContain('\\(');
	});

	it('reads an align block of its own as display math', () => {
		const html = renderMarkdown(
			['\\begin{align}', 'P(v) &= \\frac{\\exp(z_v/T)}{\\sum_w \exp(z_w/T)} \\\\', '\\end{align}'].join('\n')
		);
		expect(html).toContain('class="math-display"');
		// The underscores of z_v belong to the formula, not to markdown emphasis.
		expect(html).not.toContain('<em>');
	});

	it('leaves an align block as text while the end is still missing', () => {
		const html = renderMarkdown(['\\begin{align}', 'a &= b'].join('\n'));
		expect(html).not.toContain('class="math-display"');
		expect(html).toContain('\\begin{align}');
	});
});

describe('repairBraces', () => {
	it('drops a closing brace that has no opener at the end', () => {
		expect(repairBraces('a=\\quantity{1}{}}')).toBe('a=\\quantity{1}{}');
	});

	it('leaves balanced input alone', () => {
		expect(repairBraces('\\frac{a+1}{b}')).toBeUndefined();
	});

	it('leaves a missing brace alone, because which one was meant is a guess', () => {
		expect(repairBraces('\\frac{1}{2')).toBeUndefined();
	});

	it('ignores escaped braces', () => {
		expect(repairBraces('\\{a\\}')).toBeUndefined();
	});
});

describe('expandUnits', () => {
	it('keeps the number when the unit is empty', () => {
		expect(expandUnits('\\quantity{65536}{}')).toBe('65536');
		expect(expandUnits('\\SI{33536}{}')).toBe('33536');
	});

	it('takes the bare unit macros too', () => {
		expect(expandUnits('\\si{\\mega\\byte}')).toBe('\\mathrm{megabyte}');
		expect(expandUnits('\\unit{tok}')).toBe('\\mathrm{tok}');
	});

	it('reads a divided unit as a fraction bar', () => {
		expect(expandUnits('\\quantity{1.5}{\\metre\\per\\second}')).toBe('1.5\\,\\mathrm{metre/second}');
	});

	it('drops the grouping mark of a number', () => {
		expect(expandUnits('\\num{12{,}345}')).toBe('12,345');
	});

	it('leaves a nested argument alone rather than guessing', () => {
		const tex = '\\quantity{1}{\\frac{a}{b}}';
		expect(expandUnits(tex)).toBe(tex);
	});

	it('leaves other macros alone', () => {
		const tex = '\\frac{1}{2} \\times \\percent';
		expect(expandUnits('\\frac{1}{2} \\times')).toBe('\\frac{1}{2} \\times');
		expect(expandUnits(tex)).toContain('\\%');
	});
});

describe('unit macros through the renderer', () => {
	it('draws a quantity instead of marking it unreadable', () => {
		const html = renderMath('C=\\quantity{65536}{}', false);
		expect(html).toContain('<math');
		expect(html).not.toContain('katex-error');
	});

	it('draws a quantity with a unit in upright letters', () => {
		const html = renderMath('t=\\quantity{90}{\\second}', false);
		expect(html).toContain('<math');
		expect(html).not.toContain('katex-error');
		expect(html).toContain('mathvariant="normal"');
	});

	it('draws a display formula built from unit macros', () => {
		const html = renderMarkdown('\\[ C=\\quantity{65536}{}, \\quad O=\\quantity{32000}{} \\]');
		expect(html).toContain('class="math-display"');
		expect(html).not.toContain('katex-error');
	});
});
