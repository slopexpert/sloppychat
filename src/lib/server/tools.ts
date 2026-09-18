import { TOOL_CATALOG, formatPageResult, formatSearchResult, toolArgs, toolMode } from '$lib/shared/tools';
import { skillToolResult } from '$lib/shared/skills';
import type { ImageRef, McpToolInfo, SearchResult, Settings, ToolCall, ToolMode } from '$lib/shared/types';
import { newId } from './db';
import { fetchPage } from './fetcher';
import { imageDims, sniffMime } from './images';
import { callMcpTool, mcpTools } from './mcp/registry';
import { searxngSearch } from './search';
import { getSkillByName, saveImage } from './store';

/**
 * The tools run here, not in the browser. A turn finishes on the server, so a
 * closed page changes nothing, and the mode ask first holds the turn until the
 * user answers. Only the tools that are not off reach the model at all.
 */

export interface ToolRun {
	/** Text the model reads as the tool result. */
	content: string;
	isError?: boolean;
	/** Short line for the tool card. */
	detail: string;
	/** Structured payload for a richer card, for example search hits. */
	data?: unknown;
}

/**
 * The mode of a tool: the stored choice, or off for a name the app does not
 * know. A tool from an MCP server that has no choice yet asks first.
 */
export async function modeOf(name: string, settings: Settings): Promise<ToolMode> {
	const spec = TOOL_CATALOG.find((tool) => tool.name === name);
	if (spec) return toolMode(spec, settings.tools.modes);
	const known = (await mcpTools()).some((tool) => tool.id === name);
	return known ? (settings.tools.modes[name] ?? 'ask') : 'off';
}

/** Runs one tool call. A failure comes back as an error result, never a throw. */
export async function runTool(
	call: ToolCall,
	settings: Settings,
	signal?: AbortSignal
): Promise<ToolRun> {
	const args = toolArgs(call.args);
	try {
		// A tool that is not a builtin may come from an MCP server.
		const mcp = (await mcpTools()).find((tool) => tool.id === call.name);
		if (mcp) return await runMcpTool(mcp, args, signal);
		if (call.name === 'web_search') {
			const query = String(args.query ?? '').trim();
			if (!query) throw new Error('web_search needs a query');
			const wanted = Number(args.max_results ?? settings.search.maxResults);
			const response = await searxngSearch(
				settings.search,
				query,
				Number.isFinite(wanted) ? wanted : settings.search.maxResults,
				signal
			);
			return {
				content: formatSearchResult(query, response.results),
				detail: `${response.results.length} results from ${response.provider}`,
				data: response.results satisfies SearchResult[]
			};
		}
		if (call.name === 'web_fetch') {
			const url = String(args.url ?? '').trim();
			if (!url) throw new Error('web_fetch needs a url');
			const page = await fetchPage(url, {
				raw: args.raw === true,
				maxChars: settings.tools.fetchMaxChars,
				allowPrivate: settings.tools.fetchAllowPrivate,
				signal
			});
			return {
				content: formatPageResult({
					url: page.url,
					title: page.title,
					mode: page.mode,
					markdown: page.markdown,
					truncated: page.truncated
				}),
				detail: `${page.title ? `${page.title} - ` : ''}${page.markdown.length} chars, ${page.mode} mode${
					page.truncated ? ', trimmed' : ''
				}`,
				data: { url: page.url, mode: page.mode, title: page.title }
			};
		}
		if (call.name === 'read_skill') {
			const name = String(args.name ?? '').trim();
			if (!name) throw new Error('read_skill needs a skill name');
			const skill = getSkillByName(name);
			if (!skill || !skill.enabled) throw new Error(`No skill named ${name}`);
			return {
				content: skillToolResult(skill),
				detail: `${skill.name}, ${skill.body.length} chars`,
				data: { url: '', mode: 'skill', title: skill.name }
			};
		}
		throw new Error(`Unknown tool ${call.name}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { content: `Error: ${message}`, isError: true, detail: message };
	}
}

/**
 * Runs one MCP tool and turns its content blocks into text for the model. An
 * image block is stored like an attachment and named in the text.
 */
async function runMcpTool(
	tool: McpToolInfo,
	args: Record<string, unknown>,
	signal?: AbortSignal
): Promise<ToolRun> {
	try {
		const result = await callMcpTool(tool.id, args, signal);
		const pieces: string[] = [];
		const images: ImageRef[] = [];
		for (const block of result.content) {
			const record = block as Record<string, unknown>;
			if (record.type === 'text' && typeof record.text === 'string') {
				pieces.push(record.text);
				continue;
			}
			if (record.type === 'image' && typeof record.data === 'string') {
				const bytes = new Uint8Array(Buffer.from(record.data, 'base64'));
				const mime =
					(typeof record.mimeType === 'string' ? record.mimeType : sniffMime(bytes)) ?? 'image/png';
				const id = newId();
				saveImage(id, mime, bytes);
				const dims = imageDims(bytes, mime);
				images.push({
					id,
					mime,
					name: `${tool.serverName} ${tool.name}`,
					width: dims?.width,
					height: dims?.height
				});
				pieces.push(`[image from ${tool.serverName}, shown with the result]`);
				continue;
			}
			// Any other block is passed on as JSON, so nothing is lost.
			pieces.push(JSON.stringify(block));
		}
		return {
			content: pieces.join('\n').trim() || '(the tool returned nothing)',
			isError: result.isError === true,
			detail: `${tool.serverName}: ${tool.name}${images.length ? `, ${images.length} image` : ''}`,
			data: images.length ? { images } : undefined
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { content: `Error: ${message}`, isError: true, detail: message };
	}
}
