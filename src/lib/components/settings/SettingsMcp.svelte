<script lang="ts">
	import { app } from '$lib/client/state.svelte';
	import type { McpServerStateDTO } from '$lib/shared/types';
	import Icon from '../Icon.svelte';

	/** A pasted Cursor config, and what the last MCP action answered. */
	let mcpJson = $state('');
	let mcpNote = $state('');

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
	async function testMcp(server: McpServerStateDTO) {
		// The server holds the config, so the page only names the server to try.
		mcpNote = `${server.name}: ${await app.testMcpServer(server.id)}`;
	}

	/** The one line that says where a server comes from. */
	function describeMcp(server: McpServerStateDTO): string {
		const config = server.config;
		if (config.transport === 'http') return config.url ?? '';
		return [config.command, ...(config.args ?? [])].filter(Boolean).join(' ');
	}
</script>

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
