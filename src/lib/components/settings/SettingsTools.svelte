<script lang="ts">
	import { app } from '$lib/client/state.svelte';
	import { save } from '$lib/client/settings-draft';
	import ToolList from '../ToolList.svelte';
</script>

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
		<h3 class="text-sm font-semibold">Text and code attachments</h3>
		<p class="text-xs text-faint">
			Plain files are sent as they are, inside a fence marked with the language. A binary
			file is refused, and a file over 2 MB is refused whole.
		</p>
		<label class="block max-w-64 text-xs text-muted">
			Characters per attached file
			<input
				class="field mt-1 text-sm"
				type="number"
				min="1000"
				max="500000"
				value={app.settings.tools.textMaxChars}
				onchange={(event) =>
					save({
						tools: {
							...app.settings.tools,
							textMaxChars: Number((event.currentTarget as HTMLInputElement).value) || 20000
						}
					})}
			/>
		</label>
	</div>

	<div class="card space-y-2 p-3">
		<h3 class="text-sm font-semibold">SearXNG</h3>
		<input
			class="field text-sm"
			placeholder="http://localhost:8888"
			value={app.settings.search.url}
			onchange={(event) =>
				save({ search: { url: (event.currentTarget as HTMLInputElement).value.trim() } })}
		/>
		<input
			class="field text-sm"
			type="password"
			placeholder={app.settings.search.hasKey ? 'API key is set, type to replace' : 'API key, optional'}
			value=""
			onchange={(event) => {
				// The key never comes back to the page, so an empty field says nothing:
				// only a typed key replaces the one that is stored.
				const value = (event.currentTarget as HTMLInputElement).value;
				if (value) save({ search: { apiKey: value } });
			}}
		/>
		{#if app.settings.search.hasKey}
		<button class="btn text-xs" onclick={() => save({ search: { apiKey: '' } })}>
			Remove key
		</button>
		{/if}
		<label class="text-xs text-muted">
			Results per search
			<input
				class="field mt-1 w-24 text-sm"
				type="number"
				min="1"
				max="10"
				value={app.settings.search.maxResults}
				onchange={(event) =>
					save({ search: { maxResults: Number((event.currentTarget as HTMLInputElement).value) || 5 } })}
			/>
		</label>
		<p class="text-xs text-faint">
			The instance needs <code>json</code> listed under <code>search.formats</code> in settings.yml.
		</p>
	</div>
</div>
