import type { SearchResult } from '$lib/server/search';
import type { ToolCall, ToolResult } from '$lib/shared/types';
import { skillToolResult } from '$lib/shared/skills';
import { api, ApiError } from './api';

/**
 * Tool execution happens in the browser: the model asks, the client calls the
 * local endpoints and posts the results back. Nothing runs on the model's side.
 */

export interface ToolProgress {
	state: 'running' | 'done' | 'error';
	detail?: string;
	/** Structured payload for a richer card, for example search hits. */
	data?: unknown;
}

function asArgs(value: unknown): Record<string, unknown> {
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

function errorText(err: unknown): string {
	if (err instanceof ApiError) return err.message;
	if (err instanceof Error) return err.name === 'AbortError' ? 'Cancelled' : err.message;
	return String(err);
}

export interface ToolRunResult extends ToolResult {
	progress: ToolProgress;
}

/** Runs one tool call. Never throws: failures are returned as tool errors. */
export async function executeTool(
	call: ToolCall,
	maxResults: number,
	signal: AbortSignal
): Promise<ToolRunResult> {
	const args = asArgs(call.args);
	try {
		if (call.name === 'web_search') {
			const query = String(args.query ?? '').trim();
			if (!query) throw new Error('web_search needs a query');
			const wanted = Number(args.max_results ?? maxResults);
			const response = await api.search(query, Number.isFinite(wanted) ? wanted : maxResults, signal);
			return {
				toolCallId: call.id,
				content: response.text,
				progress: {
					state: 'done',
					detail: `${response.results.length} results from ${response.provider}`,
					data: response.results satisfies SearchResult[]
				}
			};
		}
		if (call.name === 'read_skill') {
			const name = String(args.name ?? '').trim();
			if (!name) throw new Error('read_skill needs a skill name');
			const { skill } = await api.readSkill(name);
			return {
				toolCallId: call.id,
				content: skillToolResult(skill),
				progress: {
					state: 'done',
					detail: `${skill.name}, ${skill.body.length} chars`,
					data: { url: '', mode: 'skill', title: skill.name }
				}
			};
		}
		if (call.name === 'web_fetch') {
			const url = String(args.url ?? '').trim();
			if (!url) throw new Error('web_fetch needs a url');
			const page = await api.fetchPage(url, args.raw === true, signal);
			return {
				toolCallId: call.id,
				content: page.text,
				progress: {
					state: 'done',
					detail: `${page.title ? `${page.title} - ` : ''}${page.markdown.length} chars, ${page.mode} mode${
						page.truncated ? ', trimmed' : ''
					}`,
					data: { url: page.url, mode: page.mode, title: page.title }
				}
			};
		}
		return {
			toolCallId: call.id,
			content: `Error: unknown tool "${call.name}"`,
			isError: true,
			progress: { state: 'error', detail: `Unknown tool ${call.name}` }
		};
	} catch (err) {
		const message = errorText(err);
		return {
			toolCallId: call.id,
			content: `Error: ${message}`,
			isError: true,
			progress: { state: 'error', detail: message }
		};
	}
}
