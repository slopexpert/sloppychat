import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The first paint must already be in the right theme, otherwise a dark mode user
 * sees a white flash while the stylesheet loads. These checks read the shell and
 * keep the inline critical styles in step with the real stylesheet.
 */

const appHtml = readFileSync('src/app.html', 'utf8');
const appCss = readFileSync('src/app.css', 'utf8');
const layout = readFileSync('src/routes/+layout.svelte', 'utf8');

/** Pulls a custom property out of one selector block in the stylesheet. */
function tokenOf(selector: string, name: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const block = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(appCss)?.[1];
	if (!block) throw new Error(`selector ${selector} not found in app.css`);
	const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
	if (!value) throw new Error(`--${name} not found in ${selector}`);
	return value;
}

describe('boot shell', () => {
	it('sets the theme before the stylesheet is requested', () => {
		const script = appHtml.indexOf('dataset.mode');
		const head = appHtml.indexOf('%sveltekit.head%');
		expect(script).toBeGreaterThan(-1);
		expect(script).toBeLessThan(head);
	});

	it('inlines critical colours ahead of the stylesheet', () => {
		const style = appHtml.indexOf('<style>');
		const head = appHtml.indexOf('%sveltekit.head%');
		expect(style).toBeGreaterThan(-1);
		expect(style).toBeLessThan(head);
		expect(appHtml).toContain('color-scheme: light');
		expect(appHtml).toContain('color-scheme: dark');
	});

	it('matches the light tokens in app.css', () => {
		expect(appHtml).toContain(tokenOf(':root', 'bg'));
		expect(appHtml).toContain(tokenOf(':root', 'fg'));
	});

	it('matches the dark tokens in app.css', () => {
		expect(appHtml).toContain(tokenOf("[data-mode='dark']", 'bg'));
		expect(appHtml).toContain(tokenOf("[data-mode='dark']", 'fg'));
	});

	it('matches the placeholder text colour in app.css', () => {
		expect(appHtml).toContain(tokenOf(':root', 'faint'));
		expect(appHtml).toContain(tokenOf("[data-mode='dark']", 'faint'));
	});

	it('paints the page background without waiting for a stylesheet', () => {
		expect(appHtml).toMatch(/html\s*\{[^}]*background-color/);
		expect(appHtml).toMatch(/html\[data-mode='dark'\]\s*\{[^}]*background-color/);
		// The body margin must be zero before the framework stylesheet arrives.
		expect(appHtml).toMatch(/body\s*\{[^}]*margin:\s*0/);
	});

	it('shows a themed placeholder until the app mounts', () => {
		expect(appHtml).toMatch(/<div id="boot"[^>]*>/);
		expect(appHtml).toMatch(/#boot\s*\{[^}]*position:\s*fixed/);
		// It is decorative, the app announces its own loading state.
		expect(appHtml).toMatch(/<div id="boot" aria-hidden="true"/);
		expect(layout).toMatch(/getElementById\('boot'\)\?\.remove\(\)/);
	});
});
