<script lang="ts">
	import type { GenerationParams, ReasoningEffort, ToolChoice } from '$lib/shared/types';
	import type { PromptEntry } from '$lib/shared/prompts';

	/**
	 * Parameter editor. `value` is the layer being edited (global defaults or a
	 * conversation override), `defaults` are the values inherited from below, and
	 * an empty field means "do not override".
	 */

	let {
		value,
		defaults,
		onchange,
		mode = 'override',
		showSystem = true,
		systemPresets = []
	}: {
		value: Partial<GenerationParams>;
		defaults: GenerationParams;
		onchange: (patch: Partial<GenerationParams>) => void;
		mode?: 'defaults' | 'override';
		showSystem?: boolean;
		/** Saved prompts to copy into the field below, variables and all. */
		systemPresets?: PromptEntry[];
	} = $props();

	const overridden = $derived(
		Object.entries(value).filter(([, item]) => {
			if (item === undefined || item === null) return false;
			if (Array.isArray(item)) return item.length > 0;
			if (typeof item === 'string') return item.trim() !== '';
			return true;
		}).length
	);

	function set(key: keyof GenerationParams, raw: string | number | null | undefined) {
		if (raw === '' || raw === undefined || raw === null) {
			onchange({ [key]: mode === 'override' ? undefined : null });
			return;
		}
		onchange({ [key]: raw });
	}

	function setNumber(key: keyof GenerationParams, raw: string) {
		if (raw.trim() === '') {
			onchange({ [key]: mode === 'override' ? undefined : null });
			return;
		}
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) return;
		onchange({ [key]: parsed });
	}

	function clearKey(key: keyof GenerationParams) {
		onchange({ [key]: mode === 'override' ? undefined : null });
	}

	/**
	 * Copies a saved prompt into the field. The variables stay as they are, so the
	 * server fills them in again on every request.
	 */
	function usePreset(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const entry = systemPresets.find((item) => item.id === select.value);
		select.value = '';
		if (entry) set('system', entry.body);
	}

	const current = (key: keyof GenerationParams) => value[key];
	const fallback = (key: keyof GenerationParams) => defaults[key];
</script>

{#snippet sliderRow(
	label: string,
	key: keyof GenerationParams,
	min: number,
	max: number,
	step: number
)}
	{@const own = current(key)}
	{@const inherited = fallback(key)}
	<div class="grid grid-cols-[8rem_1fr_5rem] items-center gap-2">
		<label class="text-xs text-muted" for={`p-${key}`}>{label}</label>
		<input
			id={`p-${key}`}
			type="range"
			{min}
			{max}
			{step}
			value={typeof own === 'number' ? own : typeof inherited === 'number' ? inherited : min}
			class="accent-[var(--accent)]"
			oninput={(event) => set(key, Number((event.currentTarget as HTMLInputElement).value))}
		/>
		<div class="flex items-center gap-1">
			<input
				class="field px-1.5 py-0.5 text-right text-xs"
				type="number"
				{min}
				{max}
				{step}
				placeholder={inherited === null || inherited === undefined ? 'off' : String(inherited)}
				value={own ?? ''}
				oninput={(event) => setNumber(key, (event.currentTarget as HTMLInputElement).value)}
			/>
			{#if own !== undefined && own !== null}
				<button class="text-xs text-faint hover:text-danger" title="Inherit" onclick={() => clearKey(key)}>x</button>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet numberRow(label: string, key: keyof GenerationParams, hint = '')}
	{@const own = current(key)}
	{@const inherited = fallback(key)}
	<div class="grid grid-cols-[8rem_1fr_5rem] items-center gap-2">
		<label class="text-xs text-muted" for={`p-${key}`} title={hint}>{label}</label>
		<span class="text-xs text-faint">{hint}</span>
		<div class="flex items-center gap-1">
			<input
				id={`p-${key}`}
				class="field px-1.5 py-0.5 text-right text-xs"
				type="number"
				placeholder={inherited === null || inherited === undefined ? 'off' : String(inherited)}
				value={own ?? ''}
				oninput={(event) => setNumber(key, (event.currentTarget as HTMLInputElement).value)}
			/>
			{#if own !== undefined && own !== null}
				<button class="text-xs text-faint hover:text-danger" title="Inherit" onclick={() => clearKey(key)}>x</button>
			{/if}
		</div>
	</div>
{/snippet}

<div class="space-y-3">
	{#if overridden > 1}
		<div class="flex items-center justify-between">
			<span class="text-xs text-faint">{overridden} fields set</span>
			<button
				class="btn px-2 py-0.5 text-xs"
				onclick={() => onchange(Object.fromEntries(Object.keys(value).map((key) => [key, undefined])))}>
				Clear all
			</button>
		</div>
	{/if}

	{#if showSystem}
		<div>
			<label class="text-xs text-muted" for="p-system">System prompt</label>
			{#if systemPresets.length}
				<select
					class="field mt-1 w-full text-xs"
					aria-label="Use a saved system prompt"
					value=""
					onchange={usePreset}
				>
					<option value="">Use a saved prompt</option>
					{#each systemPresets as entry (entry.id)}
						<option value={entry.id}>{entry.title}</option>
					{/each}
				</select>
			{/if}
			<textarea
				id="p-system"
				class="field mt-1 min-h-20 font-sans text-xs"
				placeholder={mode === 'override' ? defaults.system : 'You are a helpful assistant.'}
				value={value.system ?? ''}
				oninput={(event) => set('system', (event.currentTarget as HTMLTextAreaElement).value)}
			></textarea>
			{#if value.system}
				<button class="mt-1 text-xs text-faint hover:text-danger" onclick={() => clearKey('system')}>
					inherit the default prompt
				</button>
			{/if}
		</div>
	{/if}

	{@render sliderRow('Temperature', 'temperature', 0, 2, 0.05)}
	{@render sliderRow('Top P', 'topP', 0, 1, 0.05)}
	{@render sliderRow('Min P', 'minP', 0, 1, 0.01)}
	{@render numberRow('Top K', 'topK', '0 = provider default')}
	{@render numberRow('Max tokens', 'maxTokens', 'reply length cap')}
	{@render numberRow('Seed', 'seed', 'reproducible sampling')}
	{@render sliderRow('Frequency penalty', 'frequencyPenalty', -2, 2, 0.1)}
	{@render sliderRow('Presence penalty', 'presencePenalty', -2, 2, 0.1)}
	{@render sliderRow('Repetition penalty', 'repetitionPenalty', 0, 2, 0.01)}

	<div class="grid grid-cols-[8rem_1fr_5rem] items-center gap-2">
		<label class="text-xs text-muted" for="p-reasoning">Reasoning effort</label>
		<span class="text-xs text-faint">for models that expose it</span>
		<select
			id="p-reasoning"
			class="field px-1.5 py-0.5 text-xs"
			value={value.reasoningEffort ?? ''}
			onchange={(event) =>
				set('reasoningEffort', (event.currentTarget as HTMLSelectElement).value as ReasoningEffort)}
		>
			<option value="">inherit ({defaults.reasoningEffort})</option>
			<option value="low">low</option>
			<option value="medium">medium</option>
			<option value="high">high</option>
		</select>
	</div>

	<div class="grid grid-cols-[8rem_1fr_5rem] items-center gap-2">
		<label class="text-xs text-muted" for="p-toolchoice">Tool choice</label>
		<span class="text-xs text-faint">when tools are on</span>
		<select
			id="p-toolchoice"
			class="field px-1.5 py-0.5 text-xs"
			value={value.toolChoice ?? ''}
			onchange={(event) => set('toolChoice', (event.currentTarget as HTMLSelectElement).value as ToolChoice)}
		>
			<option value="">inherit ({defaults.toolChoice})</option>
			<option value="auto">auto</option>
			<option value="required">required</option>
			<option value="none">none</option>
		</select>
	</div>

	<div>
		<label class="text-xs text-muted" for="p-stop">Stop sequences, one per line</label>
		<textarea
			id="p-stop"
			class="field mt-1 min-h-14 font-mono text-xs"
			placeholder={defaults.stop.length ? defaults.stop.join('\n') : 'none'}
			value={(value.stop ?? []).join('\n')}
			oninput={(event) => {
				const lines = (event.currentTarget as HTMLTextAreaElement).value
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean);
				onchange({ stop: lines.length ? lines : mode === 'override' ? undefined : [] });
			}}
		></textarea>
	</div>

	<div>
		<label class="text-xs text-muted" for="p-extra">Extra request fields (JSON)</label>
		<textarea
			id="p-extra"
			class="field mt-1 min-h-16 font-mono text-xs"
			placeholder={'{ "chat_template_kwargs": { "enable_thinking": false } }'}
			value={value.extra ?? ''}
			oninput={(event) => set('extra', (event.currentTarget as HTMLTextAreaElement).value)}
		></textarea>
		<p class="mt-1 text-xs text-faint">
			Merged into the request body, except model, messages, stream and tools.
		</p>
	</div>
</div>
