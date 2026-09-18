<script lang="ts">
	import { app } from '$lib/client/state.svelte';

	const tone = {
		info: 'border-line',
		ok: 'border-ok',
		error: 'border-danger'
	} as const;
</script>

<div
	class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
	role="status"
	aria-live="polite"
>
	{#each app.toasts as toast (toast.id)}
		<button
			class="card pointer-events-auto border-l-4 {tone[toast.kind]} px-3 py-2 text-left text-sm shadow-lg"
			onclick={() => app.dismiss(toast.id)}
			title="Dismiss"
		>
			<span class={toast.kind === 'error' ? 'text-danger' : 'text-fg'}>{toast.text}</span>
		</button>
	{/each}
</div>
