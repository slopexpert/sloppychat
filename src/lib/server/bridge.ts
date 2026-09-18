import { appendMessage, defaultProvider, enabledSkills, finalizeMessage, getConversation, getProvider, getSettings, listMessages, touchConversation } from './store';
import { streamChat, toUpstreamMessages, type ChatPayload } from './openai';
import { toolNamesFor, upstreamTools } from '$lib/shared/tools';
import { skillsSection } from '$lib/shared/skills';
import { parseExtra, PROTECTED_BODY_KEYS, resolveParams } from '$lib/shared/params';
import type { Message, Provider, RuntimeTimings, ToolCall, ToolResult, Usage } from '$lib/shared/types';
import type { SseWriter } from './sse';

/**
 * Drives one assistant turn: build the upstream payload, stream it into the
 * database row, and forward the deltas to the browser as SSE events. Tool calls
 * are executed by the browser, which posts results back to /api/chat/tools.
 */

export interface TurnRequest {
	conversationId: string;
	providerId?: string;
	model?: string;
	/** False skips tool advertisement, used when the user turns tools off. */
	useTools?: boolean;
}

export class TurnError extends Error {}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function resolveTarget(req: TurnRequest): { provider: Provider; model: string } {
	const conversation = getConversation(req.conversationId);
	if (!conversation) throw new TurnError('Conversation not found');
	const provider =
		(req.providerId && getProvider(req.providerId)) ||
		(conversation.providerId && getProvider(conversation.providerId)) ||
		defaultProvider();
	if (!provider) throw new TurnError('No provider configured. Open Settings > Providers and add one.');
	if (!provider.enabled) throw new TurnError(`Provider ${provider.name} is disabled`);
	const model = req.model || conversation.model || provider.defaultModel || '';
	if (!model) throw new TurnError(`Pick a model for ${provider.name} first`);
	return { provider, model };
}

/**
 * Builds the request body from the merged parameter layers and the stored
 * history. The `extra` JSON field is merged last so provider specific knobs win.
 */
function generationOptions(model: string, conversationId: string, useTools: boolean): ChatPayload {
	const settings = getSettings();
	const conversation = getConversation(conversationId);
	const params = resolveParams(
		settings.generation,
		conversation?.params,
		conversation?.system ? { system: conversation.system } : undefined
	);

	const payload: ChatPayload = { model, messages: [], stream: true, stream_options: { include_usage: true } };
	if (params.temperature !== null) payload.temperature = params.temperature;
	if (params.topP !== null) payload.top_p = params.topP;
	if (params.topK !== null) payload.top_k = params.topK;
	if (params.minP !== null) payload.min_p = params.minP;
	if (params.maxTokens !== null) payload.max_tokens = params.maxTokens;
	if (params.frequencyPenalty !== null) payload.frequency_penalty = params.frequencyPenalty;
	if (params.presencePenalty !== null) payload.presence_penalty = params.presencePenalty;
	if (params.repetitionPenalty !== null) payload.repetition_penalty = params.repetitionPenalty;
	if (params.seed !== null) payload.seed = params.seed;
	if (params.stop.length) payload.stop = params.stop;
	if (params.reasoningEffort !== 'auto') payload.reasoning_effort = params.reasoningEffort;

	// Skills are advertised by name and description; the text is loaded on demand.
	const skills = skillsSection(enabledSkills());
	const names = toolNamesFor({
		webSearch: settings.tools.webSearch,
		webFetch: settings.tools.webFetch,
		skills: skills.length > 0
	});
	if (useTools && names.length) {
		payload.tools = upstreamTools(names);
		payload.tool_choice = params.toolChoice;
	}

	const extra = parseExtra(params.extra);
	if (extra) {
		for (const [key, value] of Object.entries(extra)) {
			if (PROTECTED_BODY_KEYS.has(key)) continue;
			payload[key] = value;
		}
	}

	const history: Message[] = [];
	const system = [params.system.trim(), skills].filter(Boolean).join('\n\n');
	if (system) {
		history.push({
			id: 'system',
			conversationId,
			role: 'system',
			text: system,
			images: [],
			createdAt: ''
		});
	}
	history.push(...listMessages(conversationId));
	payload.messages = toUpstreamMessages(history, { docMaxChars: settings.tools.pdfMaxChars });
	return payload;
}

function isToolRejection(message: string): boolean {
	return /tool|function/i.test(message) && /(not support|unsupported|invalid|unknown|unexpected|extra|disable)/i.test(message);
}

/**
 * Adds timing to the provider usage, or estimates the counts when the provider
 * omitted them, which some local servers do. Estimated values are marked so the
 * interface can label them.
 */
function measure(
	upstream: Usage | undefined,
	timing: { textChars: number; promptChars: number; ttftMs: number; decodeMs: number },
	reported?: RuntimeTimings
): Usage {
	const estimatedCompletion = Math.ceil(timing.textChars / 4);
	const completion =
		upstream?.completion ?? reported?.completion ?? (timing.textChars ? estimatedCompletion : 0);
	const prompt = upstream?.prompt ?? reported?.prompt ?? Math.ceil(timing.promptChars / 4);
	return {
		prompt,
		completion,
		total: upstream?.total ?? prompt + completion,
		// Server side numbers exclude the network, so they win when offered.
		ttftMs: Math.max(0, reported?.ttftMs ?? timing.ttftMs),
		decodeMs: Math.max(0, reported?.decodeMs ?? timing.decodeMs),
		ppRate: reported?.ppRate,
		tgRate: reported?.tgRate,
		cachedPrompt: reported?.cachedPrompt,
		queueMs: reported?.queueMs,
		reported: reported ? true : undefined,
		estimated: upstream?.completion === undefined && reported?.completion === undefined
	};
}

/** Streams one assistant message and forwards deltas. Retries two known quirks. */
async function streamIntoAssistant(
	provider: Provider,
	payload: ChatPayload,
	assistantId: string,
	w: SseWriter,
	signal: AbortSignal
): Promise<void> {
	let textBuf = '';
	let reasoningBuf = '';
	let textAll = '';
	let reasonAll = '';
	let emitted = false;
	let lastFlush = Date.now();
	// Timing for the prefill and generation rates.
	const requestStart = Date.now();
	let firstTokenAt: number | undefined;

	const flush = () => {
		if (reasoningBuf) {
			w.send({ type: 'reasoning', text: reasoningBuf });
			reasoningBuf = '';
		}
		if (textBuf) {
			w.send({ type: 'text', text: textBuf });
			textBuf = '';
		}
		lastFlush = Date.now();
		if (emitted) finalizeMessage(assistantId, { text: textAll, reasoning: reasonAll || undefined });
	};

	const onDelta = (delta: { content?: string; reasoning?: string }) => {
		emitted = true;
		firstTokenAt ??= Date.now();
		if (delta.content) {
			textBuf += delta.content;
			textAll += delta.content;
		}
		if (delta.reasoning) {
			reasoningBuf += delta.reasoning;
			reasonAll += delta.reasoning;
		}
		// Coalesce tokens so a fast model does not flood the SSE channel.
		if (Date.now() - lastFlush >= 30) flush();
	};

	let result;
	for (let attempt = 0; ; attempt++) {
		try {
			result = await streamChat(provider, payload, onDelta, signal);
			break;
		} catch (err) {
			const message = errorMessage(err);
			if (!emitted && attempt === 0 && /stream_options/i.test(message)) {
				delete payload.stream_options;
				w.send({ type: 'notice', message: 'Provider rejects stream_options; usage totals are off for this turn' });
				continue;
			}
			if (!emitted && payload.tools && isToolRejection(message)) {
				payload = { ...payload, tools: undefined, tool_choice: undefined };
				w.send({ type: 'notice', message: `${provider.name} refused tool calls; answering without tools` });
				continue;
			}
			throw err;
		}
	}
	flush();

	const toolCalls: ToolCall[] = result.toolCalls.map((call) => ({
		id: call.id,
		name: call.name,
		args: parseArgs(call.argsText)
	}));

	// Prefill is request start to first token, generation is everything after it.
	const finishedAt = Date.now();
	const first = firstTokenAt ?? finishedAt;
	const usage = measure(
		result.usage,
		{
			textChars: (textAll + reasonAll).length,
			promptChars: JSON.stringify(payload.messages ?? []).length,
			ttftMs: first - requestStart,
			decodeMs: Math.max(0, finishedAt - first)
		},
		result.timings
	);

	finalizeMessage(assistantId, {
		text: result.content,
		reasoning: result.reasoning || undefined,
		toolCalls: toolCalls.length ? toolCalls : [],
		usage
	});
	for (const call of toolCalls) {
		w.send({ type: 'tool_call', call });
	}
	w.send({ type: 'done', finishReason: result.finishReason ?? 'stop', usage, messageId: assistantId });
}

function parseArgs(raw: string): unknown {
	try {
		return JSON.parse(raw || '{}');
	} catch {
		// Keep the partial text so the card can still show what the model meant.
		return raw;
	}
}

export async function runTurn(req: TurnRequest, w: SseWriter, signal: AbortSignal): Promise<void> {
	const { provider, model } = resolveTarget(req);
	const useTools = req.useTools !== false;
	const payload = generationOptions(model, req.conversationId, useTools);

	if (!payload.messages.length) throw new TurnError('Nothing to send: the conversation is empty');

	const assistant = appendMessage({ conversationId: req.conversationId, role: 'assistant', model });
	w.send({ type: 'start', messageId: assistant.id });
	// Recording the assistant row makes the conversation dirty, keep ordering sane.
	touchConversation(req.conversationId);

	try {
		await streamIntoAssistant(provider, payload, assistant.id, w, signal);
	} catch (err) {
		const message = errorMessage(err);
		// Partial text is already in the database, so a reload shows what arrived.
		if (signal.aborted) {
			w.send({ type: 'done', finishReason: 'aborted', messageId: assistant.id });
		} else {
			w.send({ type: 'error', message });
		}
	}
}

/** Stores browser tool results, then continues the same assistant turn chain. */
export async function continueWithToolResults(
	conversationId: string,
	results: ToolResult[],
	w: SseWriter,
	signal: AbortSignal
): Promise<void> {
	const messages = listMessages(conversationId);
	const nameByCall = new Map<string, string>();
	for (const msg of messages) {
		for (const call of msg.toolCalls ?? []) nameByCall.set(call.id, call.name);
	}
	const known = new Set<string>();
	for (const msg of messages) {
		if (msg.role === 'tool' && msg.toolCallId) known.add(msg.toolCallId);
	}
	for (const result of results) {
		if (!result.toolCallId || known.has(result.toolCallId)) continue;
		appendMessage({
			conversationId,
			role: 'tool',
			text: result.content,
			toolCallId: result.toolCallId,
			toolName: nameByCall.get(result.toolCallId) ?? 'tool',
			isError: result.isError === true
		});
	}
	await runTurn({ conversationId }, w, signal);
}
