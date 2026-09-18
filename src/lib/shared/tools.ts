import type { SearchResult, ToolMode, UpstreamTool } from './types';

/**
 * Tool catalog for the model plus the text shape each result is folded into.
 * The browser executes these tools, the server only supplies the network access.
 */

export type ToolName = 'web_search' | 'web_fetch' | 'read_skill';

export interface ToolSpec {
	name: ToolName;
	/** Shown in the tool card header. */
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	/** Mode used when the settings hold no choice for this tool. */
	defaultMode: ToolMode;
}

export const TOOL_CATALOG: ToolSpec[] = [
	{
		name: 'web_search',
		label: 'Search',
		defaultMode: 'on',
		description:
			'Search the web through SearXNG and return titles, URLs and snippets. Use it for anything outside the model knowledge, such as current events or library versions.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search terms. Keep them short and specific.'
				},
				max_results: {
					type: 'number',
					description: 'Number of results to return, 1 to 10. Default 5.'
				}
			},
			required: ['query']
		}
	},
	{
		name: 'read_skill',
		label: 'Skill',
		defaultMode: 'on',
		description:
			'Read one of the available skills and return its instructions. Call it when a task matches a skill listed in the system prompt, then follow what it returns.',
		parameters: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'Skill name exactly as listed in the system prompt.'
				}
			},
			required: ['name']
		}
	},
	{
		name: 'web_fetch',
		label: 'Fetch',
		defaultMode: 'on',
		description:
			'Read one URL and return its main content as reader mode markdown, with navigation, ads and comment threads removed. Follow web_search results with this tool to read a page in full.',
		parameters: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'Absolute http or https URL.' },
				raw: {
					type: 'boolean',
					description: 'Return the raw HTML instead of reader mode markdown. Default false.'
				}
			},
			required: ['url']
		}
	}
];

export function toolNamesFor(enabled: {
	/** Mode per tool id, from the settings. */
	modes?: Record<string, ToolMode>;
	/** True when at least one skill is enabled. */
	skills?: boolean;
}): ToolName[] {
	return TOOL_CATALOG.filter((spec) => {
		// A skill is only useful to the model when a skill exists to read.
		if (spec.name === 'read_skill' && !enabled.skills) return false;
		return toolMode(spec, enabled.modes) !== 'off';
	}).map((spec) => spec.name);
}

/** The mode of a tool: the stored choice, or the default of the catalog entry. */
export function toolMode(spec: ToolSpec, modes: Record<string, ToolMode> | undefined): ToolMode {
	return modes?.[spec.name] ?? spec.defaultMode;
}

/** The tools the model may call: every tool that is not off. */
export function activeTools(modes: Record<string, ToolMode> | undefined): ToolSpec[] {
	return TOOL_CATALOG.filter((spec) => toolMode(spec, modes) !== 'off');
}

/**
 * Old settings held one boolean per tool. Each boolean becomes a mode, and a mode
 * that the settings already hold wins, so this runs again after every save
 * without a change.
 */
export function migrateToolModes(saved: {
	modes?: Record<string, ToolMode>;
	webSearch?: boolean;
	webFetch?: boolean;
}): Record<string, ToolMode> {
	const modes: Record<string, ToolMode> = { ...(saved.modes ?? {}) };
	const fromBoolean = (id: ToolName, value: boolean | undefined): void => {
		if (typeof value === 'boolean' && modes[id] === undefined) modes[id] = value ? 'on' : 'off';
	};
	fromBoolean('web_search', saved.webSearch);
	fromBoolean('web_fetch', saved.webFetch);
	return modes;
}

export function upstreamTools(names: ToolName[]): UpstreamTool[] {
	return TOOL_CATALOG.filter((spec) => names.includes(spec.name)).map((spec) => ({
		type: 'function' as const,
		function: { name: spec.name, description: spec.description, parameters: spec.parameters }
	}));
}

/** Parses tool arguments. Raw JSON text while the stream is still arriving. */
export function toolArgs(value: unknown): Record<string, unknown> {
	if (value && typeof value === 'object') return value as Record<string, unknown>;
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
		} catch {
			/* keep the raw text below */
		}
		return { raw: value };
	}
	return {};
}

/** Renders a tool argument object the way the card header shows it. */
export function toolSummary(name: string, args: Record<string, unknown>): string {
	if (name === 'web_search') return String(args.query ?? '');
	if (name === 'web_fetch') return String(args.url ?? '');
	if (name === 'read_skill') return String(args.name ?? '');
	return JSON.stringify(args).slice(0, 120);
}

export function formatSearchResult(query: string, results: SearchResult[]): string {
	if (!results.length) return `No results for "${query}".`;
	const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   url: ${r.url}\n   ${r.snippet}`.trimEnd());
	return `Search results for "${query}":\n\n${lines.join('\n\n')}`;
}

export function formatPageResult(input: {
	url: string;
	title?: string;
	mode: string;
	markdown: string;
	truncated: boolean;
}): string {
	const header = [`url: ${input.url}`, input.title ? `title: ${input.title}` : '', `mode: ${input.mode}`]
		.filter(Boolean)
		.join('\n');
	return `${header}\n\n${input.markdown}${input.truncated ? '\n\n[page trimmed to the reader limit]' : ''}`;
}
