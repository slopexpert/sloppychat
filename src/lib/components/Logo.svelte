<script lang="ts">
	/**
	 * The app mark, the same drawing as the favicon: a square with soft corners
	 * and three lines. The colours are theme tokens, so every theme and mode fits.
	 */

	let { size = 24, wordmark = true, class: className = '' }: {
		size?: number;
		wordmark?: boolean;
		class?: string;
	} = $props();
</script>

<span class="flex items-center gap-2 {className}">
	<svg viewBox="0 0 32 32" width={size} height={size} class="shrink-0" aria-hidden="true" focusable="false">
		<rect width="32" height="32" rx="8" class="fill-accent" />
		<path
			d="M8 11h16M8 16h11M8 21h7"
			class="stroke-accent-fg"
			stroke-width="2.5"
			stroke-linecap="round"
			fill="none"
		/>
	</svg>
	{#if wordmark}
		<span class="text-sm tracking-tight">sloppychat</span>
	{/if}
</span>
