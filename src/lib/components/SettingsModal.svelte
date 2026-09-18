<script lang="ts">
	import { app, applyTheme } from '$lib/client/state.svelte';
	import { api } from '$lib/client/api';
	import { DEFAULT_PARAMS } from '$lib/shared/types';
	import type { McpServerState, ThemeSettings } from '$lib/shared/types';
	import { resolveTheme, THEMES } from '$lib/shared/themes';
	import ParamsForm from './ParamsForm.svelte';
	import Icon from './Icon.svelte';
	import ToolList from './ToolList.svelte';

	interface Choice {
		id: string;
		label: string;
	}

	const FONTS: Choice[] = [
		{ id: 'system', label: 'System' },
		{ id: 'custom', label: 'Custom' }
	];
	const TEXT_SIZES: Choice[] = [
		{ id: 'small', label: 'Small' },
		{ id: 'default', label: 'Default' },
		{ id: 'large', label: 'Large' }
	];
	const RADII: Choice[] = [
		{ id: 'square', label: 'Square' },
		{ id: 'small', label: 'Small' },
		{ id: 'default', label: 'Default' },
		{ id: 'large', label: 'Large' },
		{ id: 'round', label: 'Round' }
	];
	const DENSITIES: Choice[] = [
		{ id: 'compact', label: 'Compact' },
		{ id: 'default', label: 'Default' },
		{ id: 'spacious', label: 'Spacious' }
	];

	let {
		open = $bindable(false),
		onclose
	}: { open?: boolean; onclose?: () => void } = $props();

	let tab = $state<'providers' | 'tools' | 'skills' | 'generation' | 'appearance' | 'mcp'>('providers');
	let skillInput: HTMLInputElement | undefined = $state();
	/** A pasted Cursor config, and what the last MCP action answered. */
	let mcpJson = $state('');
	let mcpNote = $state('');
	/** Body text being typed, saved when the field is left or Save is pressed. */
	let skillDrafts = $state<Record<string, string>>({});
	/** The modal only renders in the browser, so matchMedia is safe here. */
	const systemDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
	let newName = $state('');
	let newBase = $state('');
	let newKey = $state('');
	let adding = $state(false);
	let busy = $state('');

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

	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let panel: HTMLDivElement | undefined = $state();

	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	// Move focus into the dialog and keep Tab inside it while it is open.
	$effect(() => {
		if (!open || !panel) return;
		panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();
	});

	/** Reads the pasted config and adds every server it holds. */
	async function addMcpFromJson() {
		mcpNote = '';
		try {
			const count = await app.importMcpServers(mcpJson);
			mcpNote = `Added ${count} server${count === 1 ? '' : 's'}`;
			mcpJson = '';
		} catch (err) {
			mcpNote = err instanceof Error ? err.message : String(err);
		}
	}

	/** Tries a saved server without changing it, and shows what it answered. */
	async function testMcp(server: McpServerState) {
		mcpNote = `${server.name}: ${await app.testMcpServer(server.name, server.config)}`;
	}

	/** The one line that says where a server comes from. */
	function describeMcp(server: McpServerState): string {
		const config = server.config;
		if (config.transport === 'http') return config.url ?? '';
		return [config.command, ...(config.args ?? [])].filter(Boolean).join(' ');
	}

	function onDialogKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			close();
			return;
		}
		if (event.key !== 'Tab' || !panel) return;
		const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
			(item) => item.offsetParent !== null
		);
		if (!items.length) return;
		const first = items[0];
		const last = items[items.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	/** Settings that are cheap to edit are saved on a short delay. */
	function save(patch: Parameters<typeof app.saveSettings>[0]) {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void app.saveSettings(patch), 400);
	}

	function close() {
		open = false;
		onclose?.();
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

	async function uploadSkills(files: FileList | null | undefined) {
		if (!files?.length) return;
		try {
			const { skills } = await api.uploadSkills([...files]);
			await app.refreshSkills();
			app.toast('ok', skills.length === 1 ? `Added ${skills[0].name}` : `Added ${skills.length} skills`);
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
		}
	}

	/** A blank skill to type into, with a name that is not taken yet. */
	async function addBlankSkill() {
		const taken = new Set(app.skills.map((skill) => skill.name));
		let name = 'new-skill';
		for (let index = 2; taken.has(name); index++) name = `new-skill-${index}`;
		try {
			await api.createSkill({ name, description: '', body: '# Steps\n\n' });
			await app.refreshSkills();
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
		}
	}

	async function saveSkill(id: string, patch: Partial<{ name: string; description: string; body: string; enabled: boolean }>) {
		try {
			await api.updateSkill(id, patch);
			await app.refreshSkills();
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
		}
	}

	async function removeSkill(id: string) {
		try {
			await api.deleteSkill(id);
			await app.refreshSkills();
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
		}
	}

	async function testProvider(id: string) {
		await app.refreshModels(id);
		const error = app.modelsError[id];
		if (error) app.toast('error', error);
		else app.toast('ok', `${app.models[id]?.length ?? 0} models found`);
	}
</script>

{#snippet choiceRow(
	label: string,
	items: Choice[],
	current: string,
	onPick: (id: string) => void
)}
	<div class="flex flex-wrap items-center gap-2">
		<span class="w-20 text-xs text-muted">{label}</span>
		<div class="flex flex-wrap gap-1">
			{#each items as item (item.id)}
				<button
					class="btn px-2 py-0.5 text-xs {current === item.id ? 'border-accent text-accent' : ''}"
					onclick={() => onPick(item.id)}
					aria-pressed={current === item.id}>{item.label}</button
				>
			{/each}
		</div>
	</div>
{/snippet}

{#if open}
	<div
		class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) close();
		}}
		onkeydown={onDialogKeydown}
	>
		<div
			class="card w-full max-w-3xl shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-label="Settings"
			bind:this={panel}
		>
			<header class="flex items-center gap-2 border-b border-line px-4 py-3">
				<h2 class="flex-1 font-semibold">Settings</h2>
				<button class="icon-btn" onclick={close} title="Close settings" aria-label="Close settings">
					<Icon name="x" />
				</button>
			</header>

			<div class="flex flex-wrap gap-1 border-b border-line px-4 py-2 text-sm">
				{#each [['providers', 'Providers', 'key'], ['tools', 'Tools', 'wrench'], ['mcp', 'MCP', 'globe'], ['skills', 'Skills', 'book'], ['generation', 'Generation', 'sliders'], ['appearance', 'Appearance', 'sparkles']] as [key, label, icon] (key)}
					<button
						class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 {tab === key
							? 'bg-raised text-fg'
							: 'text-muted hover:text-fg'}"
						onclick={() => (tab = key as typeof tab)}
						aria-current={tab === key}
					>
						<Icon name={icon as 'key'} size={14} />
						{label}
					</button>
				{/each}
			</div>

			<div class="max-h-[70vh] overflow-y-auto p-4">
				{#if tab === 'providers'}
					<div class="space-y-4">
						{#each app.providers as provider (provider.id)}
							<div class="card p-3">
								<div class="flex flex-wrap items-center gap-2">
									<input
										class="field w-40 text-sm"
										value={provider.name}
										onchange={(event) =>
											api.updateProvider(provider.id, {
												name: (event.currentTarget as HTMLInputElement).value
											}).then(() => app.reloadProviders())}
									/>
									<input
										class="field min-w-56 flex-1 text-sm"
										value={provider.baseUrl}
										onchange={(event) =>
											api.updateProvider(provider.id, {
												baseUrl: (event.currentTarget as HTMLInputElement).value
											}).then(() => app.reloadProviders())}
									/>
									<label class="flex items-center gap-1.5 text-xs text-muted">
										<input
											type="checkbox"
											class="accent-[var(--accent)]"
											checked={provider.enabled}
											onchange={(event) =>
												api.updateProvider(provider.id, {
													enabled: (event.currentTarget as HTMLInputElement).checked
												}).then(() => app.reloadProviders())}
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
											api.updateProvider(provider.id, {
												apiKey: (event.currentTarget as HTMLInputElement).value
											}).then(() => app.reloadProviders())}
									/>
									<input
										class="field w-52 text-sm"
										placeholder="default model"
										value={provider.defaultModel ?? ''}
										onchange={(event) =>
											api.updateProvider(provider.id, {
												defaultModel: (event.currentTarget as HTMLInputElement).value
											}).then(() => app.reloadProviders())}
									/>
									<button class="btn text-xs" onclick={() => testProvider(provider.id)}>
										<Icon name="refresh" size={14} spin={app.modelsLoading[provider.id] === true} />
										Discover models
									</button>
									<button
										class="icon-btn hover:text-danger"
										title="Delete this provider"
										aria-label="Delete this provider"
										onclick={() => api.deleteProvider(provider.id).then(() => app.reloadProviders())}
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
				{:else if tab === 'tools'}
					<div class="space-y-4">
						<div class="card space-y-2 p-3">
							<h3 class="text-sm font-semibold">Tools</h3>
							<ToolList />
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									class="accent-[var(--accent)]"
									checked={app.settings.tools.fetchAllowPrivate}
									onchange={(event) =>
										save({
											tools: {
												...app.settings.tools,
												fetchAllowPrivate: (event.currentTarget as HTMLInputElement).checked
											}
										})}
								/>
								allow private and loopback hosts in web_fetch
							</label>
							<div class="grid grid-cols-2 gap-2">
								<label class="text-xs text-muted">
									Reader limit (characters)
									<input
										class="field mt-1 text-sm"
										type="number"
										min="1000"
										max="200000"
										value={app.settings.tools.fetchMaxChars}
										onchange={(event) =>
											save({
												tools: {
													...app.settings.tools,
													fetchMaxChars: Number((event.currentTarget as HTMLInputElement).value) || 20000
												}
											})}
									/>
								</label>
								<label class="text-xs text-muted">
									Max tool rounds per turn
									<input
										class="field mt-1 text-sm"
										type="number"
										min="1"
										max="20"
										value={app.settings.tools.maxRounds}
										onchange={(event) =>
											save({
												tools: {
													...app.settings.tools,
													maxRounds: Number((event.currentTarget as HTMLInputElement).value) || 6
												}
											})}
									/>
								</label>
							</div>
						</div>

						<div class="card space-y-2 p-3">
							<h3 class="text-sm font-semibold">PDF attachments</h3>
							<p class="text-xs text-faint">
								Text is always extracted. Pages are rendered to images for vision models.
							</p>
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									class="accent-[var(--accent)]"
									checked={app.settings.tools.pdfImages}
									onchange={(event) =>
										save({
											tools: {
												...app.settings.tools,
												pdfImages: (event.currentTarget as HTMLInputElement).checked
											}
										})}
								/>
								render pages for vision models
							</label>
							<div class="grid grid-cols-2 gap-2">
								<label class="text-xs text-muted">
									PDF page images per message
									<input
										class="field mt-1 text-sm"
										type="number"
										min="0"
										max="50"
										value={app.settings.tools.pdfMaxImages}
										onchange={(event) =>
											save({
												tools: {
													...app.settings.tools,
													pdfMaxImages: Number((event.currentTarget as HTMLInputElement).value) || 0
												}
											})}
									/>
								</label>
								<label class="text-xs text-muted">
									PDF text per message (characters)
									<input
										class="field mt-1 text-sm"
										type="number"
										min="1000"
										max="200000"
										value={app.settings.tools.pdfMaxChars}
										onchange={(event) =>
											save({
												tools: {
													...app.settings.tools,
													pdfMaxChars: Number((event.currentTarget as HTMLInputElement).value) || 12000
												}
											})}
									/>
								</label>
							</div>
						</div>

						<div class="card space-y-2 p-3">
							<h3 class="text-sm font-semibold">SearXNG</h3>
							<input
								class="field text-sm"
								placeholder="http://localhost:8888"
								value={app.settings.search.url}
								onchange={(event) =>
									save({
										search: {
											...app.settings.search,
											url: (event.currentTarget as HTMLInputElement).value.trim()
										}
									})}
							/>
							<input
								class="field text-sm"
								type="password"
								placeholder="API key, optional"
								value={app.settings.search.apiKey}
								onchange={(event) =>
									save({
										search: {
											...app.settings.search,
											apiKey: (event.currentTarget as HTMLInputElement).value
										}
									})}
							/>
							<label class="text-xs text-muted">
								Results per search
								<input
									class="field mt-1 w-24 text-sm"
									type="number"
									min="1"
									max="10"
									value={app.settings.search.maxResults}
									onchange={(event) =>
										save({
											search: {
												...app.settings.search,
												maxResults: Number((event.currentTarget as HTMLInputElement).value) || 5
											}
										})}
								/>
							</label>
							<p class="text-xs text-faint">
								The instance needs <code>json</code> listed under <code>search.formats</code> in settings.yml.
							</p>
						</div>
					</div>
				{:else if tab === 'skills'}
					<div class="space-y-3">
						<div class="card space-y-2 p-3">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="flex-1 text-sm font-semibold">Skills</h3>
								<button class="btn text-xs" onclick={() => skillInput?.click()}>
									<Icon name="plus" size={14} />
									Upload markdown
								</button>
								<button class="btn text-xs" onclick={addBlankSkill}>
									<Icon name="plus" size={14} />
									New skill
								</button>
								<input
									bind:this={skillInput}
									type="file"
									accept=".md,.markdown,text/markdown,text/plain"
									multiple
									class="hidden"
									onchange={(event) => {
										uploadSkills((event.currentTarget as HTMLInputElement).files);
										(event.currentTarget as HTMLInputElement).value = '';
									}}
								/>
							</div>
						</div>

						{#each app.skills as skill (skill.id)}
							<div class="card space-y-2 p-3">
								<div class="flex flex-wrap items-center gap-2">
									<input
										class="field w-44 text-xs"
										aria-label="Skill name"
										value={skill.name}
										onchange={(event) =>
											saveSkill(skill.id, { name: (event.currentTarget as HTMLInputElement).value })}
									/>
									<input
										class="field min-w-56 flex-1 text-xs"
										aria-label="Skill description"
										placeholder="When should the model use this skill?"
										value={skill.description}
										onchange={(event) =>
											saveSkill(skill.id, {
												description: (event.currentTarget as HTMLInputElement).value
											})}
									/>
									<label class="flex items-center gap-1.5 text-xs text-muted">
										<input
											type="checkbox"
											class="accent-[var(--accent)]"
											checked={skill.enabled}
											onchange={(event) =>
												saveSkill(skill.id, {
													enabled: (event.currentTarget as HTMLInputElement).checked
												})}
										/>
										enabled
									</label>
									<button
										class="icon-btn hover:text-danger"
										title="Delete this skill"
										aria-label="Delete this skill"
										onclick={() => removeSkill(skill.id)}
									>
										<Icon name="trash" />
									</button>
								</div>
								<textarea
									class="field min-h-40 font-mono text-xs"
									aria-label="Skill markdown, {skill.name}"
									value={skillDrafts[skill.id] ?? skill.body}
									oninput={(event) =>
										(skillDrafts = {
											...skillDrafts,
											[skill.id]: (event.currentTarget as HTMLTextAreaElement).value
										})}
								></textarea>
								<div class="flex justify-end gap-2">
									<button
										class="btn-accent text-xs"
										onclick={() => saveSkill(skill.id, { body: skillDrafts[skill.id] ?? skill.body })}
									>
										Save
									</button>
								</div>
							</div>
						{/each}

						{#if !app.skills.length}
							<p class="text-xs text-faint">No skills yet. Upload a markdown file to add one.</p>
						{/if}
					</div>
				{:else if tab === 'generation'}
					<div class="space-y-3">
						<p class="text-xs text-faint">
							Defaults for every chat. A chat can override any field from the params panel.
						</p>
						<ParamsForm
							value={app.settings.generation}
							defaults={DEFAULT_PARAMS}
							mode="defaults"
							onchange={(patch) => save({ generation: { ...app.settings.generation, ...patch } })}
						/>
					</div>
				{:else if tab === 'mcp'}
					<div class="space-y-4">
						<div class="card space-y-3 p-3">
							<h3 class="text-sm font-semibold">MCP servers</h3>
							{#if !app.mcpServers.length}
								<p class="text-xs text-faint">No server yet. Paste a config below to add one.</p>
							{/if}
							{#each app.mcpServers as server (server.id)}
								<div class="space-y-1 border-t border-line pt-2 first:border-t-0 first:pt-0">
									<div class="flex flex-wrap items-center gap-2">
										<label class="flex items-center gap-2">
											<input
												type="checkbox"
												class="accent-[var(--accent)]"
												checked={server.enabled}
												onchange={(event) =>
													app.setMcpEnabled(server.id, (event.currentTarget as HTMLInputElement).checked)}
											/>
											<span class="text-sm">{server.name}</span>
										</label>
										<span
											class="text-xs {server.status === 'failed' ? 'text-danger' : 'text-faint'}"
											title={server.error ?? ''}
										>
											{server.status === 'failed'
												? 'failed'
												: server.status === 'ready'
													? `${server.tools.length} tools`
													: 'off'}
										</span>
										<span class="ml-auto flex items-center gap-1.5">
											<button class="btn px-2 py-1 text-xs" onclick={() => testMcp(server)}>Test</button>
											<button
												class="icon-btn"
												title="Remove {server.name}"
												aria-label="Remove {server.name}"
												onclick={() => app.removeMcpServer(server.id)}
											>
												<Icon name="trash" size={14} />
											</button>
										</span>
									</div>
									<div class="truncate-clip font-mono text-xs text-faint" title={describeMcp(server)}>
										{describeMcp(server)}
									</div>
									{#if server.tools.length}
										<div class="text-xs text-muted">{server.tools.map((tool) => tool.id).join(', ')}</div>
									{/if}
								</div>
							{/each}
						</div>

						<div class="card space-y-2 p-3">
							<h3 class="text-sm font-semibold">Add a server</h3>
							<textarea
								class="field min-h-24 font-mono text-xs"
								aria-label="MCP config"
								bind:value={mcpJson}
								placeholder={'{\n  "mcpServers": {\n    "files": { "command": "npx", "args": ["-y", "server-filesystem", "/tmp"] }\n  }\n}'}
							></textarea>
							<div class="flex flex-wrap items-center gap-2">
								<button class="btn-accent px-2 py-1 text-xs" onclick={addMcpFromJson} disabled={app.mcpLoading}>
									Add
								</button>
								{#if mcpNote}
									<span class="text-xs text-muted" role="status">{mcpNote}</span>
								{/if}
							</div>
						</div>
					</div>
				{:else}
					<div class="space-y-4">
						<div class="card space-y-2 p-3">
							<h3 class="text-sm font-semibold">Theme</h3>
							<div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
								{#each THEMES as theme (theme.id)}
									<button
										class="flex items-center gap-2 rounded-card border px-2 py-1.5 text-left text-xs {app.settings
											.theme.name === theme.id
											? 'border-accent text-accent'
											: 'border-line text-muted hover:text-fg'}"
										onclick={() => app.setTheme({ name: theme.id })}
										aria-pressed={app.settings.theme.name === theme.id}
										title={theme.credit}
									>
										<span
											class="flex shrink-0 gap-0.5"
											data-theme={resolveTheme(theme.id, systemDark).variant}
											data-mode={resolveTheme(theme.id, systemDark).scheme}
											aria-hidden="true"
										>
											<span class="size-3 rounded-full border border-line bg-bg"></span>
											<span class="size-3 rounded-full border border-line bg-surface"></span>
											<span class="size-3 rounded-full border border-line bg-accent"></span>
											<span class="size-3 rounded-full border border-line bg-fg"></span>
										</span>
										<span class="min-w-0 flex-1 truncate-clip">{theme.label}</span>
									</button>
								{/each}
							</div>
						</div>

						<div class="card space-y-3 p-3">
							<h3 class="text-sm font-semibold">Type</h3>
							{@render choiceRow('Font', FONTS, app.settings.theme.font, (id) =>
								app.setTheme({ font: id as ThemeSettings['font'] }))}
							{#if app.settings.theme.font === 'custom'}
								<div class="flex flex-wrap items-center gap-2">
									<span class="w-20 text-xs text-muted">Family</span>
									<input
										class="field max-w-72 text-xs"
										aria-label="Font family"
										placeholder="Font name, for example Inter"
										value={app.settings.theme.fontFamily}
										oninput={(event) =>
											applyTheme({
												...app.settings.theme,
												fontFamily: (event.currentTarget as HTMLInputElement).value
											})}
										onchange={(event) =>
											app.setTheme({
												fontFamily: (event.currentTarget as HTMLInputElement).value
											})}
									/>
								</div>
								<p class="text-xs text-faint">
									The name has to be installed on this machine, for example DejaVu Serif.
									A list with commas is used as written.
								</p>
							{/if}
							{@render choiceRow('Text size', TEXT_SIZES, app.settings.theme.textSize, (id) =>
								app.setTheme({ textSize: id as ThemeSettings['textSize'] }))}
						</div>

						<div class="card space-y-3 p-3">
							<h3 class="text-sm font-semibold">Shape and spacing</h3>
							{@render choiceRow('Corners', RADII, app.settings.theme.radius, (id) =>
								app.setTheme({ radius: id as ThemeSettings['radius'] }))}
							{@render choiceRow('Padding', DENSITIES, app.settings.theme.density, (id) =>
								app.setTheme({ density: id as ThemeSettings['density'] }))}
						</div>

						<div class="card space-y-2 p-3">
							<h3 class="text-sm font-semibold">Preview</h3>
							<p class="text-body leading-relaxed">
								The quick brown fox jumps over the lazy dog.
								<strong class="text-accent">Bold</strong>,
								<em class="text-secondary">italic</em> and
								<code class="rounded-sm bg-raised px-1 font-mono text-[0.85em] text-accent">code</code>.
							</p>
							<div class="flex flex-wrap items-center gap-2">
								<button class="btn-accent">Primary</button>
								<button class="btn">Secondary</button>
								<input class="field max-w-32" placeholder="Input" readonly />
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
