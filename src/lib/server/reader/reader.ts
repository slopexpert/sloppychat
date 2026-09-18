// Reader-mode extraction: drop page chrome, then pick the main content region.
// Order matters: kill junk tags, then hidden nodes, then component-name
// matches, then score the remaining tree to find the article body.
import { parseDocument } from "htmlparser2";
import type { Document, Element } from "domhandler";
import {
	allTags,
	ancestors,
	attr,
	findMeta,
	findOneTag,
	findTags,
	hasAncestorTag,
	hitSub,
	hitWord,
	isEl,
	isHidden,
	kids,
	linkDensity,
	parent,
	remove,
	segments,
	textLen,
	textOf,
} from "./dom";

export interface PageMeta {
	title?: string;
	siteName?: string;
	byline?: string;
	published?: string;
	/** How much stripping was applied, for diagnostics. */
	mode: "reader" | "fallback";
}

export interface ReadResult {
	roots: Element[];
	meta: PageMeta;
}

// Junk that never carries article text.
const JUNK_TAGS = new Set([
	"script", "style", "noscript", "template", "iframe", "form", "svg", "canvas", "embed", "object", "param",
	"map", "area", "base", "link", "meta", "title", "button", "input", "select", "datalist", "optgroup", "option",
	"textarea", "label", "fieldset", "legend", "output", "meter", "progress", "marquee", "blink", "video", "audio",
	"source", "track", "menu", "menubar", "listbox", "combobox", "search", "noindex", "portal", "fencedframe",
]);

// Component names that mean chrome, matched per word segment so that `navy` and
// `badge` stay safe. HARD words remove a node even when it holds prose (comment
// threads, consent walls). SOFT words are layout terms that also show up in
// wrapper class names, so they never remove a node that reads like an article.
const HARD_NEG = new Set([
	"cookie", "cookies", "consent", "gdpr", "ccpa", "paywall", "advert", "advertisement", "ads", "ad", "sponsor",
	"sponsored", "promo", "newsletter", "subscribe", "signup", "signin", "login", "logout", "register", "comment",
	"comments", "reactions", "disqus", "giscus", "utterances", "isso", "related", "recommend", "recommender",
	"outbrain", "taboola", "zergnet", "share", "social", "follow", "donate", "donation", "cart", "checkout",
	"wishlist", "catlinks", "navbox", "sitenotice", "printfooter", "editsection", "vote", "voting", "poll",
	"countdown", "webinar", "interstitial", "upsell", "onboarding", "cookiebot", "onetrust", "avatar", "gravatar",
	"skip", "popup", "modal", "overlay", "hamburger", "banner",
]);

const SOFT_NEG = new Set([
	"nav", "navigation", "navbar", "menubar", "menu", "sidebar", "sidepanel", "footer", "header", "masthead",
	"topbar", "toolbar", "breadcrumb", "breadcrumbs", "toc", "pagination", "pager", "search", "filter", "sort",
	"tabs", "tabbar", "dropdown", "popover", "drawer", "widget", "teaser",
]);

// Concatenated names that segment matching cannot see.
const NEG_SUBS = [
	"adsbygoogle", "doubleclick", "googlesyndication", "adsystem", "addtoany", "addthis", "outbrain", "taboola",
	"relatedposts", "recommended", "disqus", "giscus", "utterances", "catlinks", "navbox", "sitenotice", "skip-link",
	"jump-link", "hamburger", "cookiebot", "onetrust", "web-vitals", "megamenu", "masthead", "navbar", "navmenu",
	"sharebar", "socialshare", "share-button", "sign-in",
];

// Component names that mean article body. Used only to nudge scoring.
const POS_WORDS = new Set([
	"article", "post", "entry", "content", "main", "story", "prose", "tutorial", "documentation", "doc", "chapter",
	"lesson", "guide", "blog", "news", "markdown", "wiki", "answer", "question", "body", "text", "detail",
	"description", "readme", "docs",
]);

// Headings that open a boilerplate tail section. Only trusted late in the page.
const BOILER_HEADING =
	/^(comments?\b|leave (a|your) (comment|reply)|respond\b|replies\b|reader (responses|comments)|related (post|article|story|stories|reading|links|topics|content)|you may (also like|enjoy)|more like this|read (next|also|more)|up next|more (articles|posts|from|stories)|popular (this week|articles|posts)|share (this|on|the|article)|subscribe|newsletter|sign ?up|create (a |your )?(free |new )?account|advertisement|sponsored|about the author|author (bio|profile)|biography|table of contents|contents\b|on this page|what'?s in|categories\b|tags\b|follow (us|me)|get the (app|poster)|download the|join the conversation|most popular)/i;

// Labels on collapsible widgets that name a boilerplate thread.
const SUMMARY_BOILER = /\b(comments?|replies|responses|related (posts|articles|stories|links)|recommended|subscribe|newsletter|read (next|more)|sign ?up|share this)\b/i;

const SKIP_LINK = /^(skip|jump|go (to|next)|continue)\s+to\s+(the\s+)?(main|content|navigation|primary|footer|search)|^skip (to )?(content|main|menu|navigation|footer)\b/i;

// Unambiguous names of heading-permalink and edit-tab icons. Bare words like
// "anchor" are left out: styled-components uses them for real headline links.
const ANCHOR_ICON = ["headerlink", "permalink", "anchorjs", "mw-editsection", "mw-jump", "heading-anchor", "edit-link"];

const LINKY = new Set(["ul", "ol", "div", "section", "p", "span"]);

const LISTY = new Set(["ul", "ol", "table", "p", "dl", "figure", "blockquote"]);

const PARA_TAGS = ["p", "pre", "blockquote", "td", "h2", "h3", "h4", "li", "dd", "figcaption"];
const CANDIDATE_TAGS = new Set(["div", "article", "section", "main", "td", "figure", "details"]);

const pCache = new WeakMap<Element, number>();

/** A node with real body copy: layout words in its name must not remove it. */
function readsLikeArticle(n: Element): boolean {
	if (textLen(n) < 1200) return false;
	let paras = pCache.get(n);
	if (paras === undefined) {
		paras = findTags(n, "p").length;
		pCache.set(n, paras);
	}
	return paras >= 3;
}

/** Div-like nodes, including custom elements from web-component sites. */
function isContainer(name: string): boolean {
	return CANDIDATE_TAGS.has(name) || name.includes("-");
}

/** Parse to a DOM. Entities decode here, so the renderer never sees `&mdash;`. */
export function parseHtml(html: string): Document {
	return parseDocument(html, { decodeEntities: true });
}

function metaJsonLd(doc: Document): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	for (const s of findTags(doc, "script")) {
		if (!/application\/ld\+json/i.test(attr(s, "type"))) continue;
		const raw = kids(s).map((k) => ("data" in k ? String((k as { data: string }).data) : "")).join("");
		for (const chunk of raw.split(/<\/script>/i)) {
			try {
				const parsed = JSON.parse(chunk.trim());
				const items = Array.isArray(parsed) ? parsed : [parsed];
				for (const it of items) if (it && typeof it === "object") out.push(it as Record<string, unknown>);
			} catch {
				// Malformed JSON-LD is common; the meta tags carry the same data.
			}
		}
	}
	return out;
}

function jsonLdNode(obj: unknown): Record<string, unknown>[] {
	if (!obj || typeof obj !== "object") return [];
	if (Array.isArray(obj)) return obj.flatMap(jsonLdNode);
	const o = obj as Record<string, unknown>;
	const out = [o];
	if (o["@graph"]) out.push(...jsonLdNode(o["@graph"]));
	return out;
}

function ldField(doc: Document, field: "author" | "datePublished"): string {
	const ARTICLE = /article|blogposting|newsarticle|techarticle|qa(quest|page)|howto|webpage/i;
	for (const raw of metaJsonLd(doc)) {
		for (const node of jsonLdNode(raw)) {
			if (!ARTICLE.test(String(node["@type"] ?? ""))) continue;
			const v = node[field];
			const name = typeof v === "string" ? v : Array.isArray(v) ? v.map((x) => (x as { name?: string })?.name).filter(Boolean).join(", ") : ((v as { name?: string })?.name ?? "");
			if (name && String(name).length < 160) return String(name);
		}
	}
	return "";
}

function isoDate(v: string): string {
	const m = v.match(/\d{4}-\d{2}-\d{2}/);
	return m ? m[0] : "";
}

/** Title, site, author, and publish date from head tags and JSON-LD. */
export function extractMeta(doc: Document): PageMeta {
	const siteName = findMeta(doc, ["og:site_name", "twitter:site", "application-name"]).trim();
	const ogTitle = findMeta(doc, ["og:title", "twitter:title"]).trim();
	const titleEl = findOneTag(doc, "title");
	const rawTitle = titleEl ? textOf(titleEl) : "";
	let title = ogTitle && ogTitle.toLowerCase() !== siteName.toLowerCase() ? ogTitle : rawTitle;
	if (siteName && title) {
		// Drop the " | Site Name" suffix that CMS templates append.
		title = title.replace(new RegExp(`\\s*[|\\u2013\\u2014:\\u00bb-]\\s*${siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$")}$`, "i"), "");
	}
	const author =
		findMeta(doc, ["author", "article:author", "dc.creator", "parsely-author", "citation_author", "twitter:data1"]) ||
		ldField(doc, "author");
	const timeEl = findTags(doc, "time")[0];
	const published = isoDate(
		findMeta(doc, ["article:published_time", "date", "publication_date", "publish-date", "display-date", "article.published"]) ||
			(timeEl ? attr(timeEl, "datetime") : "") ||
			ldField(doc, "datePublished"),
	);
	return {
		title: title || undefined,
		siteName: siteName || undefined,
		byline: author.trim() || undefined,
		published: published || undefined,
		mode: "reader",
	};
}

function dropHidden(root: Element): void {
	for (const n of allTags(root)) if (isHidden(n)) remove(n);
}

/** Main article region plus the metadata found in head. */
export function extractContent(doc: Document, meta: PageMeta): ReadResult {
	const html = findOneTag(doc, "html") ?? doc;
	const body = findOneTag(html, "body") ?? (isEl(html) ? html : null);
	if (!body) return { roots: [], meta: { ...meta, mode: "fallback" } };

	const aggressive = meta.mode === "reader";
	const total = textLen(body);
	if (total < 40) return { roots: [body], meta: { ...meta, mode: "fallback" } };

	// Never delete a node that holds most of the page. Unclosed `<nav>` or a
	// `class="modal-wrapper"` around everything would otherwise empty the doc.
	const safeRemove = (n: Element): boolean => {
		if (n === body || n.name === "body" || n.name === "html" || n.name === "main" || n.name === "article") return false;
		if (n.name === "pre" || hasAncestorTag(n, "pre")) return false;
		// An unclosed <nav> swallows the rest of the document. Keep the prose and
		// drop only the link clusters instead of removing everything.
		if (textLen(n) > total * 0.5) {
			for (const c of kids(n).filter(isEl)) if ((c.name === "a" || LINKY.has(c.name)) && linkDensity(c) > 0.6) remove(c);
			return false;
		}
		remove(n);
		return true;
	};

	for (const n of findTags(body, ...Array.from(JUNK_TAGS))) remove(n);
	dropHidden(body);

	// Structural chrome goes first: it is safe even when the rest of the page is
	// kept as-is, which is what the fallback path does.
	for (const n of findTags(body, "nav", "footer", "dialog")) safeRemove(n);
	dropSkipLinks(body);
	if (!aggressive) return { roots: [body], meta: { ...meta, mode: "fallback" } };

	// Header and aside can be real content inside an article, so keep them
	// there and let the density filters judge them later.
	for (const n of findTags(body, "header", "aside")) {
		if (hasAncestorTag(n, "article", "main")) continue;
		safeRemove(n);
	}
	// Anything whose component name says chrome, at any depth. Unquoted
	// attributes are covered because the parser normalized them.
	for (const n of allTags(body)) {
		if (n.name === "main" || n.name === "article" || n.name === "pre" || n.name === "code") continue;
		if (hasAncestorTag(n, "pre", "code", "kbd", "samp")) continue;
		const aria = segments(`${attr(n, "role")} ${attr(n, "aria-label")}`);
		const hard = hitWord(n, HARD_NEG) > 0;
		const soft = hitWord(n, SOFT_NEG) > 0 || hitSub(n, NEG_SUBS) || aria.some((x) => HARD_NEG.has(x) || SOFT_NEG.has(x));
		if (!hard && !soft) continue;
		if (!hard && readsLikeArticle(n)) continue;
		safeRemove(n);
	}

	const roots = pickRegion(body, total);
	pruneBoilerplate(roots);

	const kept = roots.reduce((a, r) => a + textLen(r), 0);
	if (kept < 160 || kept < total * 0.03) {
		pruneBoilerplate([body]);
		return { roots: [body], meta: { ...meta, mode: "fallback" } };
	}
	return { roots, meta };
}

/** Explicit `<main>` wins; otherwise score text density like reader mode does. */
function pickRegion(body: Element, total: number): Element[] {
	const main = findOneTag(body, "main") ?? findTags(body, "div").find((d) => attr(d, "role") === "main");
	if (main && textLen(main) >= Math.max(200, total * 0.25)) return [main];

	const articles = findTags(body, "article").filter((a) => textLen(a) >= Math.max(200, total * 0.45));
	if (articles.length === 1) return [articles[0]];

	const scored = scoreCandidates(body);
	let best = scored[0]?.node;
	// A thin winner means the page is a card or link index, not an article.
	if (!best || textLen(best) < total * 0.15) return [body];

	// Descend through wrapper divs that add nothing.
	for (;;) {
		const inner = scored.find((s) => s.node.parent === best && s.score >= scored[0].score * 0.85);
		if (!inner) break;
		best = inner.node;
	}

	// Keep substantial siblings: split articles often sit next to the body div.
	const box = parent(best) ?? body;
	const keep = kids(box)
		.filter(isEl)
		.filter(
			(k) =>
				k === best ||
				(textLen(k) >= 140 && linkDensity(k) < 0.25 && hitWord(k, HARD_NEG) === 0 && hitWord(k, SOFT_NEG) === 0 && !hitSub(k, NEG_SUBS)),
		);
	return keep.length ? keep : [best];
}

interface Scored {
	node: Element;
	score: number;
}

function scoreCandidates(body: Element): Scored[] {
	const scores = new Map<Element, number>();
	const add = (n: Element, v: number): void => {
		scores.set(n, (scores.get(n) ?? 0) + v);
	};
	const classBoost = (n: Element | null): number => {
		if (!n || !isEl(n)) return 1;
		const pos = hitWord(n, POS_WORDS);
		const neg = hitWord(n, HARD_NEG) + hitWord(n, SOFT_NEG) + (hitSub(n, NEG_SUBS) ? 1 : 0);
		return Math.max(0.15, 1 + pos * 0.5 - neg * 0.6);
	};

	for (const p of findTags(body, ...PARA_TAGS)) {
		const len = textLen(p);
		if (len < 25) continue;
		if (hasAncestorTag(p, "pre") && p.name !== "pre") continue;
		const commas = Math.min(3, (textOf(p).match(/,/g) ?? []).length);
		const weight = 1 + commas + Math.min(3, Math.floor(len / 100));
		const gp = parent(p);
		const ggp = gp ? parent(gp) : null;
		if (!ggp) continue;
		add(ggp, weight * classBoost(ggp) * (1 - linkDensity(ggp)));
		const gggp = parent(ggp);
		if (gggp && isContainer(gggp.name)) add(gggp, (weight / 3) * classBoost(gggp) * (1 - linkDensity(gggp)));
	}

	return [...scores.entries()]
		.filter(([n]) => isContainer(n.name) || n === body)
		.filter(([n]) => !isContainer(n.name) || textLen(n) >= 120)
		.map(([node, score]) => ({ node, score }))
		.sort((a, b) => b.score - a.score || depth(b.node) - depth(a.node));
}

function depth(n: Element): number {
	let d = 0;
	for (let p = parent(n); p; p = parent(p)) d++;
	return d;
}

/**
 * Drop boilerplate inside the picked region. Low-confidence removals (link
 * density) are skipped when the region turns out to be mostly links, which is
 * normal on news portals and index pages where the links are the content.
 */
function pruneBoilerplate(roots: Element[]): void {
	for (const root of roots) {
		const sure: Element[] = [];
		const maybe: Element[] = [];
		const covered = (n: Element, list: Element[]): boolean => ancestors(n).some((a) => list.includes(a));

		for (const n of allTags(root).filter((e) => isContainer(e.name) || LISTY.has(e.name))) {
			if (n === root || n.name === "pre" || hasAncestorTag(n, "pre") || covered(n, sure) || covered(n, maybe)) continue;
			const anchors = findTags(n, "a").length;
			// Link farms: nav clusters, TOCs, tag lists, related-article cards.
			if ((linkDensity(n) > 0.5 && textLen(n) > 40) || (anchors >= 4 && textLen(n) < anchors * 26)) maybe.push(n);
		}

		// Reference markers, permalink icons, and skip links never carry prose.
		for (const sup of findTags(root, "sup")) {
			if (/reference|cite|navbox|mw-ref/.test(`${attr(sup, "class")} ${attr(sup, "id")}`) || textOf(sup).length <= 4) sure.push(sup);
		}
		for (const a of findTags(root, "a")) {
			// Match component names as whole words: a styled-components class such as
			// Anchor-styles is a headline link, not a permalink icon.
			const c = `${attr(a, "class")} ${attr(a, "rel")} ${attr(a, "aria-label")}`.toLowerCase();
			if (/^#(cite|ref|footnote)/i.test(attr(a, "href")) || ANCHOR_ICON.some((w) => c.includes(w))) {
				sure.push(a);
			}
		}
		// A collapsible box titled "Comments" or "Related articles" is chrome whole.
		// Matched anywhere, since widget labels read like "Toggle all comments".
		for (const sum of findTags(root, "summary")) {
			if (!SUMMARY_BOILER.test(textOf(sum))) continue;
			sure.push(ancestors(sum).find((a) => a.name === "details") ?? sum);
		}
		sure.push(...tailSections(root));

		for (const n of sure.filter((e) => !covered(e, sure))) remove(n);

		const left = textLen(root);
		const dropped = maybe.reduce((a, n) => a + textLen(n), 0);
		if (left - dropped >= Math.max(400, left * 0.2)) for (const n of maybe) remove(n);
	}
}

/** Remove "skip to content" links, which are navigation chrome with no class on many sites. */
function dropSkipLinks(body: Element): void {
	for (const a of findTags(body, "a")) {
		if (!SKIP_LINK.test(textOf(a))) continue;
		const box = parent(a);
		if (box && textLen(box) <= textOf(a).length + 4) remove(box);
		else remove(a);
	}
}

/** Boilerplate heading plus the blocks under it, as a node list to drop. */
function tailSections(root: Element): Element[] {
	const headings = findTags(root, "h1", "h2", "h3", "h4", "h5", "h6");
	const blocks = findTags(root, "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "table", "pre", "blockquote");
	const out: Element[] = [];
	for (const h of headings) {
		if (!BOILER_HEADING.test(textOf(h))) continue;
		// Trust the keyword only after 40% of the page, so an early real section
		// such as "Comments in code" survives.
		if (blocks.indexOf(h) < blocks.length * 0.4) continue;
		const level = Number(h.name[1]);
		const box = parent(h);
		if (!box) continue;
		out.push(h);
		let seen = false;
		for (const sib of kids(box)) {
			if (sib === h) {
				seen = true;
				continue;
			}
			if (!seen || !isEl(sib)) continue;
			const sibLevel = /^h[1-6]$/.test(sib.name) ? Number(sib.name[1]) : 99;
			if (sibLevel <= level) break;
			out.push(sib);
		}
	}
	return out;
}
