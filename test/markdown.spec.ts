import { describe, expect, it } from 'vitest';
import { quoteBlock, renderMarkdown, safeHref, stripMarkdown } from '$lib/shared/markdown';

describe('renderMarkdown', () => {
	it('escapes html so model output cannot inject markup', () => {
		const html = renderMarkdown('<img src=x onerror=alert(1)> and <script>bad()</script>');
		expect(html).not.toContain('<script>');
		// No live tag survives, so the attribute text is inert.
		expect(html).not.toContain('<img src=x');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(html).toContain('&lt;script&gt;');
	});

	it('refuses javascript urls in links and images', () => {
		const html = renderMarkdown('[x](javascript:alert(1)) ![y](javascript:alert(2))');
		expect(html).not.toContain('href="javascript:');
		expect(html).not.toContain('src="javascript:');
	});

	it('renders headings, lists and tasks', () => {
		const html = renderMarkdown('# Title\n\n- one\n- two\n\n1. first\n2. second\n\n- [x] done\n- [ ] todo');
		expect(html).toContain('<h1>Title</h1>');
		expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
		expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
		expect(html).toContain('checked');
		expect(html).toContain('type="checkbox"');
	});

	it('renders tables with a separator row', () => {
		const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
		expect(html).toContain('<th>a</th>');
		expect(html).toContain('<td>1</td>');
	});

	it('keeps an unclosed code fence readable while streaming', () => {
		const html = renderMarkdown('text\n\n```js\nconst a = 1;');
		expect(html).toContain('<pre');
		expect(html).toContain('const');
	});

	it('highlights code fences when asked', () => {
		const html = renderMarkdown('```js\n// note\nconst x = "hi";\n```', { highlight: true });
		expect(html).toContain('tok-com');
		expect(html).toContain('tok-key');
		expect(html).toContain('tok-str');
	});

	it('leaves partial emphasis as plain text', () => {
		const html = renderMarkdown('a **bold');
		expect(html).toContain('a **bold');
	});

	it('renders emphasis, strike, code spans and inline code safely', () => {
		const html = renderMarkdown('**b** *i* ~~s~~ `a < b`');
		expect(html).toContain('<strong>b</strong>');
		expect(html).toContain('<em>i</em>');
		expect(html).toContain('<del>s</del>');
		expect(html).toContain('<code>a &lt; b</code>');
	});

	it('links bare urls and quites them with rel', () => {
		const html = renderMarkdown('see https://example.com/docs now');
		expect(html).toContain('href="https://example.com/docs"');
		expect(html).toContain('rel="noopener noreferrer"');
	});

	it('renders blockquotes and nested content', () => {
		const html = renderMarkdown('> quoted **text**\n> more');
		expect(html).toContain('<blockquote>');
		expect(html).toContain('<strong>text</strong>');
	});

	it('supports custom regex rules', () => {
		const html = renderMarkdown('id {{42}}', {
			extras: [
				{
					pattern: /\{\{(\d+)\}\}/g,
					replace: (match) => `<span class="ref">#${match[1]}</span>`
				}
			]
		});
		expect(html).toContain('<span class="ref">#42</span>');
	});
});

describe('stripMarkdown', () => {
	it('removes markup for previews', () => {
		expect(stripMarkdown('# Title\n\n**bold** [link](https://x.test)')).toBe('Title bold link');
	});
});

describe('the copy button of a fence', () => {
	it('rides on every fenced block', () => {
		const html = renderMarkdown('```js\nconst a = 1;\n```');
		expect(html).toContain('class="md-copy');
		expect(html).toContain('aria-label="Copy the code"');
	});

	it('leaves a plain paragraph alone', () => {
		expect(renderMarkdown('Just words.')).not.toContain('md-copy');
	});
});

describe('quoteBlock', () => {
	it('marks every line', () => {
		expect(quoteBlock('one\ntwo')).toBe('> one\n> two');
	});

	it('does not stack a marker on a quote', () => {
		expect(quoteBlock('> already')).toBe('> already');
	});

	it('drops the trailing blank lines', () => {
		expect(quoteBlock('text\n\n\n')).toBe('> text');
	});

	it('leaves an empty line empty inside the quote', () => {
		expect(quoteBlock('a\n\nb')).toBe('> a\n>\n> b');
	});
});

describe('safeHref', () => {
	it('allows the addresses a reader means to open', () => {
		expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
		expect(safeHref(' http://example.com ')).toBe('http://example.com');
		expect(safeHref('mailto:me@example.com')).toBe('mailto:me@example.com');
		expect(safeHref('/search?q=1')).toBe('/search?q=1');
	});

	it('refuses what a search result could hide in', () => {
		// The same filter guards the links of a tool result, which come from the web.
		expect(safeHref('javascript:alert(1)')).toBeUndefined();
		expect(safeHref('JaVaScRiPt:alert(1)')).toBeUndefined();
		expect(safeHref('data:text/html;base64,PHNjcmlwdD4=')).toBeUndefined();
		expect(safeHref('file:///etc/passwd')).toBeUndefined();
		expect(safeHref('')).toBeUndefined();
	});
});
