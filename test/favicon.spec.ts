import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Logo from '../src/lib/components/Logo.svelte';
import { faviconSvg, markSvg } from '$lib/shared/mark';
import { applyFavicon } from '$lib/client/favicon';
import { applyTheme } from '$lib/client/state.svelte';
import { DEFAULT_THEME } from '$lib/shared/types';

/**
 * The sidebar mark and the browser tab icon must be the same drawing. Both read
 * the geometry in shared/mark.ts, so these tests only have to keep the two
 * renderings, and the static file used before the app boots, in step.
 */

/** Every shape without its fills, so two drawings can be compared. */
function shapesOf(source: string): string[] {
	return [...source.matchAll(/<(rect|path|circle)\b[^>]*>/g)]
		.map((match) => match[0].replace(/\s+/g, ' ').replace(/\s*\/?>$/, '').trim())
		// The tile behind the tab icon is not part of the mark.
		.filter((shape) => !shape.startsWith('rect width="32"'));
}

describe('the pig mark', () => {
	it('draws the same shapes in the sidebar logo and the tab icon', () => {
		const { body } = render(Logo);
		const inLogo = shapesOf(body);
		expect(inLogo, 'head, two ears, snout, two eyes and two nostrils').toHaveLength(8);
		expect(inLogo).toEqual(shapesOf(markSvg('#000000', '#ffffff')));
	});

	it('puts the accent on the tile and the contrast colour on the pig', () => {
		const svg = faviconSvg('#123456', '#abcdef');
		expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">')).toBe(true);
		// The tile wears the accent, and so does the face of the pig on it.
		expect(svg).toContain('<rect width="32" height="32" rx="8" fill="#123456"/>');
		expect(svg).toContain('<g fill="#123456"><rect x="9.5"');
		// Head, ears and nostrils take the contrast colour to stand off the tile.
		expect(svg).toContain('<g fill="#abcdef">');
	});

	it('keeps the static first paint file equal to the default theme', () => {
		const css = readFileSync('src/app.css', 'utf8');
		const block = /\[data-theme='sloppy'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
		const value = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim() ?? '';
		const accent = value('accent');
		const contrast = value('accent-fg');
		expect(accent, 'the sloppy theme sets an accent').not.toBe('');
		expect(contrast, 'the sloppy theme sets a contrast colour').not.toBe('');
		expect(readFileSync('static/favicon.svg', 'utf8').trim()).toBe(faviconSvg(accent, contrast));
	});

	it('writes the resolved theme colours into the icon link', () => {
		const link = { type: '', href: '' };
		const colours: Record<string, string> = { '--accent': '#eb6f92', '--accent-fg': '#191724' };
		const globals = globalThis as unknown as Record<string, unknown>;
		const before = { document: globals.document, getComputedStyle: globals.getComputedStyle };
		globals.document = { documentElement: {}, querySelector: () => link };
		globals.getComputedStyle = () => ({ getPropertyValue: (name: string) => colours[name] ?? '' });
		try {
			applyFavicon();
		} finally {
			globals.document = before.document;
			globals.getComputedStyle = before.getComputedStyle;
		}
		expect(link.type).toBe('image/svg+xml');
		expect(link.href.startsWith('data:image/svg+xml,')).toBe(true);
		const svg = decodeURIComponent(link.href.replace('data:image/svg+xml,', ''));
		expect(svg).toBe(faviconSvg('#eb6f92', '#191724'));
	});

	it('leaves the icon alone when the stylesheet has no colours yet', () => {
		const link = { type: 'image/svg+xml', href: '/favicon.svg' };
		const globals = globalThis as unknown as Record<string, unknown>;
		const before = { document: globals.document, getComputedStyle: globals.getComputedStyle };
		globals.document = { documentElement: {}, querySelector: () => link };
		globals.getComputedStyle = () => ({ getPropertyValue: () => '' });
		try {
			applyFavicon();
		} finally {
			globals.document = before.document;
			globals.getComputedStyle = before.getComputedStyle;
		}
		expect(link.href).toBe('/favicon.svg');
	});

	it('repaints the icon every time the theme resolves to another accent', () => {
		const link = { type: '', href: '' };
		const colours: Record<string, string> = { '--accent': '#0f766e', '--accent-fg': '#ffffff' };
		const globals = globalThis as unknown as Record<string, unknown>;
		const before = {
			document: globals.document,
			getComputedStyle: globals.getComputedStyle,
			matchMedia: globals.matchMedia
		};
		globals.document = {
			documentElement: { dataset: {}, style: { setProperty: () => {} } },
			querySelector: () => link
		};
		globals.getComputedStyle = () => ({ getPropertyValue: (name: string) => colours[name] ?? '' });
		globals.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
		try {
			applyTheme({ ...DEFAULT_THEME, name: 'sloppy' });
			expect(decodeURIComponent(link.href)).toContain('fill="#0f766e"');
			// The same call the settings modal makes when another theme is picked.
			colours['--accent'] = '#eb6f92';
			colours['--accent-fg'] = '#191724';
			applyTheme({ ...DEFAULT_THEME, name: 'rose-pine' });
			expect(decodeURIComponent(link.href)).toContain('fill="#eb6f92"');
		} finally {
			globals.document = before.document;
			globals.getComputedStyle = before.getComputedStyle;
			globals.matchMedia = before.matchMedia;
		}
	});
});
