// HTML to reader-mode markdown, in one call.
// parse -> metadata -> main region -> markdown.
import { extractContent, extractMeta, parseHtml, type PageMeta } from "./reader";
import { renderMarkdown } from "./markdown";

/** Ceiling for pages where reader mode could not find an article region. */
export const FALLBACK_MAX_CHARS = 8000;

export interface HtmlExtract extends PageMeta {
	markdown: string;
}

/** True when only a handful of words survived, which means no article region. */
function isThin(md: string): boolean {
	return md.replace(/[^a-z0-9]/gi, "").length < 80;
}

export function htmlToMarkdown(html: string, baseUrl?: string): HtmlExtract {
	const doc = parseHtml(html);
	const meta = extractMeta(doc);
	const { roots, meta: used } = extractContent(doc, meta);
	let markdown = renderMarkdown(roots, baseUrl);
	let mode = used.mode;

	// Safety net: aggressive stripping can empty a page whose markup confuses
	// the scorer, so retry with junk-tag removal only.
	if (isThin(markdown) && html.length > 4000) {
		const retry = extractContent(parseHtml(html), { ...meta, mode: "fallback" });
		const md = renderMarkdown(retry.roots, baseUrl);
		if (md.trim()) {
			markdown = md;
			mode = "fallback";
		}
	}

	// When there is no article region at all (mega-menu portals, JS shells) the
	// fallback keeps page text. Cap it so chrome cannot flood the context.
	if (mode === "fallback" && markdown.length > FALLBACK_MAX_CHARS) {
		const kept = markdown.slice(0, FALLBACK_MAX_CHARS);
		const cut = kept.lastIndexOf("\n");
		markdown = `${kept.slice(0, cut > 0 ? cut : FALLBACK_MAX_CHARS)}\n\n[No article region found. Page text trimmed from ${Math.round(markdown.length / 1024)} KB. Pass raw=true to read the HTML.]`;
	}

	// Never hand back nothing: say why the page is empty instead.
	if (!markdown.trim()) markdown = "[No article text found. The page may need JavaScript or a login. Use raw=true for the HTML.]";

	// Give the agent a top heading when the page markup had none.
	if (markdown.length > 400 && meta.title && !/^#{1,6} /m.test(markdown)) markdown = `# ${meta.title}\n\n${markdown}`;

	return { ...used, mode, markdown };
}
