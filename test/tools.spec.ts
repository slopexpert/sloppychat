import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isApproveKey } from '$lib/client/tools';
import {
	TOOL_CATALOG,
	activeTools,
	advertisedTools,
	migrateToolModes,
	modeFor,
	toolMode,
	upstreamToolsFrom
} from '$lib/shared/tools';

/**
 * A tool is off, asked first, or on. Only the tools that are not off go to the
 * model, so a tool that is off costs no tokens at all.
 */

const search = TOOL_CATALOG.find((spec) => spec.name === 'web_search')!;

describe('tool modes', () => {
	it('uses the default of the catalog entry when the settings hold no choice', () => {
		expect(toolMode(search, undefined)).toBe('on');
		expect(toolMode(search, {})).toBe('on');
		expect(toolMode(search, { web_search: 'off' })).toBe('off');
		expect(toolMode(search, { web_search: 'ask' })).toBe('ask');
	});

	it('offers every tool that is not off, and keeps the skill tool gated', () => {
		const names = (input: Parameters<typeof advertisedTools>[0]) => advertisedTools(input).map((tool) => tool.name);
		expect(names({ modes: {}, skills: true })).toEqual(['web_search', 'read_skill', 'web_fetch']);
		expect(names({ modes: { web_search: 'off' }, skills: true })).toEqual(['read_skill', 'web_fetch']);
		expect(names({ modes: { web_fetch: 'ask' }, skills: true })).toContain('web_fetch');
		expect(names({ modes: {}, skills: false })).not.toContain('read_skill');
	});

	it('sends no schema for a tool that is off', () => {
		const offered = upstreamToolsFrom(advertisedTools({ modes: { web_fetch: 'off' }, skills: true }));
		expect(offered.map((tool) => tool.function.name)).toEqual(['web_search', 'read_skill']);
		expect(JSON.stringify(offered)).not.toContain('web_fetch');
	});

	it('takes a tool that arrived later, and asks first for it', () => {
		const extra = [
			{ name: 'files_read', description: 'Read one file.', parameters: { type: 'object' }, defaultMode: 'ask' as const }
		];
		expect(advertisedTools({ modes: {}, skills: false, extra }).map((tool) => tool.name)).toEqual([
			'web_search',
			'web_fetch',
			'files_read'
		]);
		expect(modeFor('files_read', {}, extra)).toBe('ask');
		expect(modeFor('files_read', { files_read: 'on' }, extra)).toBe('on');
		expect(modeFor('files_read', { files_read: 'off' }, extra)).toBe('off');
		// A name nobody registered stays out.
		expect(modeFor('nobody', {}, extra)).toBe('off');
	});

	it('counts the active tools for the menu badge', () => {
		expect(activeTools(undefined)).toHaveLength(TOOL_CATALOG.length);
		expect(activeTools({ web_search: 'off', web_fetch: 'off' }).map((spec) => spec.name)).toEqual(['read_skill']);
	});
});

describe('tool mode migration', () => {
	it('turns the old booleans into modes', () => {
		expect(migrateToolModes({ webSearch: false, webFetch: true })).toEqual({
			web_search: 'off',
			web_fetch: 'on'
		});
		expect(migrateToolModes({})).toEqual({});
	});

	it('keeps a stored mode, even when an old boolean is still in the row', () => {
		expect(migrateToolModes({ modes: { web_search: 'ask' }, webSearch: false })).toEqual({
			web_search: 'ask'
		});
	});
});

/**
 * The store reads the database path when the module loads, so the data directory
 * must be set before the first server import.
 */
process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-tools-'));
const db = await import('$lib/server/db');
const store = await import('$lib/server/store');

describe('the stored settings', () => {
	it('reads a row that still holds the old booleans', () => {
		db.run(
			'INSERT INTO settings (id, data) VALUES (1, ?)',
			JSON.stringify({ tools: { webSearch: false, webFetch: true, maxRounds: 4 } })
		);
		const settings = store.getSettings();
		expect(settings.tools.modes).toEqual({ web_search: 'off', web_fetch: 'on' });
		expect(settings.tools.maxRounds).toBe(4);
	});

	it('stores the modes and drops the old keys', () => {
		const before = store.getSettings();
		const saved = store.saveSettings({
			tools: { ...before.tools, modes: { ...before.tools.modes, web_search: 'ask' } }
		});
		expect(saved.tools.modes).toEqual({ web_search: 'ask', web_fetch: 'on' });
		const row = db.one('SELECT data FROM settings WHERE id = 1');
		expect(String(row?.data)).not.toContain('webSearch');
	});
});

/** The tools run on the server now, so the module is tested on its own. */
const serverTools = await import('$lib/server/tools');
const mcpRegistry = await import('$lib/server/mcp/registry');

describe('running a tool on the server', () => {
	it('reads a skill out of the store', async () => {
		store.saveSkill({
			name: 'release-notes',
			description: 'Use when the user asks for release notes.',
			body: '# Release notes\n\nCollect the merged pull requests.'
		});
		const run = await serverTools.runTool(
			{ id: 'call_1', name: 'read_skill', args: { name: 'release-notes' } },
			store.getSettings()
		);
		expect(run.isError).toBeUndefined();
		expect(run.content).toContain('Collect the merged pull requests');
		expect(run.detail).toContain('release-notes');
	});

	it('answers an unknown tool with an error result', async () => {
		const run = await serverTools.runTool({ id: 'call_1', name: 'nope', args: {} }, store.getSettings());
		expect(run.isError).toBe(true);
		expect(run.content).toContain('Unknown tool');
	});

	it('reports the mode of a tool, and off for a name outside the catalog', async () => {
		// Build the settings here, so the stored rows of the tests above do not matter.
		const base = store.getSettings();
		const settings = { ...base, tools: { ...base.tools, modes: {} } };
		expect(await serverTools.modeOf('web_search', settings)).toBe('on');
		expect(
			await serverTools.modeOf('web_search', {
				...settings,
				tools: { ...settings.tools, modes: { web_search: 'off' } }
			})
		).toBe('off');
		expect(await serverTools.modeOf('nope', settings)).toBe('off');
	});
});

describe('the allow once key', () => {
	it('accepts Enter alone', () => {
		expect(isApproveKey({ key: 'Enter' })).toBe(true);
		expect(isApproveKey({ key: 'Enter', target: { tagName: 'BUTTON' } })).toBe(true);
		expect(isApproveKey({ key: 'Enter', target: { tagName: 'DIV' } })).toBe(true);
	});

	it('ignores other keys and other modifiers', () => {
		expect(isApproveKey({ key: 'a' })).toBe(false);
		expect(isApproveKey({ key: ' ' })).toBe(false);
		expect(isApproveKey({ key: 'Enter', shiftKey: true })).toBe(false);
		expect(isApproveKey({ key: 'Enter', ctrlKey: true })).toBe(false);
		expect(isApproveKey({ key: 'Enter', metaKey: true })).toBe(false);
		expect(isApproveKey({ key: 'Enter', altKey: true })).toBe(false);
	});

	it('leaves Enter to a field that holds text', () => {
		expect(isApproveKey({ key: 'Enter', target: { tagName: 'TEXTAREA', value: 'hello' } })).toBe(false);
		expect(isApproveKey({ key: 'Enter', target: { tagName: 'INPUT', value: 'hi' } })).toBe(false);
		expect(isApproveKey({ key: 'Enter', target: { tagName: 'SELECT' } })).toBe(false);
		expect(isApproveKey({ key: 'Enter', target: { isContentEditable: true } })).toBe(false);
	});

	it('takes Enter from an empty field, where it does nothing else', () => {
		expect(isApproveKey({ key: 'Enter', target: { tagName: 'TEXTAREA', value: '' } })).toBe(true);
		expect(isApproveKey({ key: 'Enter', target: { tagName: 'TEXTAREA', value: '   ' } })).toBe(true);
		expect(isApproveKey({ key: 'Enter', target: { tagName: 'INPUT', value: '' } })).toBe(true);
	});
});

/** An MCP server from the test fixture, so a real call goes through the registry. */
async function connectFixtureServer(): Promise<string> {
	const server = store.createMcpServer({
		name: 'echo',
		config: {
			transport: 'stdio',
			command: process.execPath,
			args: ['test/fixtures/mcp-echo.mjs'],
			timeoutMs: 5000
		}
	});
	// The first call opens the connection and lists the tools, so a name is known.
	await mcpRegistry.mcpTools();
	return server.id;
}

afterAll(() => {
	// The fixture is a child process, so the test must close it.
	mcpRegistry.closeMcpServers();
});

describe('a tool from an MCP server', () => {
	it('runs it and turns the answer into text', async () => {
		await connectFixtureServer();
		const run = await serverTools.runTool(
			{ id: 'c1', name: 'echo_echo', args: { text: 'hello there' } },
			store.getSettings()
		);
		expect(run.isError).toBe(false);
		expect(run.content).toBe('echo: hello there');
		expect(run.detail).toContain('echo');
	});

	it('stores an image block and names it for the model', async () => {
		await connectFixtureServer();
		const run = await serverTools.runTool(
			{ id: 'c2', name: 'echo_picture', args: {} },
			store.getSettings()
		);
		const images = (run.data as { images?: { id: string; mime: string }[] } | undefined)?.images ?? [];
		expect(images).toHaveLength(1);
		expect(images[0].mime).toBe('image/png');
		expect(run.content).toContain('a picture');
		expect(store.getImage(images[0].id)?.mime).toBe('image/png');
	});

	it('asks first for a tool that has no choice yet', async () => {
		await connectFixtureServer();
		expect(await serverTools.modeOf('echo_echo', store.getSettings())).toBe('ask');
	});

	it('reports a server that stops as an error result', async () => {
		await connectFixtureServer();
		const run = await serverTools.runTool({ id: 'c3', name: 'echo_crash', args: {} }, store.getSettings());
		expect(run.isError).toBe(true);
		expect(run.content).toMatch(/stopped|closed|failed/i);
	});
});
