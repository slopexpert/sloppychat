<script lang="ts">
	import { app } from '$lib/client/state.svelte';
	import { api } from '$lib/client/api';
	import Icon from '../Icon.svelte';

	const PRESETS = [
		{ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
		{ name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
		{ name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
		{ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
		{ name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
		{ name: 'Together', baseUrl: 'https://api.together.xyz/v1' },
		{ name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
		{ name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
		{ name: 'llama.cpp', baseUrl: 'http://localhost:8080/v1' }
	];

	let newName = $state('');
	let newBase = $state('');
	let newKey = $state('');
	let adding = $state(false);
	let busy = $state('');

	/** Runs a provider write. A failure is shown, because the row did not change. */
	function writeProvider(action: Promise<unknown>) {
		action
			.then(() => app.reloadProviders())
			.catch((err: unknown) => app.toast('error', err instanceof Error ? err.message : String(err)));
	}

	async function addProvider() {
		if (!newName.trim() || !newBase.trim()) {
			app.toast('error', 'Name and base URL are required');
			return;
		}
		busy = 'add';
		try {
			const { provider } = await api.createProvider({
				name: newName.trim(),
				baseUrl: newBase.trim(),
				apiKey: newKey
			});
			newName = '';
			newBase = '';
			newKey = '';
			adding = false;
			await app.reloadProviders();
			// Discover the models straight away instead of waiting for a click.
			void app.refreshModels(provider.id);
			app.toast('ok', 'Provider added');
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
		} finally {
			busy = '';
		}
	}

	async function testProvider(id: string) {
		await app.refreshModels(id);
		const error = app.modelsError[id];
		if (error) app.toast('error', error);
		else app.toast('ok', `${app.models[id]?.length ?? 0} models found`);
	}
</script>

<div class="space-y-4">
	{#each app.providers as provider (provider.id)}
		<div class="card p-3">
			<div class="flex flex-wrap items-center gap-2">
				<input
					class="field w-40 text-sm"
					value={provider.name}
					onchange={(event) =>
						writeProvider(
							api.updateProvider(provider.id, {
								name: (event.currentTarget as HTMLInputElement).value
							})
						)}
				/>
				<input
					class="field min-w-56 flex-1 text-sm"
					value={provider.baseUrl}
					onchange={(event) =>
						writeProvider(
							api.updateProvider(provider.id, {
								baseUrl: (event.currentTarget as HTMLInputElement).value
							})
						)}
				/>
				<label class="flex items-center gap-1.5 text-xs text-muted">
					<input
						type="checkbox"
						class="accent-[var(--accent)]"
						checked={provider.enabled}
						onchange={(event) =>
							writeProvider(
								api.updateProvider(provider.id, {
									enabled: (event.currentTarget as HTMLInputElement).checked
								})
							)}
					/>
					enabled
				</label>
			</div>
			<div class="mt-2 flex flex-wrap items-center gap-2">
				<input
					class="field min-w-56 flex-1 text-sm"
					type="password"
					placeholder={provider.hasKey ? 'API key is set, type to replace' : 'API key'}
					onchange={(event) =>
						writeProvider(
							api.updateProvider(provider.id, {
								apiKey: (event.currentTarget as HTMLInputElement).value
							})
						)}
				/>
				<input
					class="field w-52 text-sm"
					placeholder="default model"
					value={provider.defaultModel ?? ''}
					onchange={(event) =>
						writeProvider(
							api.updateProvider(provider.id, {
								defaultModel: (event.currentTarget as HTMLInputElement).value
							})
						)}
				/>
				<button class="btn text-xs" onclick={() => testProvider(provider.id)}>
					<Icon name="refresh" size={14} spin={app.modelsLoading[provider.id] === true} />
					Discover models
				</button>
				<button
					class="icon-btn hover:text-danger"
					title="Delete this provider"
					aria-label="Delete this provider"
					onclick={() => writeProvider(api.deleteProvider(provider.id))}
				>
					<Icon name="trash" />
				</button>
			</div>
			{#if app.modelsError[provider.id]}
				<p class="mt-2 text-xs text-danger">{app.modelsError[provider.id]}</p>
			{:else if app.models[provider.id]?.length}
				<p class="mt-2 text-xs text-faint">{app.models[provider.id].length} models available</p>
			{/if}
		</div>
	{/each}

	{#if adding}
		<div class="card space-y-2 p-3">
			<div class="flex flex-wrap gap-2">
				<input class="field w-40 text-sm" placeholder="Name" bind:value={newName} />
				<input class="field min-w-64 flex-1 text-sm" placeholder="Base URL, for example https://api.openai.com/v1" bind:value={newBase} />
			</div>
			<input class="field text-sm" type="password" placeholder="API key, optional for local servers" bind:value={newKey} />
			<div class="flex flex-wrap gap-1">
				{#each PRESETS as preset (preset.name)}
					<button
						class="btn px-2 py-0.5 text-xs"
						onclick={() => {
							newName = preset.name;
							newBase = preset.baseUrl;
						}}>{preset.name}</button
					>
				{/each}
			</div>
			<div class="flex justify-end gap-2">
				<button class="btn" onclick={() => (adding = false)}>Cancel</button>
				<button class="btn-accent" onclick={addProvider} disabled={busy === 'add'}>
				<Icon name="plus" size={14} />
				Add provider
			</button>
			</div>
		</div>
	{:else}
		<button class="btn" onclick={() => (adding = true)}>
			<Icon name="plus" size={14} />
			Add provider
		</button>
	{/if}
</div>
