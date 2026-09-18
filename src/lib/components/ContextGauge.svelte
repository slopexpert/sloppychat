<script lang="ts">
	import { app } from '$lib/client/state.svelte';
	import { contextWindowFor } from '$lib/shared/context';
	import { contextUsage, formatTokens } from '$lib/shared/stats';

	/**
	 * How full the context window is. The window comes from the provider when it
	 * reports one, otherwise from a table of known models and is marked assumed.
	 * The last usage report gives the real token count up to that turn; anything
	 * after it is estimated from text length.
	 */

	const usage = $derived.by(() => {
		const reported = app.availableModels.find((model) => model.id === app.model)?.contextLength;
		const resolved = contextWindowFor(app.model, reported);
		return {
			...contextUsage({ messages: app.messages, system: app.params.system, window: resolved.window }),
			assumed: resolved.assumed
		};
	});

	const percent = $derived(
		usage.ratio === undefined ? undefined : Math.min(100, Math.round(usage.ratio * 100))
	);
	const level = $derived(percent === undefined ? 'ok' : percent >= 90 ? 'full' : percent >= 70 ? 'high' : 'ok');

	/** Input and output as the last turn reported them, when there is one. */
	const lastTurn = $derived.by(() => {
		for (let at = app.messages.length - 1; at >= 0; at--) {
			const usageOfMessage = app.messages[at].usage;
			if (usageOfMessage && (usageOfMessage.prompt || usageOfMessage.completion)) return usageOfMessage;
		}
		return undefined;
	});

	const remaining = $derived(
		usage.window === undefined ? undefined : Math.max(0, usage.window - usage.used)
	);

	const hint = $derived(
		[
			usage.window === undefined
				? `${formatTokens(usage.used)} tokens used, no context window known for this model`
				: `${formatTokens(usage.used)} of ${formatTokens(usage.window)} tokens used${usage.assumed ? ' (window assumed for this model)' : ''}`,
			remaining === undefined ? '' : `${formatTokens(remaining)} left`,
			percent === undefined ? '' : `${percent}% full`,
			lastTurn?.prompt ? `last turn: ${formatTokens(lastTurn.prompt)} in, ${formatTokens(lastTurn.completion ?? 0)} out` : '',
			usage.measured ? 'counted from the last usage report' : 'estimated from text length'
		]
			.filter(Boolean)
			.join('\n')
	);
</script>

{#if usage.used > 0}
	<div class="hidden items-center gap-1.5 sm:flex" title={hint}>
		<div
			class="h-1.5 w-14 overflow-hidden rounded-full bg-raised"
			role="progressbar"
			aria-label="Context used"
			aria-valuenow={percent ?? 0}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuetext={usage.window === undefined ? `${formatTokens(usage.used)} tokens used, window unknown` : undefined}
		>
			<div
				class="h-full rounded-full transition-[width] {percent === undefined
					? 'bg-faint'
					: level === 'full'
						? 'bg-danger'
						: level === 'high'
							? 'bg-secondary'
							: 'bg-accent'}"
				style="width: {percent === undefined ? 100 : Math.max(percent, 2)}%"
			></div>
		</div>
		<span class="text-xs text-faint">
			{percent === undefined ? `${formatTokens(usage.used)} tok` : `${percent}%`}
		</span>
	</div>
{/if}
