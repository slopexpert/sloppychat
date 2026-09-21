<script lang="ts">
	import { tick } from 'svelte';
	import Icon from './Icon.svelte';
	import { app } from '$lib/client/state.svelte';
	import {
		expandCommands,
		expandPromptVars,
		filterPrompts,
		firstBlank,
		promptKey,
		slashQuery,
		type PromptEntry
	} from '$lib/shared/prompts';

	/** Floating composer: the conversation scrolls behind it. */

	let text = $state('');
	let area: HTMLTextAreaElement | undefined = $state();
	let dragging = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();
	/** A live `/name` token at the caret, which opens the snippet menu. */
	let slash = $state<{ start: number; query: string; caret: number } | null>(null);
	let pick = $state(0);

	const snippets = $derived(app.prompts.filter((entry) => entry.kind === 'user'));
	const matches = $derived(slash ? filterPrompts(app.prompts, slash.query, 'user') : []);
	const open = $derived(!!slash && matches.length > 0);

	const hasContent = $derived(
		text.trim().length > 0 || app.pendingImages.length > 0 || app.pendingDocuments.length > 0
	);
	/** Sending is allowed while a turn streams: the message is queued instead. */
	const canSend = $derived(hasContent);

	// Grow with the content, up to a fixed ceiling.
	$effect(() => {
		if (!area) return;
		const target = area;
		target.style.height = 'auto';
		target.style.height = `${Math.min(target.scrollHeight, 280)}px`;
	});

	/**
	 * Sending fills the `/slug` commands in first, so Enter never has two jobs:
	 * the text that leaves is the text with every command replaced.
	 */
	function submit() {
		if (!canSend) return;
		const value = expandCommands(text, app.prompts, app.promptVars());
		text = '';
		slash = null;
		void app.send(value);
	}

	/** Reads the caret and decides whether a snippet menu belongs on screen. */
	function syncSlash() {
		if (!area || !snippets.length) {
			slash = null;
			return;
		}
		const caret = area.selectionStart ?? 0;
		const found = slashQuery(area.value, caret);
		if (!found) {
			slash = null;
			return;
		}
		if (!slash || slash.query !== found.query) pick = 0;
		slash = { ...found, caret };
	}

	/** Replaces a `/name` token with the body, blanks ready to type over. */
	async function insertPrompt(entry: PromptEntry, token: { start: number; caret: number }) {
		const body = expandPromptVars(entry.body, app.promptVars());
		if (!body.trim()) {
			// An empty prompt is a library entry nobody filled in yet.
			app.toast('error', `${entry.title} has no text yet. Add it under Settings, Prompts.`);
			return;
		}
		const next = text.slice(0, token.start) + body + text.slice(token.caret);
		const after = token.start + body.length;
		const blank = firstBlank(body);
		text = next;
		slash = null;
		await tick();
		if (!area) return;
		// The binding may need one more flush before the field holds the new text.
		if (area.value !== next) await tick();
		area.focus();
		const from = blank ? token.start + blank.start : after;
		const to = blank ? token.start + blank.end : after;
		area.setSelectionRange(from, to);
	}

	function onKeydown(event: KeyboardEvent) {
		if (open && matches.length) {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				pick = (pick + 1) % matches.length;
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				pick = (pick - 1 + matches.length) % matches.length;
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				slash = null;
				return;
			}
			// Tab takes the hightlighted entry. Enter keeps sending, and the send
			// fills the command in, so a half typed slug never eats the keystroke.
			if (event.key === 'Tab') {
				event.preventDefault();
				if (slash) void insertPrompt(matches[Math.min(pick, matches.length - 1)], slash);
				return;
			}
		}
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			submit();
		}
	}

	function pickFiles(files: FileList | null | undefined) {
		if (!files?.length) return;
		void app.attach([...files]);
	}

	function onPaste(event: ClipboardEvent) {
		const files = [...(event.clipboardData?.items ?? [])]
			.filter((item) => item.kind === 'file')
			.map((item) => item.getAsFile())
			.filter((file): file is File => !!file);
		if (files.length) {
			event.preventDefault();
			pickFiles(files as unknown as FileList);
		}
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		pickFiles(event.dataTransfer?.files);
	}
</script>

<div class="composer-scrim pointer-events-none absolute inset-x-0 bottom-0 z-10 h-28"></div>

<div class="pointer-events-none absolute inset-x-0 bottom-0 z-20">
	<div class="pointer-events-auto mx-auto w-full max-w-3xl px-3 pb-3">
		{#if app.queued.length}
			<div class="mb-2 space-y-1">
				{#each app.queued as item (item.id)}
					<div
						class="flex items-center gap-2 rounded-card border border-line bg-surface/95 px-2 py-1 text-xs shadow-sm backdrop-blur"
					>
						<Icon name="clock" size={13} class="text-faint" />
						<span class="text-faint">queued</span>
						<span class="min-w-0 flex-1 truncate-clip text-muted" title={item.text}>
							{item.text || 'attachment only'}
						</span>
						<button
							class="icon-btn-ghost hover:text-danger"
							onclick={() => app.removeQueued(item.id)}
							title="Remove from the queue"
							aria-label="Remove from the queue"
						>
							<Icon name="x" size={13} />
						</button>
					</div>
				{/each}
			</div>
		{/if}

		{#if app.pendingImages.length || app.pendingDocuments.length || app.uploading}
			<div class="mb-2 flex flex-wrap gap-2">
				{#each app.pendingDocuments as item (item.document.id)}
					<div class="flex items-center gap-2 rounded-card border border-line bg-surface/95 px-2 py-1.5 shadow-sm backdrop-blur">
						{#if item.images[0]}
							<img
								src="/api/images/{item.images[0].id}"
								alt="first page"
								class="h-12 w-9 rounded-sm border border-line object-cover"
							/>
						{:else}
							<span class="flex h-12 w-9 items-center justify-center rounded-sm border border-line text-[0.6rem] text-faint">PDF</span>
						{/if}
						<div class="text-xs">
							<div class="max-w-40 truncate-clip font-medium" title={item.document.name}>{item.document.name}</div>
							<div class="text-faint">
								{item.document.pages} pages, {Math.round(item.document.chars / 100) / 10}k chars
								{#if item.sendImages && item.images.length}
									, {item.images.length} page images
								{:else}
									, text only
								{/if}
							</div>
						</div>
						<button
							class="icon-btn-ghost hover:text-danger"
							onclick={() => app.removePendingDocument(item.document.id)}
							title="Remove document"
							aria-label="Remove document"
						>
							<Icon name="x" size={14} />
						</button>
					</div>
				{/each}
				{#each app.pendingImages as image (image.id)}
					<div class="relative">
						<img
							src="/api/images/{image.id}"
							alt={image.name ?? 'pending'}
							class="size-16 rounded-card border border-line object-cover"
						/>
						<button
							class="absolute -top-1.5 -right-1.5 rounded-full border border-line bg-surface p-0.5 text-muted hover:text-danger"
							onclick={() => app.removePendingImage(image.id)}
							title="Remove image"
							aria-label="Remove image"
						>
							<Icon name="x" size={12} />
						</button>
					</div>
				{/each}
				{#if app.uploading}
					<div class="flex size-16 items-center justify-center rounded-card border border-dashed border-line text-faint">
						<Icon name="loader" spin />
					</div>
				{/if}
			</div>
		{/if}

		{#if open}
			<ul
				class="mb-1 max-h-60 overflow-y-auto rounded-card border border-line bg-surface/95 py-1 shadow-lg backdrop-blur"
				role="listbox"
				aria-label="Prompts"
			>
				{#each matches as entry, index (entry.id)}
					<li
						id={`snippet-${index}`}
						role="option"
						aria-selected={index === pick}
						class="flex cursor-pointer items-baseline gap-2 px-2 py-1 text-xs {index === pick
							? 'bg-accent/10 text-fg'
							: 'text-muted'}"
						onmousedown={(event) => {
							// Keep the caret in the message box while the click lands.
							event.preventDefault();
							if (slash) void insertPrompt(entry, slash);
						}}
						onmouseenter={() => (pick = index)}
					>
						<span class="shrink-0 font-mono {index === pick ? 'text-accent' : 'text-faint'}">
							/{promptKey(entry.title)}
						</span>
						{#if entry.description}
							<span class="min-w-0 flex-1 truncate-clip text-faint">{entry.description}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<div
			class="card bg-surface/95 p-2 shadow-lg backdrop-blur transition-colors {dragging
				? 'border-accent'
				: ''}"
			role="presentation"
			ondragover={(event) => {
				event.preventDefault();
				dragging = true;
			}}
			ondragleave={() => (dragging = false)}
			ondrop={onDrop}
		>
			<div class="flex items-end gap-2">
				<button
					class="icon-btn shrink-0 p-2"
					onclick={() => fileInput?.click()}
					title="Attach images or a PDF"
					aria-label="Attach images or a PDF"
				>
					<Icon name="paperclip" size={18} />
				</button>
				<input
					bind:this={fileInput}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif,image/avif,application/pdf"
					multiple
					class="hidden"
					onchange={(event) => {
						pickFiles((event.currentTarget as HTMLInputElement).files);
						(event.currentTarget as HTMLInputElement).value = '';
					}}
				/>
				<!-- svelte-ignore a11y_autofocus -- the message box is the primary action of the app -->
				<textarea
					id="composer"
					bind:this={area}
					bind:value={text}
					onkeydown={onKeydown}
					oninput={syncSlash}
					onclick={syncSlash}
					onkeyup={(event) => {
						if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) syncSlash();
					}}
					onpaste={onPaste}
					rows="1"
					autofocus
					aria-label="Message"
					aria-autocomplete="list"
					aria-activedescendant={open ? `snippet-${pick}` : undefined}
					placeholder={app.provider ? 'Send a message' : 'Add a provider in Settings first'}
					title={snippets.length
						? 'Enter sends and fills /prompts in, Shift+Enter adds a line, Tab takes the menu'
						: 'Enter sends, Shift+Enter adds a line'}
					class="max-h-70 flex-1 resize-none bg-transparent py-2 text-body leading-relaxed text-fg placeholder:text-faint"
				></textarea>

				{#if canSend}
					<button
						class="btn-accent shrink-0 p-2"
						onclick={submit}
						title={app.running ? 'Send after the current answer' : 'Send the message'}
						aria-label={app.running ? 'Send after the current answer' : 'Send the message'}
					>
						<Icon name="send" size={18} />
					</button>
				{/if}
				{#if app.running}
					<button
						class="icon-btn shrink-0 p-2"
						onclick={() => app.stop()}
						title="Stop generating"
						aria-label="Stop generating"
					>
						<Icon name="stop" size={18} />
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
