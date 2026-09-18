import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Layout invariants that no server rendered test can catch, because they depend
 * on how the browser sizes things. The compiled stylesheet was measured by hand
 * in a browser for each of these; the checks below keep the cause in place.
 */

const topBar = readFileSync('src/lib/components/TopBar.svelte', 'utf8');
const messageItem = readFileSync('src/lib/components/MessageItem.svelte', 'utf8');

describe('top bar', () => {
	it('does not change height when the chat title is renamed', () => {
		// The field replaces the heading inside the same flexible container, so the
		// other controls keep their place, and its height matches the icon buttons
		// (padding 6px + 18px icon + 6px + border = 32px) instead of the 35px a
		// default field asks for.
		expect(topBar).toContain('class="field h-8 min-w-0 flex-1 py-0 text-sm"');
		// One container, used by both the heading and the field.
		expect(topBar.match(/class="flex min-w-0 flex-1 items-center gap-1"/g)).toHaveLength(1);
	});

	it('keeps the model picker from demanding a fixed width', () => {
		// A fixed width would wrap the bar on a narrow window.
		expect(topBar).toContain('field w-36 text-xs sm:w-52 md:w-64');
	});

	it('collapses the chat list without moving the bar', () => {
		// The bar carries the new chat button while the list is out of sight, and it
		// was measured at 400 to 1280 px in both states: always 45 px tall, which is
		// 6 px padding + the 32 px row + 6 px padding + the border. So the button
		// must stay inside that row: 6 px padding + an 18 px icon is 30 px.
		expect(topBar).toContain('{#if !app.sidebarOpen}');
		expect(topBar).toContain('class="btn-accent shrink-0 p-1.5"');
	});
});

describe('message bubbles', () => {
	it('hugs the text so a wide caption cannot stretch it', () => {
		expect(messageItem).toContain('ml-auto w-fit rounded-card bg-accent');
	});
});

describe('sidebar footer', () => {
	const sidebar = readFileSync('src/lib/components/Sidebar.svelte', 'utf8');
	const logo = readFileSync('src/lib/components/Logo.svelte', 'utf8');

	it('keeps the mark outside the scrollable chat list', () => {
		// The chat list is the only scroll container in the column, so anything
		// after it stays in view however long the list grows.
		expect(sidebar.indexOf('</nav>')).toBeGreaterThan(-1);
		expect(sidebar.indexOf('<footer')).toBeGreaterThan(sidebar.indexOf('</nav>'));
		expect(sidebar.indexOf('</aside>')).toBeGreaterThan(sidebar.indexOf('<footer'));
	});

	it('draws the same mark as the favicon', () => {
		const favicon = readFileSync('static/favicon.svg', 'utf8');
		expect(logo).toContain('viewBox="0 0 32 32"');
		expect(favicon).toContain('width="32" height="32" rx="8"');
		const lines = /d="([^"]+)"/.exec(logo)?.[1] ?? '';
		expect(lines, 'the mark has three lines').toContain('M8 11h16');
		expect(favicon).toContain(`d="${lines}"`);
	});

	it('draws the mark for the eye only, with no extra tab stop', () => {
		expect(logo).toContain('aria-hidden="true"');
		expect(logo).not.toMatch(/<a\b|<button\b/);
		// Colours come from the theme, so the mark follows every theme and mode.
		expect(logo).toContain('fill-accent');
		expect(logo).toContain('stroke-accent-fg');
	});
});

describe('scroll containers', () => {
	/**
	 * Keyboard scrolling (Tridactyl j/k and the same search the browser does)
	 * scrolls the first element in document order that can actually scroll. A
	 * clipped text box counts: `overflow: hidden` is still scrollable by script,
	 * so a one pixel overflow would swallow the keys.
	 */
	it('clips truncated text without creating a scroll container', () => {
		const appCss = readFileSync('src/app.css', 'utf8');
		expect(appCss).toMatch(/\.truncate-clip\s*\{[^}]*overflow:\s*clip/);

		const files = readdirSync('src/lib/components')
			.filter((name) => name.endsWith('.svelte'))
			.map((name) => `src/lib/components/${name}`);
		files.push('src/routes/+layout.svelte');
		for (const file of files) {
			// The plain utility sets overflow: hidden, which is scrollable.
			expect(readFileSync(file, 'utf8'), file).not.toMatch(/\btruncate\b(?!-)/);
		}
	});

	it('keeps the skip link out of the way without clipping it', () => {
		const appCss = readFileSync('src/app.css', 'utf8');
		const layout = readFileSync('src/routes/+layout.svelte', 'utf8');
		expect(layout).toContain('class="skip-link"');
		// sr-only is a one pixel box with overflow hidden, which can scroll.
		expect(layout).not.toContain('sr-only');
		expect(appCss).toMatch(/\.skip-link\s*\{[^}]*overflow:\s*visible|pointer-events:\s*none/);
	});
});
