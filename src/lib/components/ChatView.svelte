<script lang="ts">
	import MessageItem from './MessageItem.svelte';
	import { app } from '$lib/client/state.svelte';
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
	}

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
			/>
		{/each}
	</div>
</div>
