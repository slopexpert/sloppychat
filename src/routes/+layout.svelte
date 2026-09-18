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
		// The app can be installed, so a worker keeps the shell. It never caches the
		// API, so the event stream and the turns are unaffected.
		watchWorker();
		return () => {
			stopTheme();
			stopViewport();
		};
	});

	/**
	 * Registers the service worker, and says when the shell this page runs is no
	 * longer the newest one. It stays out of the way while developing, where a
	 * cached shell would hide every change.
	 */
	function watchWorker(): void {
		if (!import.meta.env.PROD) return;
		if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
		// A new worker takes over as soon as it is installed, so the change of
		// controller is the moment to tell the reader. A page that a worker already
		// controls only changes controller when a newer worker arrives, which is what
		// keeps a first visit quiet.
		let controlled = Boolean(navigator.serviceWorker.controller);
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			// The first change is the worker taking over a page that had none, which
			// is not an update. Every change after that one is.
			if (controlled) app.toast('info', 'A new version is ready. Reload the page to use it.');
			controlled = true;
		});
		void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
			/* A worker is a convenience: the app works without one. */
		});
	}
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
