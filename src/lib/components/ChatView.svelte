<script lang="ts">
	import MessageItem from './MessageItem.svelte';
	import Icon from './Icon.svelte';
	import { app } from '$lib/client/state.svelte';
	import { isApproveKey } from '$lib/client/tools';
	import { quoteBlock } from '$lib/shared/markdown';
	import { quoteSpot } from '$lib/shared/selection';
	import { formatPrefillStats } from '$lib/shared/stats';
	import type { Message } from '$lib/shared/types';

	let list: HTMLDivElement | undefined = $state();
	let pinned = $state(true);

	const visible = $derived(
		app.messages.filter((message: Message) => message.role === 'user' || message.role === 'assistant')
	);

	/** Results live in their own rows; the cards look them up by call id. */
	const toolResults = $derived.by(() => {
		const map: Record<string, { text: string; isError: boolean }> = {};
		for (const message of app.messages) {
			if (message.role === 'tool' && message.toolCallId) {
				map[message.toolCallId] = { text: message.text, isError: message.isError === true };
			}
		}
		return map;
	});

	const lastAssistantId = $derived(
		[...visible].reverse().find((message) => message.role === 'assistant')?.id
	);

	/** The tool request that waits for the user, when a card asks for an answer. */
	const waiting = $derived(
		app.messages
			.flatMap((message) => message.toolCalls ?? [])
			.find((call) => app.toolProgress[call.id]?.state === 'ask')
	);

	/**
	 * Text the reader selected inside the conversation, with the spot for the chip
	 * that quotes it. Nothing is offered for a selection elsewhere, such as the
	 * chat list, because that text is not part of an answer.
	 */
	let selection = $state<{ text: string; x: number; y: number } | null>(null);

	/** Where the selection sits, in viewport coords, above it when there is room. */
	function selectedInChat(): { text: string; x: number; y: number } | null {
		const value = window.getSelection?.();
		const text = value?.toString() ?? '';
		if (!value || !text.trim() || !value.rangeCount) return null;
		const node = value.anchorNode;
		const element = node instanceof Element ? node : node?.parentElement;
		if (!element?.closest('[id^="message-"]')) return null;
		const rect = value.getRangeAt(0).getBoundingClientRect();
		return { text, ...quoteSpot(rect, window.innerWidth) };
	}

	/** Quotes the selection into the message box, then lets go of it. */
	function quoteSelection() {
		if (!selection) return;
		app.quoteIntoComposer(quoteBlock(selection.text));
		selection = null;
		window.getSelection()?.removeAllRanges();
	}

	/** Enter allows the waiting tool once, so the keyboard alone can go on. */
	function onKeydown(event: KeyboardEvent) {
		if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'q') {
			if (!selection) {
				app.toast('info', 'Select text in the chat first');
				return;
			}
			event.preventDefault();
			quoteSelection();
			return;
		}
		if (!waiting || !isApproveKey(event)) return;
		event.preventDefault();
		void app.approve(waiting, 'allow');
	}
	/** The prefill belongs to the message that started the turn in flight. */
	const lastUserId = $derived([...visible].reverse().find((message) => message.role === 'user')?.id);

	/**
	 * What the prompt cost, kept under the user message that asked for it. The
	 * figure comes from the answer's usage, so it survives a reload and is exact
	 * rather than the estimate shown while the prompt is still being read.
	 */
	const prefillStats = $derived.by(() => {
		const map: Record<string, string> = {};
		visible.forEach((message, index) => {
			if (message.role !== 'user') return;
			for (let at = index + 1; at < visible.length; at++) {
				const next = visible[at];
				if (next.role === 'user') break;
				if (next.role === 'assistant' && next.usage) {
					map[message.id] = formatPrefillStats(next.usage);
					break;
				}
			}
		});
		return map;
	});

	function onScroll() {
		if (!list) return;
		pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 140;
		// The chip is placed in viewport coordinates, so a scroll leaves it behind.
		if (selection) selection = null;
	}

	// The chip tracks the selection while it lives inside the conversation.
	$effect(() => {
		const sync = () => (selection = selectedInChat());
		document.addEventListener('selectionchange', sync);
		return () => document.removeEventListener('selectionchange', sync);
	});

	// Another chat has nothing selected worth quoting.
	$effect(() => {
		void app.conversation?.id;
		selection = null;
	});

	// A search hit asks for one message: the view scrolls to it, and stops
	// following the bottom while the reader looks at it.
	$effect(() => {
		const wanted = app.focusMessageId;
		if (!wanted) return;
		pinned = false;
		requestAnimationFrame(() => {
			document.getElementById(`message-${wanted}`)?.scrollIntoView({ block: 'center' });
		});
	});

	// Follow the stream while the user stays at the bottom.
	$effect(() => {
		const last = visible[visible.length - 1];
		void visible.length;
		void last?.text.length;
		void last?.reasoning?.length;
		void last?.toolCalls?.length;
		if (!pinned || !list) return;
		const target = list;
		requestAnimationFrame(() => target.scrollTo({ top: target.scrollHeight }));
	});

</script>

<svelte:window onkeydown={onKeydown} />

{#if selection}
	<!-- The mouse keeps the selection because the press is swallowed here. -->
	<button
		class="fixed z-30 flex items-center gap-1 rounded-card border border-line bg-surface px-2 py-1 text-xs text-fg shadow-lg"
		style="left: {selection.x}px; top: {selection.y}px"
		onmousedown={(event) => event.preventDefault()}
		onclick={quoteSelection}
		title="Quote the selection in the message box, or press Alt+Q"
		aria-label="Quote the selection in the message box"
	>
		<Icon name="messageSquare" size={12} />
		Quote
	</button>
{/if}

<div
	class="min-h-0 flex-1 overflow-y-auto"
	bind:this={list}
	onscroll={onScroll}
	role="log"
	aria-live="polite"
	aria-relevant="additions text"
	aria-busy={app.running}
	aria-label="Conversation"
>
	<div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-32">
		{#if !visible.length}
			<p class="mt-10 text-center text-sm text-faint">sloppychat</p>
		{/if}

		{#each visible as message (message.id)}
			<MessageItem
				{message}
				{toolResults}
				toolProgress={app.toolProgress}
				streaming={app.liveMessageId === message.id}
				streamRate={app.liveRate}
				prefillRate={app.prefillRate}
				prefillStats={prefillStats[message.id]}
				prefilling={app.prefilling && message.id === lastUserId}
				last={message.id === lastAssistantId && message.role === 'assistant'}
				onRetry={() => app.retry()}
				onEdit={(text) => app.editAndResend(message.id, text)}
				onDelete={() => app.deleteFrom(message.id)}
				onBranch={(id) => app.openBranch(id)}
				onContinue={(id) => app.continueAnswer(id)}
				highlighted={message.id === app.focusMessageId}
			/>
		{/each}
	</div>
</div>
