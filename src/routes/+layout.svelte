<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import { app } from '$lib/client/state.svelte';
	import { pageTitle } from '$lib/shared/title';

	let { children } = $props();

	const title = $derived(pageTitle(app.conversation?.title));

	onMount(() => {
		void app.init();
		// Drop the inline boot placeholder now that the app has rendered.
		document.getElementById('boot')?.remove();
		// Keep dark mode in step with the system setting.
		const stopTheme = app.watchSystemTheme();
		// Keep the chat list a column or a drawer, whichever fits.
		const stopViewport = app.watchViewport();
		return () => {
			stopTheme();
			stopViewport();
		};
	});
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<div class="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
	<a href="#composer" class="skip-link">
		Skip to the message box
	</a>
	{@render children()}
	<Toasts />
</div>
