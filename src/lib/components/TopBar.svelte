<script lang="ts">
	import ContextGauge from './ContextGauge.svelte';
	import Icon from './Icon.svelte';
	import { app } from '$lib/client/state.svelte';
	import { contextWindowFor } from '$lib/shared/context';
	import type { ModelInfo } from '$lib/shared/types';

	/**
	 * Single top bar: chat identity on the left, model and app controls on the
	 * right. The chat title is a heading with a rename button rather than an
	 * input, so the message box stays the first text field on the page.
	 */

	let editingTitle = $state(false);
	let titleDraft = $state('');

	const provider = $derived(app.provider);
	const models = $derived(app.availableModels);
	const loading = $derived(provider ? app.modelsLoading[provider.id] === true : false);
	const error = $derived(provider ? app.modelsError[provider.id] : '');

	/** The current pick stays selectable even when discovery does not list it. */
	const options = $derived.by(() => {
		const list: ModelInfo[] = [...models];
		if (app.model && !list.some((model) => model.id === app.model)) {
			list.unshift({ id: app.model, name: app.model });
		}
		return list;
	});

	const selected = $derived(options.find((model) => model.id === app.model));

	/** Remembers the toggle so focus can come back to it when a drawer closes. */
	function registerTrigger(node: HTMLElement) {
		app.sidebarTrigger = node;
		return {
			destroy() {
				if (app.sidebarTrigger === node) app.sidebarTrigger = null;
			}
		};
	}

	/** Only what the model select and the context gauge do not already show. */
	function describe(model: ModelInfo | undefined): string {
		if (!model) return '';
		const bits: string[] = [];
		if (model.vision) bits.push('vision');
		return bits.join(', ');
	}

	/**
	 * The same window the gauge uses, so the two cannot disagree. A `~` marks a
	 * value from the fallback table rather than one the provider reported.
	 */
	function windowLabel(model: ModelInfo): string {
		const resolved = contextWindowFor(model.id, model.contextLength);
		if (resolved.window === undefined) return '';
		return ` - ${resolved.assumed ? '~' : ''}${Math.round(resolved.window / 1000)}k`;
	}

	function focusNow(node: HTMLElement) {
		node.focus();
		(node as HTMLInputElement).select();
	}

	function startTitleEdit() {
		titleDraft = app.conversation?.title ?? '';
		editingTitle = true;
	}

	async function commitTitle() {
		if (!editingTitle) return;
		editingTitle = false;
		const title = titleDraft.trim();
		if (title && title !== app.conversation?.title) await app.renameConversation(title);
	}
</script>

<header class="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
	<button
		class="icon-btn"
		use:registerTrigger
		onclick={() => app.toggleSidebar()}
		title="Toggle chat list"
		aria-label="Toggle chat list"
		aria-expanded={app.sidebarOpen}
	>
		<Icon name={app.sidebarOpen ? 'chevronsLeft' : 'chevronsRight'} size={18} />
	</button>

	{#if app.conversation}
		<!-- One container for both states, so swapping the heading for the input
		     cannot change the height of the bar or push the other controls. -->
		<div class="flex min-w-0 flex-1 items-center gap-1">
			{#if editingTitle}
				<input
					class="field h-8 min-w-0 flex-1 py-0 text-sm"
					aria-label="Chat title"
					bind:value={titleDraft}
					use:focusNow
					onblur={commitTitle}
					onkeydown={(event) => {
						if (event.key === 'Enter') commitTitle();
						if (event.key === 'Escape') editingTitle = false;
					}}
				/>
			{:else}
				<h1 class="min-w-0 truncate-clip text-sm font-medium" title={app.conversation.title}>
					{app.conversation.title}
				</h1>
				<button
					class="icon-btn-ghost shrink-0"
					onclick={startTitleEdit}
					title="Rename chat"
					aria-label="Rename chat"
				>
					<Icon name="pencil" size={15} />
				</button>
			{/if}
		</div>
	{/if}

	<div class="ml-auto flex min-w-0 items-center gap-1.5">
		{#if app.providers.length > 1}
			<select
				class="field w-auto max-w-32 text-xs"
				value={provider?.id ?? ''}
				onchange={(event) => app.setProvider((event.currentTarget as HTMLSelectElement).value)}
				aria-label="Provider"
			>
				{#each app.providers.filter((item) => item.enabled) as item (item.id)}
					<option value={item.id}>{item.name}</option>
				{/each}
			</select>
		{/if}

		<select
			class="field w-36 text-xs sm:w-52 md:w-64"
			value={app.model}
			disabled={loading || !provider}
			onchange={(event) => app.setModel((event.currentTarget as HTMLSelectElement).value)}
			aria-label="Model"
		>
			{#if !options.length}
				<option value="">{loading ? 'Loading models...' : 'No models found'}</option>
			{/if}
			{#each options as model (model.id)}
				<option value={model.id}>
					{model.id}{model.vision ? ' (vision)' : ''}{windowLabel(model)}
				</option>
			{/each}
		</select>

		<ContextGauge />

		{#if error}
			<span class="hidden max-w-40 truncate-clip text-xs text-danger md:inline" title={error}>{error}</span>
		{:else if selected && describe(selected)}
			<span class="hidden text-xs text-faint lg:inline">{describe(selected)}</span>
		{/if}

		<button
			class="icon-btn {app.useTools ? 'icon-btn-on' : ''}"
			title={app.useTools ? 'Web tools are on for this chat' : 'Web tools are off for this chat'}
			aria-label="Web tools"
			aria-pressed={app.useTools}
			onclick={() => (app.useTools = !app.useTools)}
		>
			<Icon name="globe" size={18} />
		</button>
		<button
			class="icon-btn"
			title="Generation parameters"
			aria-label="Generation parameters"
			onclick={() => (app.showParams = !app.showParams)}
		>
			<Icon name="sliders" size={18} />
			{#if app.overriddenParams}
				<span class="badge">{app.overriddenParams}</span>
			{/if}
		</button>
		<button class="icon-btn" title="Settings" aria-label="Settings" onclick={() => (app.showSettings = true)}>
			<Icon name="settings" size={18} />
		</button>
	</div>
</header>
