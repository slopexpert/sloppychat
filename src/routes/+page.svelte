<script lang="ts">
	import ChatView from '$lib/components/ChatView.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ParamsPanel from '$lib/components/ParamsPanel.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import { app } from '$lib/client/state.svelte';

	/**
	 * A file can be dropped anywhere in the window, not only on the composer. The
	 * flag is kept alive by the dragover stream and dies 180 ms after it stops,
	 * which is simpler than counting enter and leave on every child element.
	 */
	let dropping = $state(false);
	let dragTimer: ReturnType<typeof setTimeout> | undefined;

	/** Only a real file drag belongs here, so a text or a chat drag passes through. */
	function isFileDrag(event: DragEvent): boolean {
		return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
	}

	function onDragOver(event: DragEvent) {
		if (!isFileDrag(event)) return;
		// Without this the browser opens the file instead of handing it over.
		event.preventDefault();
		dropping = true;
		clearTimeout(dragTimer);
		dragTimer = setTimeout(() => (dropping = false), 180);
	}

	function onDrop(event: DragEvent) {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		clearTimeout(dragTimer);
		dropping = false;
		const files = [...(event.dataTransfer?.files ?? [])];
		if (files.length) void app.attach(files);
	}

	function onDragEnd() {
		clearTimeout(dragTimer);
		dropping = false;
	}
</script>

<svelte:window ondragover={onDragOver} ondrop={onDrop} ondragend={onDragEnd} />

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

		{#if dropping}
			<!-- pointer-events stay off so the drop still lands on the window. -->
			<div
				class="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-card border-2 border-dashed border-accent bg-surface/70 backdrop-blur-sm"
				role="status"
			>
				<span class="flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2 text-sm text-fg shadow-lg">
					<Icon name="paperclip" size={16} class="text-accent" />
					Drop files to attach
				</span>
			</div>
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
