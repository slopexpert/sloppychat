<script lang="ts">
	import Icon from './Icon.svelte';
	import ToolList from './ToolList.svelte';
	import { app } from '$lib/client/state.svelte';
	import { TOOL_CATALOG, toolMode } from '$lib/shared/tools';

	/**
	 * The tools menu in the top bar. The button shows how many tools the model can
	 * use, and the popover holds the same list as Settings, Tools.
	 */

	let open = $state(false);
	let box: HTMLDivElement | undefined = $state();
	let trigger: HTMLButtonElement | undefined = $state();

	const active = $derived(
		TOOL_CATALOG.filter((spec) => toolMode(spec, app.settings.tools.modes) !== 'off').length
	);

	/** Escape closes the menu and hands the focus back to the button. */
	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !open) return;
		open = false;
		trigger?.focus();
	}

	function onWindowClick(event: MouseEvent) {
		if (!open || !box) return;
		if (!box.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

<div class="relative" bind:this={box}>
	<button
		bind:this={trigger}
		class="icon-btn {active ? 'icon-btn-on' : ''}"
		title={active ? `${active} tools are active` : 'No tool is active'}
		aria-label="Tools"
		aria-haspopup="dialog"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<Icon name="wrench" size={18} />
		{#if active}
			<span class="badge">{active}</span>
		{/if}
	</button>

	{#if open}
		<div class="card absolute top-full right-0 z-30 mt-1.5 w-72 p-3 shadow-2xl" role="dialog" aria-label="Tools">
			<ToolList />
		</div>
	{/if}
</div>
