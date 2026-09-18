<script lang="ts">
	import { MARK, MARK_BOX } from '$lib/shared/mark';

	/**
	 * The app mark: a pig head with pointed ears, a snout and two eyes. The big
	 * snout with its two nostrils is what still reads as a pig when the mark is
	 * drawn as small as the sidebar footer. The geometry comes from shared/mark.ts,
	 * which the browser tab icon is built from too.
	 */

	let { size = 24, wordmark = true, class: className = '' }: {
		size?: number;
		wordmark?: boolean;
		class?: string;
	} = $props();
</script>

<span class="flex items-center gap-2 {className}">
	<svg
		viewBox="0 0 {MARK_BOX} {MARK_BOX}"
		width={size}
		height={size}
		class="shrink-0"
		aria-hidden="true"
		focusable="false"
	>
		<!-- Head and ears, then snout and eyes, then the nostrils cut into it. -->
		<g class="fill-accent">
			<rect
				x={MARK.head.x}
				y={MARK.head.y}
				width={MARK.head.width}
				height={MARK.head.height}
				rx={MARK.head.rx}
			/>
			{#each MARK.ears as d (d)}<path {d} />{/each}
		</g>
		<g class="fill-accent-fg">
			<rect
				x={MARK.snout.x}
				y={MARK.snout.y}
				width={MARK.snout.width}
				height={MARK.snout.height}
				rx={MARK.snout.rx}
			/>
			{#each MARK.eyes as eye (eye.cx)}<circle cx={eye.cx} cy={eye.cy} r={eye.r} />{/each}
		</g>
		<g class="fill-accent">
			{#each MARK.nostrils as nostril (nostril.cx)}
				<circle cx={nostril.cx} cy={nostril.cy} r={nostril.r} />
			{/each}
		</g>
	</svg>
	{#if wordmark}
		<span class="text-sm tracking-tight">sloppychat</span>
	{/if}
</span>
