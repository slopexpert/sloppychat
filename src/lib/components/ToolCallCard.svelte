<script lang="ts">
	import Icon from './Icon.svelte';
	import { TOOL_CATALOG, toolSummary } from '$lib/shared/tools';
	import type { ToolCall } from '$lib/shared/types';
	import type { ToolProgress } from '$lib/client/tools';

	let {
		call,
		progress,
		result
	}: {
		call: ToolCall;
		progress?: ToolProgress;
		result?: { text: string; isError: boolean };
	} = $props();

	const spec = $derived(TOOL_CATALOG.find((tool) => tool.name === call.name));
	const args = $derived(
		call.args && typeof call.args === 'object' ? (call.args as Record<string, unknown>) : {}
	);
	const summary = $derived(toolSummary(call.name, args));
	const failed = $derived(result?.isError === true || progress?.state === 'error');
	const running = $derived(!result && (progress?.state === 'running' || progress === undefined));
	const hits = $derived(
		Array.isArray((progress?.data as unknown[] | undefined) ?? undefined) &&
			call.name === 'web_search'
			? ((progress?.data as { title: string; url: string; domain: string; snippet: string }[]) ?? [])
			: []
	);

	let open = $state(false);

	const toolIcon = $derived(call.name === 'web_search' ? 'search' : 'globe');
</script>

<div class="card overflow-hidden text-sm">
	<button
		type="button"
		class="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-raised"
		onclick={() => (open = !open)}
		aria-expanded={open}
	>
		<span class="text-faint">
			<Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
		</span>
		<Icon name={toolIcon} size={14} class="text-accent" />
		<span class="font-medium text-accent">{spec?.label ?? call.name}</span>
		<span class="min-w-0 flex-1 truncate-clip text-muted">{summary}</span>
		{#if running}
			<span class="flex items-center gap-1.5 text-xs text-muted">
				<Icon name="loader" size={13} class="animate-spin" />running
			</span>
		{:else if failed}
			<span class="flex items-center gap-1.5 text-xs text-danger">
				<Icon name="alert" size={13} />failed
			</span>
		{:else}
			<span class="flex items-center gap-1.5 text-xs text-muted">
				<Icon name="check" size={13} />
				{progress?.detail ?? 'done'}
			</span>
		{/if}
	</button>

	{#if open}
		<div class="border-t border-line px-2.5 py-2">
			{#if hits.length}
				<ul class="space-y-1.5">
					{#each hits as hit (hit.url)}
						<li class="leading-snug">
							<a
								href={hit.url}
								target="_blank"
								rel="noopener noreferrer"
								class="text-accent underline decoration-accent/40 underline-offset-2"
							>
								{hit.title}
							</a>
							<div class="text-xs text-faint">{hit.domain}</div>
							<div class="text-xs text-muted">{hit.snippet}</div>
						</li>
					{/each}
				</ul>
			{/if}
			{#if result?.text}
				<pre class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-sm bg-raised p-2 font-mono text-xs text-muted">{result.text}</pre>
			{:else if !hits.length}
				<div class="text-xs text-faint">
					{running ? 'Waiting for the tool to finish...' : 'No output recorded'}
				</div>
			{/if}
		</div>
	{/if}
</div>
