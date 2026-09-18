// Tree helpers for the reader pipeline: attribute clues, text metrics, and
// link density. Kept free of page-policy word lists (see reader.ts).
import { DomUtils as D } from "htmlparser2";
import { isTag, type AnyNode, type ChildNode, type Element } from "domhandler";

// All whitespace the parser can hand back, including NBSP, thin spaces, and
// zero-width markers that sites use to pad layout.
const SPACE = /[\s\u00a0\u1680\u2000-\u200f\u202f\u205f\u3000\ufeff]+/g;

export function isEl(n: AnyNode | null | undefined): n is Element {
	return !!n && isTag(n);
}

export function kids(n: AnyNode): ChildNode[] {
	return "children" in n ? (n.children as ChildNode[]) : [];
}

export function parent(n: AnyNode): Element | null {
	return isEl(n.parent) ? n.parent : null;
}

export function ancestors(n: AnyNode): Element[] {
	const out: Element[] = [];
	for (let p = parent(n); p; p = parent(p)) out.push(p);
	return out;
}

export function hasAncestorTag(n: AnyNode, ...names: string[]): boolean {
	return ancestors(n).some((a) => names.includes(a.name));
}

/** Collapse all whitespace runs to single spaces and trim. */
function norm(s: string): string {
	return s.replace(SPACE, " ").trim();
}

/** Visible text of a subtree, whitespace collapsed. */
export function textOf(n: AnyNode): string {
	return norm(D.getText(n));
}

const lenCache = new WeakMap<AnyNode, number>();
export function textLen(n: AnyNode): number {
	let v = lenCache.get(n);
	if (v === undefined) {
		v = textOf(n).length;
		lenCache.set(n, v);
	}
	return v;
}

export function wordCount(s: string): number {
	return s ? (s.match(/\S+/g) ?? []).length : 0;
}

const ldCache = new WeakMap<Element, number>();
/** Share of a subtree's words that sit inside anchors. High means link farm. */
export function linkDensity(n: Element): number {
	let v = ldCache.get(n);
	if (v === undefined) {
		const words = wordCount(textOf(n));
		let linked = 0;
		if (words) for (const a of findTags(n, "a")) linked += wordCount(textOf(a));
		v = words ? Math.min(1, linked / words) : 0;
		ldCache.set(n, v);
	}
	return v;
}

export function findTags(root: AnyNode, ...names: string[]): Element[] {
	const set = new Set(names);
	return D.getElementsByTagName((name: string) => set.has(name), root as Element, true);
}

/** Direct children with one of these tag names. */
export function childTags(n: AnyNode, ...names: string[]): Element[] {
	return kids(n).filter(isEl).filter((c) => names.includes(c.name));
}

export function childTag(n: AnyNode, name: string): Element | undefined {
	return childTags(n, name)[0];
}

/** Every element under root, in document order. */
export function allTags(root: AnyNode): Element[] {
	const out: Element[] = [];
	const walk = (n: AnyNode): void => {
		for (const c of kids(n)) {
			if (isEl(c)) {
				out.push(c);
				walk(c);
			}
		}
	};
	walk(root);
	return out;
}

export function findOneTag(root: AnyNode, name: string): Element | null {
	return D.getElementsByTagName(name, root as Element, true)[0] ?? null;
}

export function attr(n: Element, key: string): string {
	return n.attribs[key]?.trim() ?? "";
}

export function findMeta(root: AnyNode, keys: string[]): string {
	for (const key of keys) {
		for (const m of findTags(root, "meta")) {
			const name = attr(m, "name").toLowerCase() || attr(m, "property").toLowerCase();
			if (name === key) {
				const v = attr(m, "content");
				if (v) return v;
			}
		}
	}
	return "";
}

/**
 * Attribute text that names a component: class, id, role, ARIA label, test id.
 * Deliberately narrow, since data-* values are noisy on content wrappers.
 */
function clues(n: Element): string {
	return [attr(n, "class"), attr(n, "id"), attr(n, "role"), attr(n, "aria-label"), attr(n, "data-testid"), attr(n, "name")]
		.join(" ")
		.toLowerCase();
}

const CAMEL = /([a-z0-9])([A-Z])/g;
/** Split attribute text into word segments, so `main-Nav` yields main, nav. */
export function segments(s: string): string[] {
	return s
		.replace(CAMEL, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

/** Count of segments that are exactly one of the words. */
export function hitWord(n: Element, words: Set<string>): number {
	let hits = 0;
	for (const seg of segments(clues(n))) if (words.has(seg)) hits++;
	return hits;
}

/** True when the component name contains one of the longer unambiguous forms. */
export function hitSub(n: Element, subs: string[]): boolean {
	const c = clues(n);
	return subs.some((s) => c.includes(s));
}

export function isHidden(n: Element): boolean {
	if (D.hasAttrib(n, "hidden") || D.hasAttrib(n, "inert")) return true;
	if (attr(n, "aria-hidden").toLowerCase() === "true") return true;
	// opacity:0 is left alone: sites use it to fade real content in.
	if (/display\s*:\s*none|visibility\s*:\s*hidden/.test(attr(n, "style"))) return true;
	if (n.name === "dialog" && !D.hasAttrib(n, "open")) return true;
	return false;
}

export function remove(n: Element): void {
	// Text metrics are cached per node, so drop the entries the removal invalidates.
	for (let cur: AnyNode | null = n; cur; cur = isEl(cur) ? parent(cur) : null) {
		lenCache.delete(cur);
		ldCache.delete(cur);
	}
	D.removeElement(n);
}
