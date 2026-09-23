<script lang="ts">
	import { app } from '$lib/client/state.svelte';
	import { api } from '$lib/client/api';
	import Icon from '../Icon.svelte';
	import { PROMPT_VARS, promptKey, type PromptKind } from '$lib/shared/prompts';

	/** Prompt bodies being typed, kept apart from the saved library. */
	let promptDrafts = $state<Record<string, string>>({});
	/** The variable names shown as the hint, spelled with their braces. */
	const varHint = PROMPT_VARS.map((name) => `{{${name}}}`).join('  ');

	/** A blank prompt to type into, with a title that is not taken yet. */
	async function addPrompt(kind: PromptKind = 'user') {
		const taken = new Set(app.prompts.map((entry) => entry.title.toLowerCase()));
		const base = kind === 'system' ? 'new system prompt' : 'new prompt';
		let title = base;
		for (let index = 2; taken.has(title); index++) title = `${base} ${index}`;
		try {
			await api.createPrompt({ title, description: '', body: '', kind });
			await app.refreshPrompts();
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
		}
	}

	async function savePrompt(
		id: string,
		patch: Partial<{ title: string; description: string; body: string; kind: PromptKind }>
	) {
		try {
			await api.updatePrompt(id, patch);
			await app.refreshPrompts();
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
		}
	}

	async function removePrompt(id: string) {
		try {
			await api.deletePrompt(id);
			await app.refreshPrompts();
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
		}
	}
</script>

<div class="space-y-3">
	<div class="card space-y-2 p-3">
		<div class="flex flex-wrap items-center gap-2">
			<h3 class="flex-1 text-sm font-semibold">Prompts</h3>
			<button class="btn text-xs" onclick={() => addPrompt('user')}>
				<Icon name="plus" size={14} />
				New snippet
			</button>
			<button class="btn text-xs" onclick={() => addPrompt('system')}>
				<Icon name="plus" size={14} />
				New system prompt
			</button>
		</div>
		<p class="text-xs text-faint">
			A snippet is typed into a message as
			<span class="font-mono">/name</span>
			and filled in when the message is sent, so /notes draft this leaves as the text
			followed by "draft this". Tab inserts the picked entry while you type. A system prompt
			fills the system field of a chat from the params panel.
		</p>
		<p class="text-xs text-faint">
			Variables are filled in when the text is used:
			<span class="font-mono">{varHint}</span>.
			Any other name in braces stays as a blank to type over.
		</p>
	</div>

	{#each app.prompts as entry (entry.id)}
		<div class="card space-y-2 p-3">
			<div class="flex flex-wrap items-center gap-2">
				<input
					class="field w-52 text-xs"
					aria-label="Prompt title"
					value={entry.title}
					onchange={(event) =>
						savePrompt(entry.id, {
							title: (event.currentTarget as HTMLInputElement).value
						})}
				/>
				<span class="font-mono text-xs text-faint">/{promptKey(entry.title)}</span>
				<select
					class="field w-36 text-xs"
					aria-label="Prompt kind"
					value={entry.kind}
					onchange={(event) =>
						savePrompt(entry.id, {
							kind: (event.currentTarget as HTMLSelectElement).value as PromptKind
						})}
				>
					<option value="user">message snippet</option>
					<option value="system">system prompt</option>
				</select>
				<input
					class="field min-w-40 flex-1 text-xs"
					aria-label="Prompt description"
					placeholder="What is it for?"
					value={entry.description}
					onchange={(event) =>
						savePrompt(entry.id, {
							description: (event.currentTarget as HTMLInputElement).value
						})}
				/>
				<button
					class="icon-btn hover:text-danger"
					title="Delete this prompt"
					aria-label="Delete this prompt"
					onclick={() => removePrompt(entry.id)}
				>
					<Icon name="trash" />
				</button>
			</div>
			<textarea
					class="field min-h-28 font-mono text-xs"
					aria-label="Prompt text, {entry.title}"
					value={promptDrafts[entry.id] ?? entry.body}
					oninput={(event) =>
						(promptDrafts = {
							...promptDrafts,
							[entry.id]: (event.currentTarget as HTMLTextAreaElement).value
						})}
					onblur={() => savePrompt(entry.id, { body: promptDrafts[entry.id] ?? entry.body })}
				></textarea>
			<div class="flex items-center justify-end gap-2">
				{#if !(promptDrafts[entry.id] ?? entry.body).trim()}
					<span class="text-xs text-faint">empty, so it inserts nothing</span>
				{/if}
				<button
					class="btn-accent text-xs"
					onclick={() => savePrompt(entry.id, { body: promptDrafts[entry.id] ?? entry.body })}
				>
					Save
				</button>
			</div>
		</div>
	{/each}

	{#if !app.prompts.length}
		<p class="text-xs text-faint">No prompts yet. Add one to type it as /name in a message.</p>
	{/if}
</div>
