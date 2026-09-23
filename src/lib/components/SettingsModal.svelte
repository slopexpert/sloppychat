<script lang="ts">
	import { onDestroy } from 'svelte';
	import Icon from './Icon.svelte';
	import SettingsProviders from './settings/SettingsProviders.svelte';
	import SettingsTools from './settings/SettingsTools.svelte';
	import SettingsMcp from './settings/SettingsMcp.svelte';
	import SettingsSkills from './settings/SettingsSkills.svelte';
	import SettingsPrompts from './settings/SettingsPrompts.svelte';
	import SettingsGeneration from './settings/SettingsGeneration.svelte';
	import SettingsAppearance from './settings/SettingsAppearance.svelte';
	import { flush } from '$lib/client/settings-draft';

	/**
	 * The shell only: the header, the tab row and the focus trap. Each tab is its own
	 * component under `settings/`, and the settings that wait on a short delay go
	 * through one shared draft, so closing the panel cannot drop an edit.
	 */
	let {
		open = $bindable(false),
		onclose
	}: { open?: boolean; onclose?: () => void } = $props();

	let tab = $state<'providers' | 'tools' | 'skills' | 'prompts' | 'generation' | 'appearance' | 'mcp'>('providers');
	let panel: HTMLDivElement | undefined = $state();

	const TABS = [
		['providers', 'Providers', 'key'],
		['tools', 'Tools', 'wrench'],
		['mcp', 'MCP', 'globe'],
		['skills', 'Skills', 'book'],
		['prompts', 'Prompts', 'fileText'],
		['generation', 'Generation', 'sliders'],
		['appearance', 'Appearance', 'sparkles']
	] as const;

	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	// Move focus into the dialog and keep Tab inside it while it is open.
	$effect(() => {
		if (!open || !panel) return;
		panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();
	});

	function onDialogKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			close();
			return;
		}
		if (event.key !== 'Tab' || !panel) return;
		const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
			(item) => item.offsetParent !== null
		);
		if (!items.length) return;
		const first = items[0];
		const last = items[items.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function close() {
		flush();
		open = false;
		onclose?.();
	}

	// A close the browser makes, not the Close button, still flushes.
	onDestroy(flush);
</script>

{#if open}
	<div
		class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) close();
		}}
		onkeydown={onDialogKeydown}
	>
		<div
			class="card w-full max-w-3xl shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-label="Settings"
			bind:this={panel}
		>
			<header class="flex items-center gap-2 border-b border-line px-4 py-3">
				<h2 class="flex-1 font-semibold">Settings</h2>
				<button class="icon-btn" onclick={close} title="Close settings" aria-label="Close settings">
					<Icon name="x" />
				</button>
			</header>

			<div class="flex flex-wrap gap-1 border-b border-line px-4 py-2 text-sm">
				{#each TABS as [key, label, icon] (key)}
					<button
						class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 {tab === key
							? 'bg-raised text-fg'
							: 'text-muted hover:text-fg'}"
						onclick={() => (tab = key)}
						aria-current={tab === key}
					>
						<Icon name={icon} size={14} />
						{label}
					</button>
				{/each}
			</div>

			<div class="max-h-[70vh] overflow-y-auto p-4">
				{#if tab === 'providers'}
					<SettingsProviders />
				{:else if tab === 'tools'}
					<SettingsTools />
				{:else if tab === 'skills'}
					<SettingsSkills />
				{:else if tab === 'prompts'}
					<SettingsPrompts />
				{:else if tab === 'generation'}
					<SettingsGeneration />
				{:else if tab === 'mcp'}
					<SettingsMcp />
				{:else}
					<SettingsAppearance />
				{/if}
			</div>
		</div>
	</div>
{/if}
