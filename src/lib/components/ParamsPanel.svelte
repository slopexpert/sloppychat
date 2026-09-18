<script lang="ts">
	import { app } from '$lib/client/state.svelte';
	import { resolveParams } from '$lib/shared/params';
	import type { GenerationParams } from '$lib/shared/types';
	import ParamsForm from './ParamsForm.svelte';
	import { activeTools } from '$lib/shared/tools';
	import Icon from './Icon.svelte';

	const inherited = $derived(resolveParams(app.settings.generation));

	/** A conversation override layer: clearing a field removes the key again. */
	async function change(patch: Partial<GenerationParams>) {
		const next: Partial<GenerationParams> = { ...(app.conversation?.params ?? {}) };
		for (const [key, value] of Object.entries(patch)) {
			if (value === undefined) delete next[key as keyof GenerationParams];
			else (next as Record<string, unknown>)[key] = value;
		}
		const conversationPatch: Parameters<typeof app.patchConversation>[0] = { params: next };
		if (patch.system !== undefined) {
			conversationPatch.system = patch.system || null;
			delete next.system;
			conversationPatch.params = next;
		}
		await app.patchConversation(conversationPatch);
	}
</script>

<aside class="w-80 shrink-0 overflow-y-auto border-l border-line bg-surface p-3">
	<header class="mb-3 flex items-center gap-2">
		<h2 class="flex-1 text-sm font-semibold">Chat parameters</h2>
		<button
			class="icon-btn"
			onclick={() => (app.showParams = false)}
			title="Close parameters"
			aria-label="Close parameters"
		>
			<Icon name="x" />
		</button>
	</header>

	<p class="mb-3 text-xs text-faint">
		Empty fields inherit the global default, shown as the placeholder.
	</p>

	<ParamsForm
		value={app.conversation?.params ?? {}}
		defaults={{ ...inherited, system: app.conversation?.system || inherited.system }}
		mode="override"
		onchange={change}
	/>

	<dl class="mt-4 space-y-1 border-t border-line pt-3 text-xs text-muted">
		<div class="flex justify-between gap-2"><dt>Provider</dt><dd class="text-fg">{app.provider?.name ?? 'none'}</dd></div>
		<div class="flex justify-between gap-2"><dt>Model</dt><dd class="truncate-clip text-fg">{app.model || 'none'}</dd></div>
		<div class="flex justify-between gap-2">
			<dt>Tools</dt>
			<dd class="text-fg">{activeTools(app.settings.tools.modes).length} active</dd>
		</div>
		<div class="flex justify-between gap-2">
			<dt>Max tools rounds</dt>
			<dd class="text-fg">{app.settings.tools.maxRounds}</dd>
		</div>
	</dl>
</aside>
