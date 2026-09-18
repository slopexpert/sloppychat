import { renderMathBlock } from './math';

/**
 * Regex markdown renderer built for streaming output.
 *
 * It escapes first and then applies regular expressions, so model output can
 * never inject HTML. Partial markup stays visible as plain text until the
 * closing token arrives, which is what makes it safe to call on every frame.
 */

export interface ExtraRule {
	pattern: RegExp;
	replace: (match: RegExpExecArray) => string;
}

export interface RenderOptions {
	/** Appended to code blocks without a language, and reused for highlighting. */
	defaultLang?: string;
	/** Turns fenced code into highlighted HTML. Off for tests and plain output. */
	highlight?: boolean;
	/** Runs after escaping, before the built in inline rules. */
	extras?: ExtraRule[];
}

const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

export function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/* ------------------------------------------------------------------ inline */

const CODE_SPAN = /(`+)([\s\S]*?)\1/g;
/** Display math on one line, used when it sits inside a paragraph. */
const DISPLAY_MATH_INLINE = /\$\$([\s\S]+?)\$\$/g;
const BRACKET_MATH = /\\\[([\s\S]+?)\\\]/g;
const PAREN_MATH = /\\\(([\s\S]+?)\\\)/g;
/**\n * Inline math: no space right after the opening or before the closing dollar,\n * and no digit right after the closing one, so prices stay prices.\n */
const INLINE_MATH = /(?<!\\)\$([^\s$](?:[^$\n]*[^\s$])?)\$(?!\d)/g;
const IMAGE = /!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+&quot;([^&]*)&quot;)?\s*\)/g;
const LINK = /\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+&quot;([^&]*)&quot;)?\s*\)/g;
const AUTOLINK = /(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g;
const BOLD = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g;
const ITALIC = /(\*|_)(?=\S)([\s\S]*?\S)\1/g;
const STRIKE = /~~(?=\S)([\s\S]*?\S)~~/g;
const HIGHLIGHT = /==(?=\S)([\s\S]*?\S)==/g;
const KEYCAP = /:([a-z0-9_+-]+):/g;
const EMOJI: Record<string, string> = {
	smile: '🙂',
	grin: '😁',
	joy: '😂',
	thinking: '🤔',
	thumbsup: '👍',
	'+1': '👍',
	'-1': '👎',
	heart: '❤️',
	fire: '🔥',
	rocket: '🚀',
	eyes: '👀',
	warning: '⚠️',
	check: '✅',
	x: '❌',
	bug: '🐛',
	tada: '🎉',
	wave: '👋',
	clap: '👏',
	100: '💯',
	party: '🥳',
	sparkles: '✨',
	zap: '⚡'
};

/** Only http, https, mailto and same-origin paths may become clickable. */
function safeHref(raw: string): string | undefined {
	const url = raw.trim();
	if (/^(https?:|mailto:)/i.test(url)) return url;
	if (/^[/#?][^\s]*$/.test(url)) return url;
	return undefined;
}

function inline(raw: string, options: RenderOptions): string {
	const tokens: string[] = [];
	const protect = (html: string): string => {
		tokens.push(html);
		return `\u0000${tokens.length - 1}\u0000`;
	};

	// Code spans come out first, so a dollar sign inside code stays code.
	let out = raw.replace(CODE_SPAN, (_match, _fence: string, body: string) =>
		protect(`<code>${escapeHtml(body).replace(/^\s|\s$/g, '')}</code>`)
	);

	// Math next: LaTeX would be eaten by the emphasis and escape rules.
	out = out.replace(DISPLAY_MATH_INLINE, (match, tex: string) => {
		const html = renderMathBlock(tex.trim(), true);
		return html ? protect(html) : match;
	});
	out = out.replace(BRACKET_MATH, (match, tex: string) => {
		const html = renderMathBlock(tex.trim(), true);
		return html ? protect(html) : match;
	});
	out = out.replace(PAREN_MATH, (match, tex: string) => {
		const html = renderMathBlock(tex, false);
		return html ? protect(html) : match;
	});
	out = out.replace(INLINE_MATH, (match, tex: string) => {
		const html = renderMathBlock(tex, false);
		return html ? protect(html) : match;
	});

	// Escape once, up front: every later rule builds tags around safe text.
	out = escapeHtml(out);

	for (const rule of options.extras ?? []) {
		out = out.replace(rule.pattern, (substring: string, ...rest: unknown[]) => {
			const groups = rest.slice(0, -2).map((value) => String(value));
			const offset = Number(rest[rest.length - 2]);
			const source = String(rest[rest.length - 1]);
			const pseudo = [substring, ...groups] as unknown as RegExpExecArray;
			pseudo.index = offset;
			pseudo.input = source;
			return protect(rule.replace(pseudo));
		});
	}

	out = out.replace(IMAGE, (match, alt: string, src: string, title: string) => {
		const href = safeHref(src);
		if (!href) return match;
		const titleAttr = title ? ` title="${title}"` : '';
		return protect(
			`<img src="${href}" alt="${alt}"${titleAttr} loading="lazy" decoding="async">`
		);
	});

	out = out.replace(LINK, (match, label: string, href: string, title: string) => {
		const target = safeHref(href);
		if (!target) return match;
		const titleAttr = title ? ` title="${title}"` : '';
		const external = /^https?:/i.test(target) ? ' target="_blank" rel="noopener noreferrer"' : '';
		return protect(`<a href="${target}"${titleAttr}${external}>${label || target}</a>`);
	});

	out = out.replace(AUTOLINK, (match, prefix: string, url: string) =>
		`${prefix}${protect(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)}`
	);

	out = out
		.replace(BOLD, '<strong>$2</strong>')
		.replace(ITALIC, '<em>$2</em>')
		.replace(STRIKE, '<del>$1</del>')
		.replace(HIGHLIGHT, '<mark class="bg-accent/20 text-fg rounded px-0.5">$1</mark>')
		.replace(KEYCAP, (match, name: string) => EMOJI[name.toLowerCase()] ?? match);

	out = out.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => tokens[Number(index)] ?? '');
	return out;
}

/* -------------------------------------------------------------- highlighting */

const KEYWORDS = [
	'abstract', 'and', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
	'def', 'default', 'delete', 'do', 'elif', 'else', 'enum', 'except', 'export', 'extends', 'false',
	'finally', 'fn', 'for', 'from', 'function', 'if', 'implements', 'import', 'in', 'instanceof',
	'interface', 'is', 'let', 'match', 'mut', 'new', 'None', 'not', 'null', 'or', 'pass', 'private',
	'protected', 'pub', 'public', 'raise', 'readonly', 'return', 'self', 'static', 'struct', 'super',
	'switch', 'this', 'throw', 'trait', 'true', 'try', 'type', 'typeof', 'undefined', 'until', 'use',
	'var', 'void', 'where', 'while', 'with', 'yield', 'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE',
	'DELETE', 'JOIN', 'GROUP', 'ORDER', 'LIMIT', 'CREATE', 'TABLE', 'VALUES', 'SET'
];

const MASTER = new RegExp(
	[
		// comments
		'(\\/\\/[^\\n]*|#[^\\n]*|--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
		// strings, including template literals
		'("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)',
		// numbers
		'(\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|\\b0[xX][0-9a-fA-F]+\\b)',
		// keywords
		`(\\b(?:${KEYWORDS.join('|')})\\b)`,
		// calls
		'([A-Za-z_$][\\w$]*(?=\\s*\\())',
		// punctuation
		'([{}()\\[\\];:,.<>=+\\-*/%!&|^~?]+)'
	].join('|'),
	'g'
);

/** Small regex tokenizer. Good enough for chat snippets and dependency free. */
export function highlightCode(code: string, lang: string): string {
	void lang;
	let out = '';
	let last = 0;
	for (const match of code.matchAll(MASTER)) {
		const at = match.index ?? 0;
		out += escapeHtml(code.slice(last, at));
		const text = match[0];
		const classes = ['tok-com', 'tok-str', 'tok-num', 'tok-key', 'tok-fn', 'tok-punc'];
		const group = classes.findIndex((_cls, index) => match[index + 1] !== undefined);
		const cls = classes[group] ?? '';
		out += `<span class="${cls}">${escapeHtml(text)}</span>`;
		last = at + text.length;
	}
	out += escapeHtml(code.slice(last));
	return out;
}

function codeBlock(code: string, lang: string, options: RenderOptions): string {
	const language = (lang || options.defaultLang || '').replace(/[^\w+#-]/g, '').slice(0, 20);
	const body =
		options.highlight === false ? escapeHtml(code) : highlightCode(code, language);
	const label = language ? `<div class="mb-1 text-xs text-faint">${escapeHtml(language)}</div>` : '';
	return `<pre class="md-code">${label}<code>${body}</code></pre>`;
}

/* ------------------------------------------------------------------- blocks */

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

function renderTable(rows: string[][]): string {
	if (!rows.length) return '';
	const [head, ...body] = rows;
	const headHtml = head.map((cell) => `<th>${cell}</th>`).join('');
	const bodyHtml = body
		.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
		.join('');
	return `<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

function splitRow(line: string): string[] {
	const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
	return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * Reads a display math block that starts at `index`. Returns undefined when the
 * closing delimiter has not arrived yet, so raw LaTeX stays visible mid stream.
 */
function readDisplayMath(
	lines: string[],
	index: number
): { tex: string; next: number } | undefined {
	const opener = (lines[index] ?? '').trim();
	const open = opener.startsWith('$$') ? '$$' : opener.startsWith('\\[') ? '\\[' : undefined;
	if (!open) return undefined;
	const close = open === '$$' ? '$$' : '\\]';

	const rest = opener.slice(open.length);
	const onSameLine = rest.indexOf(close);
	if (onSameLine !== -1) return { tex: rest.slice(0, onSameLine), next: index + 1 };

	const body: string[] = [];
	for (let at = index + 1; at < lines.length; at++) {
		const line = lines[at] ?? '';
		const end = line.indexOf(close);
		if (end !== -1) {
			body.push(line.slice(0, end));
			return { tex: body.join('\n'), next: at + 1 };
		}
		body.push(line);
	}
	return undefined;
}

/** Renders a markdown string to HTML. Safe for partial (streaming) input. */
export function renderMarkdown(input: string, options: RenderOptions = {}): string {
	const lines = input.replace(/\r\n?/g, '\n').split('\n');
	const out: string[] = [];
	let index = 0;

	const isBlockStart = (line: string): boolean =>
		FENCE.test(line) ||
		line.trimStart().startsWith('$$') ||
		line.trimStart().startsWith('\\[') ||
		HEADING.test(line) ||
		HR.test(line) ||
		QUOTE.test(line) ||
		BULLET.test(line) ||
		ORDERED.test(line) ||
		TABLE_ROW.test(line);

	while (index < lines.length) {
		const line = lines[index] ?? '';

		if (!line.trim()) {
			index++;
			continue;
		}

		// Display math before anything else, it may span several lines.
		const display = readDisplayMath(lines, index);
		if (display) {
			const mathHtml = renderMathBlock(display.tex.trim(), true);
			if (mathHtml) {
				out.push(mathHtml);
				index = display.next;
				continue;
			}
		}

		const fence = line.match(FENCE);
		if (fence) {
			const marker = fence[1][0];
			const lang = fence[2] ?? '';
			const code: string[] = [];
			index++;
			while (index < lines.length) {
				const current = lines[index] ?? '';
				const closing = current.match(FENCE);
				if (closing && closing[1][0] === marker && !closing[2]) {
					index++;
					break;
				}
				code.push(current);
				index++;
			}
			out.push(codeBlock(code.join('\n'), lang, options));
			continue;
		}

		const heading = line.match(HEADING);
		if (heading) {
			const level = heading[1].length;
			out.push(`<h${level}>${inline(heading[2], options)}</h${level}>`);
			index++;
			continue;
		}

		if (HR.test(line)) {
			out.push('<hr>');
			index++;
			continue;
		}

		if (QUOTE.test(line)) {
			const quoted: string[] = [];
			while (index < lines.length && QUOTE.test(lines[index] ?? '')) {
				quoted.push((lines[index] ?? '').match(QUOTE)?.[1] ?? '');
				index++;
			}
			out.push(`<blockquote>${renderMarkdown(quoted.join('\n'), options)}</blockquote>`);
			continue;
		}

		if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_SEP.test(lines[index + 1] ?? '')) {
			const rows: string[][] = [splitRow(line).map((cell) => inline(cell, options))];
			index += 2;
			while (index < lines.length && TABLE_ROW.test(lines[index] ?? '')) {
				rows.push(splitRow(lines[index] ?? '').map((cell) => inline(cell, options)));
				index++;
			}
			out.push(renderTable(rows));
			continue;
		}

		if (BULLET.test(line) || ORDERED.test(line)) {
			const ordered = ORDERED.test(line) && !BULLET.test(line);
			const items: string[] = [];
			while (index < lines.length) {
				const current = lines[index] ?? '';
				const match = ordered ? current.match(ORDERED) : current.match(BULLET);
				if (!match) break;
				const indent = match[1].length;
				let content = match[3];
				index++;
				// Continuation lines belong to the item until a new marker appears.
				while (index < lines.length) {
					const next = lines[index] ?? '';
					const isMarker = BULLET.test(next) || ORDERED.test(next);
					const indent2 = (next.match(/^(\s*)/)?.[1] ?? '').length;
					if (!next.trim()) {
						// A blank line only continues the item when more indented content follows.
						const after = lines[index + 1] ?? '';
						if (!after.trim() || (after.match(/^(\s*)/)?.[1] ?? '').length <= indent) break;
						index++;
						continue;
					}
					if (isMarker && indent2 <= indent) break;
					if (indent2 <= indent && isBlockStart(next)) break;
					content += `\n${next.trim()}`;
					index++;
				}
				const task = content.match(TASK);
				if (task) {
					const checked = task[1].toLowerCase() === 'x';
					const box = `<input type="checkbox" disabled${checked ? ' checked' : ''} class="mr-1.5 align-middle accent-[var(--accent)]">`;
					items.push(`<li class="list-none -ml-5">${box}${inline(task[2], options)}</li>`);
				} else {
					items.push(`<li>${inline(content, options)}</li>`);
				}
			}
			const tag = ordered ? 'ol' : 'ul';
			out.push(`<${tag}>${items.join('')}</${tag}>`);
			continue;
		}

		// Paragraph: collect until a blank line or the start of another block.
		const paragraph: string[] = [];
		while (index < lines.length) {
			const current = lines[index] ?? '';
			if (!current.trim()) break;
			if (paragraph.length && isBlockStart(current)) break;
			paragraph.push(current.trim());
			index++;
		}
		out.push(`<p>${paragraph.map((part) => inline(part, options)).join('<br>')}</p>`);
	}

	return out.join('\n');
}

/** Plain text with markup removed, used for titles and previews. */
export function stripMarkdown(input: string): string {
	return input
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_~>#]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}
