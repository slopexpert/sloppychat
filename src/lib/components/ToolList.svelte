<script lang="ts">
	import Icon from './Icon.svelte';
	import { TOOL_CATALOG } from '$lib/shared/tools';
	import type { ToolMode } from '$lib/shared/types';
	import { app } from '$lib/client/state.svelte';

	/**
	 * One row per tool: the tool id and a three way switch. The left position is
	 * off, the middle asks first, and the right is on. The top bar menu and
	 * Settings show this list. The tools of the MCP servers come last, and a tool
	 * whose mode was never set asks first.
	 */

	const MODES: { id: ToolMode; icon: 'x' | 'help' | 'check'; label: string }[] = [
		{ id: 'off', icon: 'x', label: 'Off' },
		{ id: 'ask', icon: 'help', label: 'Ask first' },
		{ id: 'on', icon: 'check', label: 'On' }
	];

	/** The builtin tools, then whatever the MCP servers offer. */
	const rows = $derived([
		...TOOL_CATALOG.map((spec) => ({ name: spec.name, title: spec.description })),
		...app.mcpTools.map((tool) => ({
			name: tool.id,
			title: tool.description || `${tool.serverName} / ${tool.name}`
		}))
	]);

	/** Arrow keys move the switch, the way a radio group does. */
	function onKeydown(event: KeyboardEvent, name: string) {
		const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
		const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
		if (!forward && !backward) return;
		const current = MODES.findIndex((mode) => mode.id === app.toolMode(name));
		const next = MODES[(current + (forward ? 1 : -1) + MODES.length) % MODES.length];
		event.preventDefault();
		void app.setToolMode(name, next.id);
		(event.currentTarget as HTMLElement).querySelectorAll('button')[MODES.indexOf(next)]?.focus();
	}
</script>

<ul class="space-y-2">
	{#each rows as row (row.name)}
		<li class="flex items-center gap-3" title={row.title}>
			<span class="min-w-0 flex-1 truncate-clip font-mono text-xs text-fg">{row.name}</span>
			<div
				class="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5"
				role="radiogroup"
				tabindex="-1"
				aria-label="{row.name} mode"
				onkeydown={(event) => onKeydown(event, row.name)}
			>
				{#each MODES as mode (mode.id)}
					{@const active = app.toolMode(row.name) === mode.id}
					<button
						type="button"
						role="radio"
						aria-checked={active}
						aria-label={mode.label}
						title={mode.label}
						tabindex={active ? 0 : -1}
						class="flex size-6 items-center justify-center rounded-md transition-colors {active
							? 'bg-accent text-accent-fg'
							: 'text-faint hover:bg-surface hover:text-fg'}"
						onclick={() => app.setToolMode(row.name, mode.id)}
					>
						<Icon name={mode.icon} size={13} stroke={2.4} />
					</button>
				{/each}
			</div>
		</li>
	{/each}
</ul>
