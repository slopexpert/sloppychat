<script lang="ts">
	import Markdown from './Markdown.svelte';
	import ToolCallCard from './ToolCallCard.svelte';
	import Icon from './Icon.svelte';
	import { api } from '$lib/client/api';
	import { app } from '$lib/client/state.svelte';
	import type { ToolProgress } from '$lib/client/tools';
	import { formatBriefStats, formatUsageLine, usageTooltip } from '$lib/shared/stats';
	import type { Message } from '$lib/shared/types';

	let {
		message,
		toolResults,
		toolProgress,
		streaming = false,
		last = false,
		/** Tokens per second while the answer streams. */
		streamRate,
		/** Estimated prompt speed while this message's answer is being prepared. */
		prefillRate,
		/** The prefill figure once the turn has reported it, kept after the fact. */
		prefillStats,
		/** True while the model is still reading the prompt. */
		prefilling = false,
		onRetry,
		onEdit,
		onDelete,
		onBranch,
		onContinue,
		highlighted = false
	}: {
		message: Message;
		toolResults: Record<string, { text: string; isError: boolean }>;
		toolProgress: Record<string, ToolProgress>;
		streaming?: boolean;
		last?: boolean;
		streamRate?: number;
		prefillRate?: number;
		prefillStats?: string;
		prefilling?: boolean;
		onRetry?: () => void;
		onEdit?: (text: string) => void;
		onDelete?: () => void;
		/** Shows another version of this message, when it has brothers. */
		onBranch?: (messageId: string) => void;
		/** Carries an answer on when it stopped at the length limit. */
		onContinue?: (messageId: string) => void;
		/** True while this message is the one a search hit asked for. */
		highlighted?: boolean;
	} = $props();

	let editing = $state(false);
	let draft = $state('');
	let copied = $state(false);
	/**
	 * Attachment content by id: no key means closed, null means the text is on its
	 * way in, an object is what to show.
	 */
	let docView = $state<Record<string, { text: string; truncated: boolean } | null>>({});
	/** null follows the stream, a boolean is the user's own choice. */
	let reasoningChoice = $state<boolean | null>(null);

	/** True while the model is still producing reasoning and no answer yet. */
	const reasoningLive = $derived(streaming && !message.text && !!message.reasoning);
	/** Open while thinking, then collapse once the answer starts. */
	const reasoningOpen = $derived(reasoningChoice ?? reasoningLive);
	let reasoningBox: HTMLDivElement | undefined = $state();

	// Keep the newest thought in view while the model is still producing them.
	$effect(() => {
		if (!reasoningLive || !reasoningBox) return;
		void message.reasoning?.length;
		const box = reasoningBox;
		requestAnimationFrame(() => box.scrollTo({ top: box.scrollHeight }));
	});

	function startEdit() {
		draft = message.text;
		editing = true;
	}

	function submitEdit() {
		editing = false;
		if (draft.trim() && draft !== message.text) onEdit?.(draft.trim());
	}

	async function copy() {
		await navigator.clipboard.writeText(message.text);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	/** Opens an attachment, reading the stored text the first time only. */
	async function toggleDoc(id: string) {
		if (docView[id] !== undefined) {
			const next = { ...docView };
			delete next[id];
			docView = next;
			return;
		}
		docView = { ...docView, [id]: null };
		try {
			const { document } = await api.readDocument(id);
			docView = { ...docView, [id]: { text: document.text, truncated: document.truncated } };
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
			const next = { ...docView };
			delete next[id];
			docView = next;
		}
	}

	async function copyText(value: string) {
		await navigator.clipboard.writeText(value);
		app.toast('ok', 'Copied');
	}

	/** The versions of this message: the messages that share its parent. */
	const brothers = $derived(message.brothers ?? [message.id]);
	const branchIndex = $derived(Math.max(0, brothers.indexOf(message.id)));

	const stats = $derived(formatUsageLine(message.usage));
	const brief = $derived(formatBriefStats(message.usage));
	const statsHint = $derived(usageTooltip(message.usage));
</script>

{#snippet branchControl()}
	{#if brothers.length > 1}
		<span class="flex shrink-0 items-center gap-0.5 text-xs text-faint">
			<button
				class="px-0.5 hover:text-accent disabled:opacity-30"
				disabled={branchIndex === 0}
				onclick={() => onBranch?.(brothers[branchIndex - 1])}
				title="Previous version"
				aria-label="Previous version"
			>
				<Icon name="chevronLeft" size={13} />
			</button>
			<span title="Version {branchIndex + 1} of {brothers.length}">
				{branchIndex + 1}/{brothers.length}
			</span>
			<button
				class="px-0.5 hover:text-accent disabled:opacity-30"
				disabled={branchIndex === brothers.length - 1}
				onclick={() => onBranch?.(brothers[branchIndex + 1])}
				title="Next version"
				aria-label="Next version"
			>
				<Icon name="chevronRight" size={13} />
			</button>
		</span>
	{/if}
{/snippet}

{#if message.role === 'user'}
	<div
		id="message-{message.id}"
		class="group flex justify-end {highlighted ? 'rounded-card ring-2 ring-accent/40' : ''}"
	>
		<div class="max-w-[85%] space-y-2">
			{#if message.documents?.length}
				<div class="space-y-1.5">
					{#each message.documents as doc (doc.id)}
						{@const view = docView[doc.id]}
						<div class="flex flex-col items-end gap-1">
							<div class="flex items-center gap-2 rounded-card border border-line bg-raised px-2.5 py-1.5 text-xs">
								<Icon name="fileText" size={14} class="text-faint" />
								<span class="max-w-56 truncate-clip" title={doc.name}>{doc.name}</span>
								<span class="text-faint">
									{#if doc.pages > 0}
										{doc.pages} pages, {Math.round(doc.chars / 100) / 10}k chars
									{:else}
										{doc.lines ?? 0} lines, {Math.round(doc.chars / 100) / 10}k chars
									{/if}
								</span>
								<button
									class="icon-btn-ghost"
									onclick={() => toggleDoc(doc.id)}
									aria-expanded={view !== undefined}
									title={view === undefined ? 'Show what was sent' : 'Hide the text'}
									aria-label={view === undefined
										? `Show what was sent from ${doc.name}`
										: `Hide the text of ${doc.name}`}
								>
									<Icon name={view === undefined ? 'chevronDown' : 'chevronLeft'} size={13} />
								</button>
							</div>
							{#if view !== undefined}
								<div class="w-full space-y-1.5 rounded-card border border-line bg-raised p-2">
									{#if view === null}
										<p class="text-xs text-faint" role="status">Reading...</p>
									{:else}
										<pre
											class="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[0.7rem] leading-relaxed text-muted">{view.text}{view.truncated
												? '\n[cut for the screen, the whole text was sent]'
												: ''}</pre>
										<div class="flex justify-end">
											<button class="btn px-2 py-0.5 text-xs" onclick={() => copyText(view.text)}>
												<Icon name="copy" size={12} />
												Copy
											</button>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
			{#if message.images.length}
				<div class="flex flex-wrap justify-end gap-2">
					{#each message.images as image (image.id)}
						<img
							src="/api/images/{image.id}"
							alt={image.name ?? 'attachment'}
							class="max-h-64 rounded-card border border-line object-contain"
						/>
					{/each}
				</div>
			{/if}
			{#if editing}
				<div class="card p-2">
					<textarea class="field min-h-24 font-sans" bind:value={draft}></textarea>
					<div class="mt-2 flex justify-end gap-2">
						<button class="btn" onclick={() => (editing = false)}>Cancel</button>
						<button class="btn-accent" onclick={submitEdit}>Send again</button>
					</div>
				</div>
			{:else}
				<!-- w-fit keeps the bubble as wide as its text: the statistics line below
				     must not stretch it. -->
				<div class="ml-auto w-fit rounded-card bg-accent px-3.5 py-2.5 text-accent-fg">
					<div class="whitespace-pre-wrap break-words text-body leading-relaxed">{message.text}</div>
				</div>
				{#if prefilling || prefillStats}
					<!-- Reading the prompt happens before any answer exists, so the wait is
					     shown here, on the message that asked for it. It stays afterwards,
					     telling how long that prompt actually took. -->
					<div
						class="flex flex-wrap items-center justify-end gap-2 text-xs text-faint"
						role={prefilling ? 'status' : undefined}
					>
						<!-- The version control stays in view; the rest appears on hover. -->
						{@render branchControl()}
						<!-- The actions come first so the speed indicator ends flush with the
						     right edge, even while the buttons are invisible. -->
						<span class="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
							<button
								class="icon-btn-ghost"
								onclick={startEdit}
								title="Edit and send again"
								aria-label="Edit and send again"
							>
								<Icon name="pencil" size={14} />
							</button>
							<button
								class="icon-btn-ghost hover:text-danger"
								onclick={() => onDelete?.()}
								title="Delete this message and the rest"
								aria-label="Delete this message and the rest"
							>
								<Icon name="trash" size={14} />
							</button>
						</span>
						<!-- The gauge icon stands in for the word "prefill", the same way the
						     generation rate is shown under an answer. -->
						<span class="flex items-center gap-1.5" title="prompt processing">
							<Icon name="gauge" size={13} />
							<span>
								{#if prefilling}
									{prefillRate !== undefined
										? `${prefillRate.toFixed(0)} tok/s`
										: 'reading the prompt...'}
								{:else}
									{prefillStats}
								{/if}
							</span>
						</span>
					</div>
				{:else}
					<div class="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
						<button
							class="icon-btn-ghost"
							onclick={startEdit}
							title="Edit and send again"
							aria-label="Edit and send again"
						>
							<Icon name="pencil" size={14} />
						</button>
						<button
							class="icon-btn-ghost hover:text-danger"
							onclick={() => onDelete?.()}
							title="Delete this message and the rest"
							aria-label="Delete this message and the rest"
						>
							<Icon name="trash" size={14} />
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
{:else if message.role === 'assistant'}
	<div
		id="message-{message.id}"
		class="group space-y-2 {highlighted ? 'rounded-card ring-2 ring-accent/40' : ''}"
	>
		{#if message.reasoning}
			<div>
				<button
					class="flex items-center gap-1.5 text-xs {reasoningLive
						? 'text-accent'
						: 'text-faint hover:text-accent'}"
					onclick={() => (reasoningChoice = !reasoningOpen)}
					aria-expanded={reasoningOpen}
					title={reasoningOpen ? 'Hide the reasoning' : 'Show the reasoning'}
				>
					<Icon name={reasoningOpen ? 'chevronDown' : 'chevronRight'} size={13} />
					{reasoningLive ? 'thinking...' : 'thinking'}
				</button>
				{#if reasoningOpen}
					<div
						bind:this={reasoningBox}
						class="mt-1 max-h-72 overflow-y-auto border-l-2 border-line pl-3 text-xs whitespace-pre-wrap text-muted {reasoningLive
							? 'border-accent/50'
							: ''}"
					>{message.reasoning}</div>
				{/if}
			</div>
		{/if}

		{#if message.text}
			<Markdown text={message.text} />
		{/if}

		<!-- Statistics, the version control and the hover actions share one line. -->
		<div class="flex flex-wrap items-center gap-2 text-xs text-faint">
			{@render branchControl()}
			{#if streaming && (message.text || message.reasoning) && streamRate !== undefined}
				<span class="flex items-center gap-1.5" role="status">
					<Icon name="gauge" size={13} />
					<span>about {streamRate.toFixed(1)} tok/s</span>
				</span>
			{:else if !streaming && brief}
				<!-- Visible without hovering; the full breakdown is in the tooltip. -->
				<span class="flex items-center gap-1.5" title={statsHint}>
					<Icon name="gauge" size={13} />
					<span>{brief}</span>
				</span>
			{/if}

			<span class="flex flex-1 items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
				{#if message.text}
					<button
						class="icon-btn-ghost"
						onclick={copy}
						title={copied ? 'Copied' : 'Copy the answer'}
						aria-label={copied ? 'Copied' : 'Copy the answer'}
					>
						<Icon name={copied ? 'check' : 'copy'} size={14} />
					</button>
				{/if}
				{#if last && message.text}
					<button
						class="icon-btn-ghost"
						onclick={() => onRetry?.()}
						title="Regenerate the answer"
						aria-label="Regenerate the answer"
					>
						<Icon name="refresh" size={14} />
					</button>
				{/if}
				{#if message.finishReason === 'length' && message.text}
					<!-- The answer hit the limit, so it can be carried on. -->
					<button
						class="icon-btn-ghost"
						onclick={() => onContinue?.(message.id)}
						title="Continue this answer, which hit the length limit"
						aria-label="Continue this answer"
					>
						<Icon name="chevronsRight" size={14} />
					</button>
				{/if}
				<button
					class="icon-btn-ghost hover:text-danger"
					onclick={() => onDelete?.()}
					title="Delete this message and the rest"
					aria-label="Delete this message and the rest"
				>
					<Icon name="trash" size={14} />
				</button>
				{#if message.model}
					<span>{message.model}</span>
				{/if}
			</span>
		</div>

		{#if message.toolCalls?.length}
			<div class="space-y-1.5">
				{#each message.toolCalls as call (call.id)}
					<ToolCallCard {call} progress={toolProgress[call.id]} result={toolResults[call.id]} />
				{/each}
			</div>
		{/if}
	</div>
{/if}
