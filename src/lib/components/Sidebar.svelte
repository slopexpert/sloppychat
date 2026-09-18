<script lang="ts">
	import Icon from './Icon.svelte';
	import Logo from './Logo.svelte';
	import { app } from '$lib/client/state.svelte';

	/** Focuses the rename box as soon as it appears. */
	function focusNow(node: HTMLElement) {
		node.focus();
	}

	/** A drawer opens with focus on its first control, not behind it. */
	function focusWhenNarrow(node: HTMLElement) {
		if (app.narrow) requestAnimationFrame(() => node.focus());
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && app.narrow) app.closeSidebar();
	}

	let renamingId = $state<string | null>(null);
	let renameDraft = $state('');

	function timeAgo(iso: string): string {
		const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
		if (seconds < 60) return 'now';
		const minutes = Math.round(seconds / 60);
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `${hours}h`;
		const days = Math.round(hours / 24);
		if (days < 30) return `${days}d`;
		return new Date(iso).toLocaleDateString();
	}

	async function submitRename(id: string) {
		const title = renameDraft.trim();
		renamingId = null;
		if (title) await app.renameConversation(title);
	}

</script>

{#if app.narrow}
	<!-- The chat stays visible behind the drawer, and the backdrop closes it. -->
	<button
		class="fixed inset-0 z-20 bg-black/40"
		aria-label="Close the chat list"
		title="Close the chat list"
		onclick={() => app.closeSidebar()}
	></button>
{/if}

<aside
	class="order-first flex h-full w-64 shrink-0 flex-col border-r border-line bg-surface {app.narrow
		? 'fixed inset-y-0 left-0 z-30 shadow-2xl'
		: ''}"
	role={app.narrow ? 'dialog' : undefined}
	aria-modal={app.narrow ? 'true' : undefined}
	aria-label={app.narrow ? 'Chats' : undefined}
	onkeydown={onKeydown}
>
	<div class="flex items-center gap-1.5 p-3">
		<button
			class="btn-accent shrink-0 p-2"
			title="New chat"
			aria-label="New chat"
			use:focusWhenNarrow
			onclick={() => app.newConversation()}
		>
			<Icon name="plus" size={18} />
		</button>
		<button
			class="icon-btn p-2"
			title="Settings"
			aria-label="Settings"
			onclick={() => (app.showSettings = true)}
		>
			<Icon name="settings" size={18} />
		</button>
		{#if app.narrow}
			<button
				class="icon-btn ml-auto p-2"
				title="Close the chat list"
				aria-label="Close the chat list"
				onclick={() => app.closeSidebar()}
			>
				<Icon name="x" size={18} />
			</button>
		{/if}
	</div>

	<nav class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
		{#each app.conversations as conversation (conversation.id)}
			<div
				class="group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm {conversation.id ===
				app.conversation?.id
					? 'bg-raised text-fg'
					: 'text-muted hover:bg-raised'}"
			>
				{#if renamingId === conversation.id}
					<input
						class="field text-sm"
						bind:value={renameDraft}
						use:focusNow
						onkeydown={(event) => {
							if (event.key === 'Enter') submitRename(conversation.id);
							if (event.key === 'Escape') renamingId = null;
						}}
						onblur={() => submitRename(conversation.id)}
					/>
				{:else}
					<button
						class="min-w-0 flex-1 truncate-clip text-left"
						onclick={() => app.open(conversation.id)}
						title={conversation.title}
					>
						{conversation.title}
					</button>
					<span class="shrink-0 text-xs text-faint group-hover:hidden">{timeAgo(conversation.updatedAt)}</span>
					<span class="hidden shrink-0 gap-1 group-hover:flex">
						<button
							class="text-faint hover:text-accent"
							title="Rename"
							aria-label="Rename chat"
							onclick={() => {
								renamingId = conversation.id;
								renameDraft = conversation.title;
							}}><Icon name="pencil" size={14} /></button
						>
						<button
							class="text-faint hover:text-danger"
							title="Delete chat"
							aria-label="Delete chat"
							onclick={() => app.deleteConversation(conversation.id)}><Icon name="trash" size={14} /></button
						>
					</span>
				{/if}
			</div>
		{/each}
		{#if !app.conversations.length}
			<p class="flex items-center gap-2 px-2 py-3 text-xs text-faint">
				<Icon name="messageSquare" size={14} />No chats yet
			</p>
		{/if}
	</nav>

	<!-- Outside the list, so the chats never push the mark out of sight. -->
	<footer class="border-t border-line px-3 py-3 text-faint">
		<Logo size={22} />
	</footer>
</aside>
