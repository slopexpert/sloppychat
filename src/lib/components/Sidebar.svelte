<script lang="ts">
	import Icon from './Icon.svelte';
	import Logo from './Logo.svelte';
	import { app } from '$lib/client/state.svelte';
	import type { ChatHit, Conversation } from '$lib/shared/types';

	/**
	 * The chat list: a search box, the pinned chats, the folders, and the rest.
	 * A chat is dropped on a folder to file it, on another chat to make a folder
	 * with the two, and on the plain list to take it out of a folder again. Every
	 * one of those has a keyboard path as well, in the row actions.
	 */

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
	let renamingFolderId = $state<string | null>(null);
	let folderDraft = $state('');
	/** The chat being dragged, and what it is over. */
	let draggingId = $state<string | null>(null);
	let dropTarget = $state<string | null>(null);
	let searchBox: HTMLInputElement | undefined = $state();

	/** Ctrl+K opens the search from anywhere, Escape leaves it. */
	function onWindowKeydown(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			searchBox?.focus();
			searchBox?.select();
			return;
		}
		if (event.key === 'Escape' && app.searchQuery) {
			app.clearSearch();
			searchBox?.blur();
		}
	}


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

	async function submitFolderRename(id: string) {
		const name = folderDraft.trim();
		renamingFolderId = null;
		if (name) await app.renameFolder(id, name);
	}

	function isOpen(folderId: string): boolean {
		return app.openFolders[folderId] !== false;
	}

	function toggleFolder(folderId: string) {
		app.openFolders = { ...app.openFolders, [folderId]: !isOpen(folderId) };
	}

	/** A search hit opens the chat at the message that matched. */
	async function openHit(hit: ChatHit) {
		app.clearSearch();
		await app.open(hit.conversationId, hit.messageId);
	}

	function startDrag(event: DragEvent, id: string) {
		draggingId = id;
		event.dataTransfer?.setData('text/plain', id);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function allowDrop(event: DragEvent, target: string, own = false) {
		if (!draggingId) return;
		event.preventDefault();
		// A chat inside a group handles its own drag, and the group must keep out
		// of it: otherwise the whole group lights up and both drops run.
		if (own) event.stopPropagation();
		dropTarget = target;
	}

	function endDrag() {
		draggingId = null;
		dropTarget = null;
	}

	async function dropOnFolder(event: DragEvent, folderId: string | null) {
		event.preventDefault();
		const dragged = draggingId;
		endDrag();
		if (dragged) await app.moveChat(dragged, folderId);
	}

	async function dropOnChat(event: DragEvent, chat: Conversation) {
		// A chat in a folder lets the drop through to its folder.
		if (chat.folderId) return;
		event.preventDefault();
		event.stopPropagation();
		const dragged = draggingId;
		endDrag();
		if (dragged && dragged !== chat.id) await app.mergeChats(dragged, chat.id);
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet chatRow(chat: Conversation)}
	<!-- svelte-ignore a11y_no_static_element_interactions -- the row can be dropped on, and its accessible actions are the buttons inside it -->
	<div
		class="group relative flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm {chat.id === app.conversation?.id
			? 'bg-raised text-fg'
			: 'text-muted hover:bg-raised'} {dropTarget === chat.id ? 'ring-1 ring-accent' : ''}"
		draggable="true"
		ondragstart={(event) => startDrag(event, chat.id)}
		ondragend={endDrag}
		ondragover={(event) => allowDrop(event, chat.id, !chat.folderId)}
		ondragleave={() => (dropTarget = null)}
		ondrop={(event) => dropOnChat(event, chat)}
	>
		{#if renamingId === chat.id}
			<input
				class="field text-sm"
				bind:value={renameDraft}
				use:focusNow
				onkeydown={(event) => {
					if (event.key === 'Enter') submitRename(chat.id);
					if (event.key === 'Escape') renamingId = null;
				}}
				onblur={() => submitRename(chat.id)}
			/>
		{:else}
			<button
				class="min-w-0 flex-1 truncate-clip text-left"
				onclick={() => app.open(chat.id)}
				title={chat.title}
			>
				{chat.title}
			</button>
			<span class="shrink-0 text-xs text-faint group-hover:hidden group-focus-within:hidden">
				{timeAgo(chat.updatedAt)}
			</span>
			<span class="hidden shrink-0 items-center gap-1 group-hover:flex group-focus-within:flex">
				<button
					class="text-faint hover:text-accent"
					title="Rename"
					aria-label="Rename chat"
					onclick={() => {
						renamingId = chat.id;
						renameDraft = chat.title;
					}}><Icon name="pencil" size={14} /></button
				>
				<button
					class="text-faint hover:text-danger"
					title="Delete chat"
					aria-label="Delete chat"
					onclick={() => app.deleteConversation(chat.id)}><Icon name="trash" size={14} /></button
				>
			</span>
		{/if}
	</div>
{/snippet}

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
	<div class="flex items-center gap-1.5 p-3 pb-2">
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

	<div class="px-3 pb-2">
		<div class="relative">
			<input
				bind:this={searchBox}
				class="field pr-7 text-sm"
				aria-label="Search chats"
				placeholder="Search chats  (Ctrl+K)"
				value={app.searchQuery}
				oninput={(event) => app.searchChats((event.currentTarget as HTMLInputElement).value)}
			/>
			<span class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-faint">
				{#if app.searching}
					<Icon name="loader" size={13} class="animate-spin" />
				{:else}
					<Icon name="search" size={13} />
				{/if}
			</span>
		</div>
	</div>

	<nav class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
		{#if app.searchQuery.trim()}
			{#if !app.searchHits.length}
				<p class="px-2 py-3 text-xs text-faint">
					{app.searching ? 'Searching...' : 'No chat matches'}
				</p>
			{/if}
			{#each app.searchHits as hit (hit.conversationId)}
				<button
					class="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-raised"
					onclick={() => openHit(hit)}
					title={hit.title}
				>
					<span class="flex items-center gap-2 text-sm text-fg">
						<span class="min-w-0 flex-1 truncate-clip">{hit.title}</span>
						{#if hit.hits > 1}
							<span class="shrink-0 text-xs text-faint">{hit.hits}</span>
						{/if}
					</span>
					<span class="block truncate-clip text-xs text-muted">{hit.snippet}</span>
				</button>
			{/each}
		{:else}
			{#each app.folders as folder (folder.id)}
				<div
					class="mt-1 rounded-lg pb-0.5 {dropTarget === folder.id
						? 'bg-accent/10 ring-1 ring-accent'
						: ''}"
					role="group"
					aria-label={folder.name}
					ondragover={(event) => allowDrop(event, folder.id)}
					ondragleave={() => (dropTarget = null)}
					ondrop={(event) => dropOnFolder(event, folder.id)}
				>
					<div class="flex items-center gap-0.5 px-1 text-xs text-faint">
						{#if renamingFolderId === folder.id}
							<input
								class="field text-xs"
								bind:value={folderDraft}
								use:focusNow
								aria-label="Folder name"
								onkeydown={(event) => {
									if (event.key === 'Enter') submitFolderRename(folder.id);
									if (event.key === 'Escape') renamingFolderId = null;
								}}
								onblur={() => submitFolderRename(folder.id)}
							/>
						{:else}
							<button
								class="flex min-w-0 flex-1 items-center gap-1 px-1 py-1 text-left hover:text-fg"
								onclick={() => toggleFolder(folder.id)}
								aria-expanded={isOpen(folder.id)}
								title={folder.name}
							>
								<Icon name={isOpen(folder.id) ? 'chevronDown' : 'chevronRight'} size={12} />
								<span class="min-w-0 flex-1 truncate-clip">{folder.name}</span>
								<span class="shrink-0">{app.chatsIn(folder.id).length}</span>
							</button>
							<button
								class="shrink-0 p-1 hover:text-accent"
								title="Rename folder"
								aria-label="Rename folder {folder.name}"
								onclick={() => {
									renamingFolderId = folder.id;
									folderDraft = folder.name;
								}}><Icon name="pencil" size={12} /></button
							>
							<button
								class="shrink-0 p-1 hover:text-danger"
								title="Delete folder, the chats stay"
								aria-label="Delete folder {folder.name}"
								onclick={() => app.deleteFolder(folder.id)}><Icon name="trash" size={12} /></button
							>
						{/if}
					</div>
					{#if isOpen(folder.id)}
						<div class="pl-2">
							{#each app.chatsIn(folder.id) as chat (chat.id)}
								{@render chatRow(chat)}
							{/each}
						</div>
					{/if}
				</div>
			{/each}

			<div
				class="mt-1 rounded-lg pb-0.5 {dropTarget === 'loose' ? 'bg-accent/10 ring-1 ring-accent' : ''}"
				role="group"
				aria-label={app.folders.length ? 'No folder' : 'Chats'}
				ondragover={(event) => allowDrop(event, 'loose')}
				ondragleave={() => (dropTarget = null)}
				ondrop={(event) => dropOnFolder(event, null)}
			>
				<p class="flex items-center gap-1 px-2 py-1 text-xs text-faint">
					<span class="flex-1">{app.folders.length ? 'No folder' : 'Chats'}</span>
					<button
						class="p-1 hover:text-accent"
						title="New folder"
						aria-label="New folder"
						onclick={() => app.addFolder('New folder')}
					>
						<Icon name="plus" size={12} />
					</button>
				</p>
				{#each app.looseChats as chat (chat.id)}
					{@render chatRow(chat)}
				{/each}
				{#if !app.conversations.length}
					<p class="flex items-center gap-2 px-2 py-3 text-xs text-faint">
						<Icon name="messageSquare" size={14} />No chats yet
					</p>
				{/if}
			</div>
		{/if}
	</nav>

	<!-- Outside the list, so the chats never push the mark out of sight. -->
	<footer class="border-t border-line px-3 py-3 text-faint">
		<Logo size={22} />
	</footer>
</aside>
