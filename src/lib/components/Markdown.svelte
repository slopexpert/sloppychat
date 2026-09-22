<script lang="ts">
	import { renderMarkdown } from '$lib/shared/markdown';

	let { text, highlight = true }: { text: string; highlight?: boolean } = $props();

	const html = $derived(renderMarkdown(text, { highlight }));

	/**
	 * A fenced block carries its own copy button, which lives inside the rendered
	 * markup. The click is therefore caught here, and the block text is read back
	 * from the code element, where it is stored exactly as written.
	 */
	async function onclick(event: MouseEvent) {
		const target = event.target as HTMLElement | null;
		const button = target?.closest?.('.md-copy') as HTMLButtonElement | null;
		if (!button) return;
		const code = button.parentElement?.querySelector('code');
		if (!code) return;
		await navigator.clipboard.writeText(code.textContent ?? '');
		button.textContent = 'Copied';
		setTimeout(() => (button.textContent = 'Copy'), 1200);
	}
</script>

<div class="md" role="presentation" onclick={onclick}>{@html html}</div>
