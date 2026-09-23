<script lang="ts">
	import { app } from '$lib/client/state.svelte';
	import { save } from '$lib/client/settings-draft';
	import { DEFAULT_PARAMS } from '$lib/shared/types';
	import ParamsForm from '../ParamsForm.svelte';

	/** Saved system prompts, offered here as the starting point of a chat. */
	const systemPrompts = $derived(app.prompts.filter((entry) => entry.kind === 'system'));
</script>

<div class="space-y-3">
	<p class="text-xs text-faint">
		Defaults for every chat. A chat can override any field from the params panel.
	</p>
	<ParamsForm
		value={app.settings.generation}
		defaults={DEFAULT_PARAMS}
		mode="defaults"
		systemPresets={systemPrompts}
		onchange={(patch) => save({ generation: { ...app.settings.generation, ...patch } })}
	/>
</div>
