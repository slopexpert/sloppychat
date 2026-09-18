<script lang="ts">
	import Icon from './Icon.svelte';
	import { TOOL_CATALOG } from '$lib/shared/tools';
	import type { ToolMode } from '$lib/shared/types';
	import { app } from '$lib/client/state.svelte';

	/**
	 * One row per tool: the tool id and a three way switch. The left position is
	 * off, the middle asks first, and the right is on. This list is the only place
	 * where a tool is switched, and the top bar menu and Settings share it. A tool
	 * with the position off sends no schema to the model, so it costs nothing.
	 */

	const MODES: { id: ToolMode; icon: 'x' | 'help' | 'check'; label: string }[] = [
		{ id: 'off', icon: 'x', label: 'Off' },
		{ id: 'ask', icon: 'help', label: 'Ask first' },
		{ id: 'on', icon: 'check', label: 'On' }
	];

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
	{#each TOOL_CATALOG as spec (spec.name)}
		<li class="flex items-center gap-3" title={spec.description}>
			<span class="min-w-0 flex-1 truncate-clip font-mono text-xs text-fg">{spec.name}</span>
			<div
				class="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5"
				role="radiogroup"
				tabindex="-1"
				aria-label="{spec.name} mode"
				onkeydown={(event) => onKeydown(event, spec.name)}
			>
				{#each MODES as mode (mode.id)}
					{@const active = app.toolMode(spec.name) === mode.id}
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
						onclick={() => app.setToolMode(spec.name, mode.id)}
					>
						<Icon name={mode.icon} size={13} stroke={2.4} />
					</button>
				{/each}
			</div>
		</li>
	{/each}
</ul>
