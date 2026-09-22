import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme } from '$lib/client/state.svelte';
import { DEFAULT_THEME } from '$lib/shared/types';
import { resolveTheme, THEMES, variantIds } from '$lib/shared/themes';
import { fontStack } from '$lib/shared/fonts';

/**
 * Appearance settings are just data attributes on <html> plus two CSS variables,
 * so these tests cover the wiring: attributes written, defaults filled, values
 * remembered for the boot script, and a stylesheet block for every choice.
 */

const appHtml = readFileSync('src/app.html', 'utf8');
const appCss = readFileSync('src/app.css', 'utf8');

function stubs({ dark = false } = {}) {
	const dataset: Record<string, string> = {};
	const properties: Record<string, string> = {};
	const stored = new Map<string, string>();
	vi.stubGlobal('document', {
		documentElement: {
			dataset,
			style: { setProperty: (name: string, value: string) => (properties[name] = value) }
		}
	});
	vi.stubGlobal('localStorage', {
		setItem: (key: string, value: string) => stored.set(key, value),
		getItem: (key: string) => stored.get(key) ?? null
	});
	vi.stubGlobal('matchMedia', () => ({ matches: dark }));
	return { dataset, stored, properties };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('applyTheme', () => {
	it('writes every choice to the document', () => {
		const { dataset } = stubs();
		applyTheme({
			name: 'sloppy',
			font: 'custom',
			fontFamily: 'Iosevka',
			textSize: 'large',
			radius: 'round',
			density: 'spacious'
		});
		// data-mode is still written, it is the resolved scheme, not a setting.
		expect(dataset).toEqual({
			mode: 'light',
			theme: 'sloppy',
			font: 'custom',
			text: 'large',
			radius: 'round',
			density: 'spacious'
		});
	});

	it('follows the system preference', () => {
		expect(stubs({ dark: true }).dataset.mode).toBeUndefined();
		const dark = stubs({ dark: true });
		applyTheme({ name: 'sloppy' });
		expect(dark.dataset.mode).toBe('dark');

		const light = stubs({ dark: false });
		applyTheme({ name: 'sloppy' });
		expect(light.dataset.mode).toBe('light');
	});

	it('fills in the defaults for anything unset', () => {
		const { dataset } = stubs();
		applyTheme({ name: 'oled' });
		expect(dataset.font).toBe(DEFAULT_THEME.font);
		expect(dataset.text).toBe(DEFAULT_THEME.textSize);
		expect(dataset.radius).toBe(DEFAULT_THEME.radius);
		expect(dataset.density).toBe(DEFAULT_THEME.density);
	});

	it('remembers the choice for the boot script', () => {
		const { stored } = stubs();
		applyTheme({ density: 'compact' });
		const saved = JSON.parse(stored.get('sloppychat:theme') ?? '{}');
		expect(saved).toMatchObject({ density: 'compact', name: 'sloppy' });
	});

	it('does nothing without a document, so server rendering is safe', () => {
		vi.stubGlobal('document', undefined);
		expect(() => applyTheme({ density: 'spacious' })).not.toThrow();
	});
});

describe('boot script', () => {
	it('applies every attribute before the stylesheet loads', () => {
		for (const attribute of ['mode', 'theme', 'font', 'text', 'radius', 'density']) {
			expect(appHtml, attribute).toContain(`root.dataset.${attribute}`);
		}
	});

	it('sits before the app stylesheet', () => {
		expect(appHtml.indexOf('root.dataset.density')).toBeLessThan(appHtml.indexOf('%sveltekit.head%'));
	});
});

describe('fonts', () => {
	it('offers system and custom only', () => {
		expect(appCss).toContain("[data-font='custom']");
		// The old preset stacks are gone.
		for (const gone of ['serif', 'mono', 'humanist', 'grotesque']) {
			expect(appCss, gone).not.toContain(`[data-font='${gone}']`);
		}
	});

	it('resolves the custom family through a variable', () => {
		expect(appCss).toContain('--ui-font: var(--ui-font-custom)');
		expect(appCss).toContain('--ui-font-custom: var(--ui-font-system)');
	});

	it('turns a typed name into a font family', () => {
		expect(fontStack('Iosevka')).toBe('"Iosevka", var(--ui-font-system)');
		expect(fontStack('DejaVu Serif')).toBe('"DejaVu Serif", var(--ui-font-system)');
		expect(fontStack('  Inter  ')).toBe('"Inter", var(--ui-font-system)');
		// A list the user wrote is kept, the fallback is still appended.
		expect(fontStack('Inter, sans-serif')).toBe('Inter, sans-serif, var(--ui-font-system)');
		expect(fontStack('"Iosevka Aile", serif')).toBe('"Iosevka Aile", serif, var(--ui-font-system)');
		expect(fontStack('Iosevka;')).toBe('"Iosevka", var(--ui-font-system)');
		expect(fontStack('')).toBe('var(--ui-font-system)');
		expect(fontStack(undefined)).toBe('var(--ui-font-system)');
	});

	it('writes the custom family to the document', () => {
		const { dataset, properties } = stubs();
		applyTheme({ font: 'custom', fontFamily: 'Iosevka' });
		expect(dataset.font).toBe('custom');
		expect(properties['--ui-font-custom']).toBe('"Iosevka", var(--ui-font-system)');
	});

	it('falls back to the system font when nothing is typed', () => {
		const { dataset, properties } = stubs();
		applyTheme({ font: 'custom', fontFamily: '   ' });
		expect(dataset.font).toBe('custom');
		expect(properties['--ui-font-custom']).toBe('var(--ui-font-system)');
	});

	it('normalises old preset names to system', () => {
		const { dataset } = stubs();
		applyTheme({ font: 'serif' as never });
		expect(dataset.font).toBe('system');
	});
});

describe('accent ownership', () => {
	it('is no longer a user setting', () => {
		expect(DEFAULT_THEME).not.toHaveProperty('accent');
		// No override palettes remain in the stylesheet.
		expect(appCss).not.toContain('[data-accent=');
		// And the boot script does not write one either.
		expect(appHtml).not.toContain('dataset.accent');
	});

	it('is set by every palette', () => {
		for (const id of variantIds()) {
			const blocks = [`^\\[data-theme='${id}'\\][^\\{]*\\{([^}]*)\\}`];
			if (id === 'sloppy') blocks.push(`^\\[data-theme='sloppy'\\]\\[data-mode='dark'\\]\\s*\\{([^}]*)\\}`);
			const text = blocks
				.map((pattern) => new RegExp(pattern, 'm').exec(appCss)?.[1] ?? '')
				.join(' ');
			expect(text, `${id} accent`).toContain('--accent:');
		}
	});
});

describe('palettes', () => {
	/** Reads one theme block out of the stylesheet. */
	function themeBlock(id: string): string {
		const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const match = new RegExp(`^\\[data-theme='${escaped}'\\]\\s*\\{([^}]*)\\}`, 'm').exec(appCss);
		if (!match) throw new Error(`no stylesheet block for theme ${id}`);
		return match[1];
	}

	function token(block: string, name: string): string | undefined {
		return new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1];
	}

	function luminance(hex: string): number {
		const value = hex.replace('#', '');
		const channels = [0, 2, 4].map((at) => {
			const c = Number.parseInt(value.slice(at, at + 2), 16) / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
	}

	function contrast(a: string, b: string): number {
		const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
		return (light + 0.05) / (dark + 0.05);
	}

	const required = [
		'bg',
		'surface',
		'raised',
		'line',
		'fg',
		'muted',
		'faint',
		'accent',
		'accent-fg',
		'danger',
		'ok'
	];

	it('has a block for every variant in the list', () => {
		for (const id of variantIds()) {
			expect(() => themeBlock(id), id).not.toThrow();
		}
	});

	it('defines every token in each self contained palette', () => {
		for (const id of variantIds()) {
			if (id === 'sloppy') continue; // the default palette uses the mode blocks
			const block = themeBlock(id);
			for (const name of required) {
				expect(token(block, name), `${id} ${name}`).toBeDefined();
			}
		}
	});

	/**
	 * Upstream palettes are used unchanged, so the bar is WCAG AA for body text
	 * (every palette but Rose Pine Dawn clears AAA at 7:1) and just above 4:1 for
	 * the muted tone, which is the closest readable one some palettes offer.
	 */
	it('keeps text readable in every palette', () => {
		for (const id of variantIds()) {
			if (id === 'sloppy') continue;
			const block = themeBlock(id);
			const bg = token(block, 'bg')!;
			expect(contrast(token(block, 'fg')!, bg), `${id} body text`).toBeGreaterThanOrEqual(4.5);
			expect(contrast(token(block, 'muted')!, bg), `${id} muted text`).toBeGreaterThanOrEqual(4);
			expect(contrast(token(block, 'faint')!, bg), `${id} hint text`).toBeGreaterThanOrEqual(2);
			expect(
				contrast(token(block, 'accent-fg')!, token(block, 'accent')!),
				`${id} text on accent`
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('uses love as the Rose Pine accent and iris for italics', () => {
		for (const id of ['rose-pine', 'rose-pine-moon']) {
			const block = themeBlock(id);
			expect(token(block, 'accent'), `${id} accent`).toBe('#eb6f92');
			expect(token(block, 'secondary'), `${id} secondary`).toBe('#c4a7e7');
			// Inline code takes the palette gold, a lemon tone against the accent.
			expect(token(block, 'code'), `${id} inline code`).toBe('#f6c177');
			// The error colour has to stay distinct from the accent.
			expect(token(block, 'danger'), `${id} danger`).not.toBe(token(block, 'accent'));
		}
	});

	/** A palette may pick its own inline code tone; when it does, it must read. */
	it('keeps inline code readable where a palette sets its own tone', () => {
		for (const id of variantIds()) {
			const block = themeBlock(id);
			const code = token(block, 'code');
			if (!code) continue;
			expect(contrast(code, token(block, 'raised')!), `${id} inline code`).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('keeps the default palette readable in both modes', () => {
		const light = /^:root\s*\{([^}]*)\}/m.exec(appCss)?.[1] ?? '';
		const dark = /^\[data-mode='dark'\]\s*\{([^}]*)\}/m.exec(appCss)?.[1] ?? '';
		expect(contrast(token(light, 'fg')!, token(light, 'bg')!)).toBeGreaterThanOrEqual(7);
		expect(contrast(token(dark, 'fg')!, token(dark, 'bg')!)).toBeGreaterThanOrEqual(7);
	});

	it('gives the boot script every family and variant', () => {
		// The pre-paint script cannot import modules, so it repeats the table.
		for (const theme of THEMES) {
			// Keys may be bare when the id needs no quotes.
			const key = new RegExp(`(^|[{,\\s])'?${theme.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'?\\s*:`, 'm');
			expect(appHtml, `family ${theme.id}`).toMatch(key);
		}
		for (const id of variantIds()) {
			expect(appHtml, `variant ${id}`).toContain(id);
		}
	});
});

describe('light and dark variants', () => {
	it('follows the system preference for a family with both variants', () => {
		const light = stubs({ dark: false });
		applyTheme({ name: 'catppuccin' });
		expect(light.dataset.theme).toBe('catppuccin-latte');
		expect(light.dataset.mode).toBe('light');

		const dark = stubs({ dark: true });
		applyTheme({ name: 'catppuccin' });
		expect(dark.dataset.theme).toBe('catppuccin-mocha');
		expect(dark.dataset.mode).toBe('dark');
	});

	it('switches variant for every family that has two', () => {
		for (const theme of THEMES) {
			if (!theme.light || !theme.dark || theme.light === theme.dark) continue;
			expect(resolveTheme(theme.id, false).variant, `${theme.id} light`).toBe(theme.light);
			expect(resolveTheme(theme.id, true).variant, `${theme.id} dark`).toBe(theme.dark);
		}
	});

	it('keeps the scheme of a family with a single variant', () => {
		const light = stubs({ dark: false });
		applyTheme({ name: 'nord' });
		expect(light.dataset.theme).toBe('nord');
		expect(light.dataset.mode).toBe('dark');

		const dark = stubs({ dark: true });
		applyTheme({ name: 'rose-pine-moon' });
		expect(dark.dataset.theme).toBe('rose-pine-moon');
		expect(dark.dataset.mode).toBe('dark');
	});

	it('has no scheme setting at all', () => {
		expect(DEFAULT_THEME).not.toHaveProperty('mode');
		// The boot script reads no mode either.
		expect(appHtml).not.toContain('stored.mode');
		// And the settings UI has no mode control.
		const modal = readFileSync('src/lib/components/SettingsModal.svelte', 'utf8');
		expect(modal).not.toContain('Light and dark');
		expect(modal).not.toContain('setTheme({ mode');
	});

	it('falls back to the default family for an unknown name', () => {
		const { dataset } = stubs();
		applyTheme({ name: 'not-a-theme' });
		expect(dataset.theme).toBe('sloppy');
	});
});

describe('stylesheet choices', () => {
	/** Every id that is not the default needs its own block. */
	const blocks: Record<string, string[]> = {
		font: ['custom'],
		text: ['small', 'large'],
		radius: ['square', 'small', 'large', 'round'],
		density: ['compact', 'spacious']
	};

	for (const [attribute, ids] of Object.entries(blocks)) {
		it(`styles every ${attribute} choice`, () => {
			for (const id of ids) {
				expect(appCss, `${attribute}=${id}`).toContain(`[data-${attribute}='${id}']`);
			}
		});
	}

	it('never forces a radius, so a focus ring follows the setting', () => {
		const rule =
			/:where\(a, button, input, textarea, select, summary, \[tabindex\]\):focus-visible\s*\{([^}]*)\}/.exec(
				appCss
			)?.[1] ?? '';
		expect(rule, 'focus rule found').not.toBe('');
		expect(rule).toContain('outline');
		// A radius here would override the chosen corner setting while focused.
		expect(rule).not.toContain('border-radius');
	});

	it('derives every radius from the chosen one', () => {
		expect(appCss).toContain('--radius-sm: calc(var(--radius-control) * 0.5)');
		expect(appCss).toContain('--radius-md: calc(var(--radius-control) * 0.75)');
		expect(appCss).toContain('--radius-xl: calc(var(--radius-control) * 1.5)');
		expect(appCss).toContain('--radius-lg: var(--radius-control)');
		expect(appCss).toContain('--radius-card: var(--radius-card-size)');
	});

	it('uses no fixed radius utility, which would ignore the setting', () => {
		const files = [
			'src/app.css',
			...readdirSync('src/lib/components')
				.filter((name) => name.endsWith('.svelte'))
				.map((name) => `src/lib/components/${name}`)
		];
		for (const file of files) {
			// A bare `rounded` compiles to a fixed 0.25rem.
			expect(readFileSync(file, 'utf8'), file).not.toMatch(/\brounded(?![\w-])/);
		}
	});

	it('drives fonts, radius and density from variables', () => {
		expect(appCss).toContain('--font-sans: var(--ui-font)');
		expect(appCss).toContain('--radius-lg: var(--radius-control)');
		expect(appCss).toContain('--radius-lg: var(--radius-control)');
		expect(appCss).toContain('--radius-card: var(--radius-card-size)');
		// Tailwind builds spacing utilities from this one value.
		expect(appCss).toContain('--spacing: 0.25rem');
		expect(appCss).toContain('--text-body: var(--text-body-size)');
	});
});
