<script lang="ts">
	import ChatView from '$lib/components/ChatView.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ParamsPanel from '$lib/components/ParamsPanel.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import { app } from '$lib/client/state.svelte';
</script>

<div class="flex min-h-0 flex-1" inert={app.showSettings || undefined}>
	<!-- The conversation comes first in the document, with the chat list placed on
	     the left by flex order. Keyboard scrolling (Tridactyl j/k, and the same
	     search the browser does) scrolls the first scrollable element in document
	     order, so this keeps it on the conversation, not the chat list. -->
	<main class="relative flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Chat">
		<!-- One bar holds the chat title and every app control. -->
		<TopBar />

		{#if !app.ready}
			<div class="flex flex-1 items-center justify-center gap-2 text-sm text-muted" role="status">
				<Icon name="loader" class="animate-spin" />
				Loading...
			</div>
		{:else}
			<ChatView />
		{/if}
		<!-- Always rendered: the composer is the first text field for keyboard access. -->
		<Composer />
	</main>

	{#if app.sidebarOpen}
		<Sidebar />
	{/if}

	{#if app.showParams}
		<ParamsPanel />
	{/if}

</div>

<SettingsModal bind:open={app.showSettings} />
