<script lang="ts">
	import { app, applyTheme } from '$lib/client/state.svelte';
	import type { ThemeSettings } from '$lib/shared/types';
	import { resolveTheme, THEMES } from '$lib/shared/themes';

	interface Choice {
		id: string;
		label: string;
	}

	const FONTS: Choice[] = [
		{ id: 'system', label: 'System' },
		{ id: 'custom', label: 'Custom' }
	];
	const TEXT_SIZES: Choice[] = [
		{ id: 'small', label: 'Small' },
		{ id: 'default', label: 'Default' },
		{ id: 'large', label: 'Large' }
	];
	const RADII: Choice[] = [
		{ id: 'square', label: 'Square' },
		{ id: 'small', label: 'Small' },
		{ id: 'default', label: 'Default' },
		{ id: 'large', label: 'Large' },
		{ id: 'round', label: 'Round' }
	];
	const DENSITIES: Choice[] = [
		{ id: 'compact', label: 'Compact' },
		{ id: 'default', label: 'Default' },
		{ id: 'spacious', label: 'Spacious' }
	];

	/** The modal only renders in the browser, so matchMedia is safe here. */
	const systemDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
</script>

{#snippet choiceRow(label: string, items: Choice[], current: string, onPick: (id: string) => void)}
	<div class="flex flex-wrap items-center gap-2">
		<span class="w-20 text-xs text-muted">{label}</span>
		<div class="flex flex-wrap gap-1">
			{#each items as item (item.id)}
				<button
					class="btn px-2 py-0.5 text-xs {current === item.id ? 'border-accent text-accent' : ''}"
					onclick={() => onPick(item.id)}
					aria-pressed={current === item.id}>{item.label}</button
				>
			{/each}
		</div>
	</div>
{/snippet}

<div class="space-y-4">
	<div class="card space-y-2 p-3">
		<h3 class="text-sm font-semibold">Theme</h3>
		<div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
			{#each THEMES as theme (theme.id)}
				<button
					class="flex items-center gap-2 rounded-card border px-2 py-1.5 text-left text-xs {app.settings
						.theme.name === theme.id
						? 'border-accent text-accent'
						: 'border-line text-muted hover:text-fg'}"
					onclick={() => app.setTheme({ name: theme.id })}
					aria-pressed={app.settings.theme.name === theme.id}
					title={theme.credit}
				>
					<span
						class="flex shrink-0 gap-0.5"
						data-theme={resolveTheme(theme.id, systemDark).variant}
						data-mode={resolveTheme(theme.id, systemDark).scheme}
						aria-hidden="true"
					>
						<span class="size-3 rounded-full border border-line bg-bg"></span>
						<span class="size-3 rounded-full border border-line bg-surface"></span>
						<span class="size-3 rounded-full border border-line bg-accent"></span>
						<span class="size-3 rounded-full border border-line bg-fg"></span>
					</span>
					<span class="min-w-0 flex-1 truncate-clip">{theme.label}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="card space-y-3 p-3">
		<h3 class="text-sm font-semibold">Type</h3>
		{@render choiceRow('Font', FONTS, app.settings.theme.font, (id) =>
			app.setTheme({ font: id as ThemeSettings['font'] }))}
		{#if app.settings.theme.font === 'custom'}
			<div class="flex flex-wrap items-center gap-2">
				<span class="w-20 text-xs text-muted">Family</span>
				<input
					class="field max-w-72 text-xs"
					aria-label="Font family"
					placeholder="Font name, for example Inter"
					value={app.settings.theme.fontFamily}
					oninput={(event) =>
						applyTheme({
							...app.settings.theme,
							fontFamily: (event.currentTarget as HTMLInputElement).value
						})}
					onchange={(event) =>
						app.setTheme({
							fontFamily: (event.currentTarget as HTMLInputElement).value
						})}
				/>
			</div>
			<p class="text-xs text-faint">
				The name has to be installed on this machine, for example DejaVu Serif.
				A list with commas is used as written.
			</p>
		{/if}
		{@render choiceRow('Text size', TEXT_SIZES, app.settings.theme.textSize, (id) =>
			app.setTheme({ textSize: id as ThemeSettings['textSize'] }))}
	</div>

	<div class="card space-y-3 p-3">
		<h3 class="text-sm font-semibold">Shape and spacing</h3>
		{@render choiceRow('Corners', RADII, app.settings.theme.radius, (id) =>
			app.setTheme({ radius: id as ThemeSettings['radius'] }))}
		{@render choiceRow('Padding', DENSITIES, app.settings.theme.density, (id) =>
			app.setTheme({ density: id as ThemeSettings['density'] }))}
	</div>

	<div class="card space-y-2 p-3">
		<h3 class="text-sm font-semibold">Preview</h3>
		<p class="text-body leading-relaxed">
			The quick brown fox jumps over the lazy dog.
			<strong class="text-accent">Bold</strong>,
			<em class="text-secondary">italic</em> and
			<code class="rounded-sm bg-raised px-1 font-mono text-[0.85em] text-accent">code</code>.
		</p>
		<div class="flex flex-wrap items-center gap-2">
			<button class="btn-accent">Primary</button>
			<button class="btn">Secondary</button>
			<input class="field max-w-32" placeholder="Input" readonly />
		</div>
	</div>
</div>
