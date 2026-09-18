// DOM to markdown writer. Builds one block string at a time, so whitespace is
// normalized per paragraph and never inside code fences.
import type { AnyNode, ChildNode, Element, Text } from "domhandler";
import { allTags, attr, childTag, childTags, isEl, kids, linkDensity, textOf, wordCount } from "./dom";

interface Ctx {
	/** Page URL, used to resolve hrefs and to shorten same-site links. */
	base?: URL;
}

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const INLINE = new Set(["a", "abbr", "b", "bdi", "bdo", "big", "br", "cite", "code", "data", "del", "dfn", "em", "font", "i", "img", "ins", "kbd", "label", "mark", "q", "s", "samp", "small", "span", "strike", "strong", "sub", "sup", "time", "tt", "u", "var", "wbr"]);
const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe", "head", "meta", "link", "title", "button", "input", "select", "option", "textarea", "video", "audio", "source", "track", "canvas", "map", "area", "form"]);

// Filenames that mark an image as chrome rather than content.
const IMG_ICON = /(^|[/._-\s])(icon|icons|avatar|logo|sprite|spacer|blank|placeholder|pixel|beacon|favicon|spinner|loader|gravatar|emoji|ads|ad|advert|adsystem|doubleclick|tracking|badge|button|btn|share|social|cookie|widget|noimage|1x1)([/._-\s]|$)/i;
// Hosts that serve status badges and tracking pixels, so the filename tells you nothing.
const IMG_HOST = /(?:^|\/\/|\.)(shields\.io|badgen\.net|gravatar\.com|doubleclick\.net|googlesyndication\.com|scorecardresearch\.com|fls\.amazon\.com)(?:\/|$|\/)/i;
// Only escape asterisks and underscores that form an emphasis pair, so that
// code-ish prose such as a_b or 2 * 3 keeps its shape.
const EMPHASIS = /(^|[^\w\\])([*_])([^*_\n]{1,120}?)\2(?![*_\w])/g;

// Share and click-tracking query parameters that carry no page identity.
const TRACK_PARAM = /^(utm_[a-z]+|gclid|fbclid|msclkid|yclid|pk_[a-z]+|hsa_[a-z]+|mc_[a-z]+|igsh|spm|scm|ref_src|cmpid|vero_id|_openstat|sa|ved|usg|oi|ig|feature|si)$/i;

function esc(s: string): string {
	return s
		.replace(/\\/g, "\\\\")
		.replace(/([[`\]])/g, "\\$1")
		.replace(EMPHASIS, "$1\\$2$3\\$2");
}

// The same anchor twice in a row comes from duplicated desktop and mobile menus.
const REPEATED_LINK = /(\s)(\[[^\]\n]*]\([^)\n]*\))(?:\s+\2)+/g;

/** Normalize an assembled inline run: one space per gap, no leading indent. */
function tidy(s: string): string {
	const out = s.replace(REPEATED_LINK, "$1$2")
		.replace(/[\t\u00a0\u2000-\u200b\ufeff]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/ {2,}/g, " ")
		.replace(/(\w) +([,.;:!?])/g, "$1$2")
		.trim();
	// Keep literal markup from starting a new block.
	return out
		.replace(/^([#>|])/gm, "\\$1")
		.replace(/^([-+]) /gm, "\\$1 ")
		.replace(/^(\d+)\. /gm, "$1\\. ");
}

function rawText(n: AnyNode): string {
	if (n.type === "text") return (n as Text).data;
	if (isEl(n) && n.name === "br") return "\n";
	return kids(n).map(rawText).join("");
}

/** Text inside <pre> keeps its own indentation and newlines. */
function codeText(n: Element): string {
	return rawText(n).replace(/^\n+/, "").replace(/[ \t]+\n/g, "\n").replace(/\s+$/, "");
}

function fence(code: string, lang: string): string {
	const run = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
	const tick = "`".repeat(Math.max(3, run + 1));
	return `${tick}${lang}\n${code}\n${tick}`;
}

/** Language hint from the Prism or Highlight.js class on code or pre. */
function codeLang(n: Element): string {
	const codeEl = childTag(n, "code");
	const cls = `${attr(n, "class")} ${codeEl ? attr(codeEl, "class") : ""}`;
	return /language[-_]([\w+#-]+)/i.exec(cls)?.[1]?.toLowerCase() ?? "";
}

function inlineCode(s: string): string {
	const code = s.replace(/[\t\u00a0]+/g, " ").trim();
	if (!code) return "";
	const run = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
	const tick = "`".repeat(run + 1);
	const pad = /^`|`$/.test(code) ? " " : "";
	return `${tick}${pad}${code}${pad}${tick}`;
}

/** Resolve an href to the shortest useful form, or null to drop the link. */
function resolveHref(href: string, ctx: Ctx): string | null {
	const h = href.trim().replace(/\s+/g, "%20");
	if (!h || h.startsWith("#")) return null;
	if (/^(javascript|data|blob|file|about|vbscript):/i.test(h)) return null;
	if (/^(mailto|tel|sms|callto):/i.test(h)) return h;
	let abs: URL;
	try {
		abs = new URL(h, ctx.base?.href);
	} catch {
		return null;
	}
	if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
	for (const k of [...abs.searchParams.keys()]) if (TRACK_PARAM.test(k)) abs.searchParams.delete(k);
	const tail = `${abs.pathname}${abs.search}${abs.hash}`.replace(/\/$/, "");
	// Same-site links become paths: the header already states the origin.
	if (ctx.base && abs.origin === ctx.base.origin) return tail || "/";
	return `${abs.origin}${tail}`;
}

/** Flatten a node to a single inline run. Block children stay in reading order. */
function inlineText(n: Element, ctx: Ctx): string {
	return tidy(renderNodes(kids(n), ctx).join(" "));
}

/** Best image candidate from srcset and lazy-load attributes. */
function imageSrc(n: Element): string {
	const pick = (v: string): string => {
		let best = { url: "", size: -1 };
		for (const part of v.split(",")) {
			const [url, d] = part.trim().split(/\s+/);
			if (!url) continue;
			const w = Number(/(\d+)w$/.exec(d ?? "")?.[1]) || 0;
			const x = Number(/([\d.]+)x$/.exec(d ?? "")?.[1]) || 1;
			const size = w > 0 ? w : x * 1000;
			if (size > best.size) best = { url, size };
		}
		return best.url;
	};
	for (const key of ["srcset", "data-srcset"]) {
		const v = attr(n, key);
		if (v) {
			const u = pick(v);
			if (u) return u;
		}
	}
	for (const key of ["data-src", "data-original-src", "data-lazy-src", "data-original", "src"]) {
		const v = attr(n, key);
		if (v && !/^data:/i.test(v)) return v.trim();
	}
	return "";
}

function image(n: Element, ctx: Ctx): string {
	const src = imageSrc(n);
	if (!src || /^data:/i.test(src)) return "";
	const dim = (k: string): number => Number(attr(n, k).replace(/[^0-9.]/g, "")) || 0;
	if (dim("width") && dim("width") <= 4) return "";
	if (dim("height") && dim("height") <= 4) return "";
	const alt = attr(n, "alt").trim();
	let abs = src;
	try {
		abs = new URL(src, ctx.base?.href).href;
	} catch {
		// leave relative as-is when there is no base to resolve against
	}
	if (IMG_ICON.test(src) || (alt && IMG_ICON.test(alt)) || IMG_HOST.test(abs)) return "";
	return `![${alt.replace(/[[\]]/g, " ").trim()}](${abs}) `;
}

function renderText(n: Text): string {
	return esc(n.data.replace(/[\u200b-\u200f\ufeff]/g, ""));
}

function renderNodes(nodes: ChildNode[], ctx: Ctx): string[] {
	const out: string[] = [];
	let buf = "";
	const flush = (): void => {
		const s = tidy(buf);
		const shots = (s.match(/!\[/g) || []).length;
		if (s && !/^[-*|_>]+$/.test(s) && !(shots >= 3 && s.replace(/!\[[^]]*]\([^)]*\)/g, "").trim().length < 60)) out.push(s);
		buf = "";
	};
	for (const n of nodes) {
		if (n.type === "text") {
			buf += renderText(n as Text);
			continue;
		}
		if (!isEl(n)) continue;
		if (SKIP.has(n.name)) continue;
		if (INLINE.has(n.name)) {
			buf += renderInlineEl(n, ctx);
			continue;
		}
		flush();
		const block = renderBlockEl(n, ctx);
		if (block) out.push(block);
	}
	flush();
	// Repeated chrome often appears twice (desktop and mobile breakpoints).
	return out.filter((b, i) => b !== out[i - 1]);
}

function renderInlineEl(n: Element, ctx: Ctx): string {
	const inner = () => inlineText(n, ctx);
	switch (n.name) {
		case "br":
			return "\n";
		case "wbr":
			return "";
		case "img":
			return image(n, ctx);
		case "code":
		case "kbd":
		case "samp":
		case "tt":
			return inlineCode(rawText(n));
		case "a": {
			const blocks = renderNodes(kids(n), ctx);
			const label = tidy(blocks.join(" "));
			const target = resolveHref(attr(n, "href"), ctx);
			if (!target) return label;
			if (!label) return "";
			if (label === target || label.includes(target)) return target;
			// A link that wraps a whole card keeps its structure instead of its href.
			if (label.length > 400) return blocks.join("\n\n");
			// Inside a link the image URL is redundant: the target already points at
			// the page, so the label keeps only the alt text.
			const flat = label
				.replace(/!\[([^\]]*)]\([^)]*\)/g, "$1 ")
				.replace(/\\?#{1,6} /g, "")
				.replace(/\s*\n\s*/g, " ")
				.replace(/\\([#>|])/g, "$1")
				.replace(/ {2,}/g, " ")
				.trim();
			return flat ? `[${flat}](${target})` : "";
		}
		case "strong":
		case "b":
		case "em":
		case "i":
		case "del":
		case "s":
		case "strike": {
			const text = inner();
			if (!text) return "";
			const mark = n.name === "strong" || n.name === "b" ? "**" : n.name === "em" || n.name === "i" ? "*" : "~~";
			return `${mark}${text}${mark}`;
		}
		case "abbr": {
			const t = attr(n, "title");
			const label = inner();
			return t && label && !label.includes(t) ? `${label} (${t})` : label;
		}
		default:
			return inner();
	}
}

function tableRows(n: Element): Element[][] {
	return allTags(n)
		.filter((e) => e.name === "tr")
		.map((tr) => kids(tr).filter(isEl).filter((c) => c.name === "td" || c.name === "th"));
}

function renderTable(n: Element, ctx: Ctx): string {
	// A table that is mostly links is a nav grid, not data.
	if (linkDensity(n) > 0.6 && wordCount(textOf(n)) > 40) return "";
	const rows = tableRows(n).filter((r) => r.length);
	if (!rows.length) return "";
	const caption = childTag(n, "caption");
	const cap = caption ? `*${tidy(renderNodes(caption.children, ctx).join(" "))}*\n\n` : "";
	const cells = rows.map((r) => r.map((c) => tidy(renderNodes(c.children, ctx).join(" ")).replace(/\|/g, "\\|").replace(/\n/g, " ")));
	const cols = Math.max(...cells.map((r) => r.length));
	if (cols < 2) return cells.map((r) => r.join("\n")).filter(Boolean).join("\n\n");
	const head = cells[0];
	const body = cells.slice(1).filter((r) => r.some((c) => c));
	const line = (r: string[]): string => `| ${[...r, ...Array(cols - r.length).fill("")].join(" | ")} |`;
	return `${cap}${line(head)}\n|${Array(cols).fill(" --- |").join("")}${body.length ? "\n" + body.map(line).join("\n") : ""}`;
}

function renderList(n: Element, ctx: Ctx): string {
	const ordered = n.name === "ol";
	const start = Number(attr(n, "start")) || 1;
	const items = childTags(n, "li");
	const out: string[] = [];
	items.forEach((li, i) => {
		const marker = ordered ? `${i + start}. ` : "- ";
		const blocks = renderNodes(li.children, ctx);
		if (!blocks.length) return;
		const pad = " ".repeat(marker.length);
		// Nested lists hug the parent item, while further paragraphs stay separate.
		const joined = blocks.reduce((acc: string, b: string) => {
			if (!acc) return b;
			const sep = /^([-+*]|\d+\.) /.test(b) ? "\n" : "\n\n";
			return acc + sep + b;
		}, "");
		const text = joined
			.split("\n")
			.map((l, idx) => (idx === 0 ? marker + l : pad + l))
			.join("\n");
		out.push(text);
	});
	return out.join("\n");
}

function renderBlockEl(n: Element, ctx: Ctx): string {
	if (HEADINGS.has(n.name)) {
		const text = inlineText(n, ctx);
		return text ? `${"#".repeat(Number(n.name[1]))} ${text}` : "";
	}
	switch (n.name) {
		case "pre":
		case "listing":
		case "plaintext": {
			const code = codeText(n);
			return code ? fence(code, codeLang(n)) : "";
		}
		case "hr":
			return "---";
		case "blockquote": {
			const inner = renderNodes(n.children, ctx).join("\n\n");
			return inner ? inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n") : "";
		}
		case "ul":
		case "ol":
			return renderList(n, ctx);
		case "dl": {
			const out: string[] = [];
			let term = "";
			for (const c of kids(n)) {
				if (!isEl(c)) continue;
				const text = tidy(renderNodes(c.children, ctx).join(" "));
				if (!text) continue;
				if (c.name === "dt") {
					if (term) out.push(`- **${term}**`);
					term = text;
				} else if (c.name === "dd") {
					out.push(term ? `- **${term}** ${text}` : `- ${text}`);
					term = "";
				}
			}
			if (term) out.push(`- **${term}**`);
			return out.join("\n");
		}
		case "table":
			return renderTable(n, ctx);
		case "figure": {
			const cap = childTag(n, "figcaption");
			const rest = kids(n).filter((c) => c !== cap);
			const body = renderNodes(rest, ctx).join("\n\n");
			const caption = cap ? tidy(renderNodes(cap.children, ctx).join(" ")) : "";
			return [body, caption ? `*${caption}*` : ""].filter(Boolean).join("\n\n");
		}
		case "details": {
			const sum = childTag(n, "summary");
			const rest = kids(n).filter((c) => c !== sum);
			// A summary that holds a heading keeps that heading level instead of
			// getting wrapped in emphasis markers.
			const headBlocks = sum ? renderNodes(kids(sum), ctx) : [];
			const headText = headBlocks.join("\n\n");
			const head = !headBlocks.length ? "" : /^#{1,6} /m.test(headText) ? headText : `**${tidy(headBlocks.join(" "))}**`;
			return [head, renderNodes(rest, ctx).join("\n\n")].filter(Boolean).join("\n\n");
		}
		default:
			return renderNodes(n.children, ctx).join("\n\n");
	}
}

/** Convert the picked content region to markdown. */
export function renderMarkdown(roots: Element[], baseUrl?: string): string {
	const ctx: Ctx = {};
	try {
		if (baseUrl) ctx.base = new URL(baseUrl);
	} catch {
		// a bad base URL only costs link resolution, not the page text
	}
	const blocks: string[] = [];
	for (const r of roots) {
		const b = renderNodes([r], ctx).join("\n\n").trim();
		if (b) blocks.push(b);
	}
	return blocks
		.filter((b, i) => b !== blocks[i - 1])
		.join("\n\n")
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
