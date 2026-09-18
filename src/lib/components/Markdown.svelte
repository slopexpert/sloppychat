<script lang="ts">
	import { renderMarkdown } from '$lib/shared/markdown';

	let { text, highlight = true }: { text: string; highlight?: boolean } = $props();

	const html = $derived(renderMarkdown(text, { highlight }));
</script>

<div class="md">{@html html}</div>
