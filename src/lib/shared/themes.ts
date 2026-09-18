/**
 * Named colour themes.
 *
 * A theme is a family with a variant per scheme, so the system preference can
 * pick the right one. The palettes live in src/app.css as `[data-theme='<variant>']`
 * blocks; a family without a light or dark variant simply keeps the one it has,
 * which is why some entries are dark only.
 */

export interface ThemeInfo {
	/** What the setting stores. */
	id: string;
	label: string;
	light?: string;
	dark?: string;
	/** Where the palette comes from, shown in the picker. */
	credit: string;
}

export const THEMES: ThemeInfo[] = [
	{
		id: 'sloppy',
		label: 'Sloppy',
		light: 'sloppy',
		dark: 'sloppy',
		credit: 'the default palette, drawn for both schemes'
	},
	{ id: 'oled', label: 'OLED Black', dark: 'oled', credit: 'the default palette on true black' },
	{
		id: 'rose-pine',
		label: 'Rosé Pine',
		light: 'rose-pine-dawn',
		dark: 'rose-pine',
		credit: 'rose-pine.org'
	},
	{ id: 'rose-pine-moon', label: 'Rosé Pine Moon', dark: 'rose-pine-moon', credit: 'rose-pine.org' },
	{
		id: 'catppuccin',
		label: 'Catppuccin',
		light: 'catppuccin-latte',
		dark: 'catppuccin-mocha',
		credit: 'catppuccin.com'
	},
	{
		id: 'catppuccin-macchiato',
		label: 'Catppuccin Macchiato',
		dark: 'catppuccin-macchiato',
		credit: 'catppuccin.com'
	},
	{
		id: 'catppuccin-frappe',
		label: 'Catppuccin Frappé',
		dark: 'catppuccin-frappe',
		credit: 'catppuccin.com'
	},
	{ id: 'tokyo-night', label: 'Tokyo Night', dark: 'tokyo-night', credit: 'folke/tokyonight.nvim' },
	{
		id: 'tokyo-night-storm',
		label: 'Tokyo Night Storm',
		dark: 'tokyo-night-storm',
		credit: 'folke/tokyonight.nvim'
	},
	{
		id: 'gruvbox',
		label: 'Gruvbox',
		light: 'gruvbox-light',
		dark: 'gruvbox-dark',
		credit: 'morhetz/gruvbox'
	},
	{ id: 'nord', label: 'Nord', dark: 'nord', credit: 'nordtheme.com' },
	{
		id: 'vscode',
		label: 'VS Code',
		light: 'vscode-light-modern',
		dark: 'vscode-dark-modern',
		credit: 'microsoft/vscode'
	}
];

export const DEFAULT_THEME_ID = 'sloppy';

export function themeById(id: string | undefined): ThemeInfo {
	return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export interface ResolvedTheme {
	family: ThemeInfo;
	/** The stylesheet block to use. */
	variant: string;
	/** The scheme that variant is drawn for. */
	scheme: 'light' | 'dark';
}

/**
 * Picks the variant for the system scheme. A family with both variants follows
 * the system; one with a single variant keeps its own scheme, so a dark palette
 * stays dark during the day.
 */
export function resolveTheme(id: string | undefined, systemDark: boolean): ResolvedTheme {
	const family = themeById(id);
	const want: 'light' | 'dark' = systemDark ? 'dark' : 'light';
	const variant = (want === 'dark' ? family.dark : family.light) ?? family.dark ?? family.light ?? 'sloppy';
	const single = family.light === family.dark;
	const scheme: 'light' | 'dark' = single
		? want
		: variant === family.light
			? 'light'
			: variant === family.dark
				? 'dark'
				: want;
	return { family, variant, scheme };
}

/** Every stylesheet block the picker and the tests can ask for. */
export function variantIds(): string[] {
	return [...new Set(THEMES.flatMap((theme) => [theme.light, theme.dark]).filter(Boolean) as string[])];
}
