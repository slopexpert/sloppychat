import { appendMessage, defaultProvider, enabledSkills, finalizeMessage, getConversation, getMessage, getProvider, getSettings, listMessages, touchConversation } from './store';
import { streamChat, toUpstreamMessages, type ChatPayload } from './openai';
import { advertisedTools, upstreamToolsFrom } from '$lib/shared/tools';
import { skillsSection } from '$lib/shared/skills';
import { clockVars, expandPromptVars } from '$lib/shared/prompts';
import { parseExtra, PROTECTED_BODY_KEYS, resolveParams } from '$lib/shared/params';
import type { Message, Provider, RuntimeTimings, ToolCall, ToolMode, Usage } from '$lib/shared/types';
import type { SseWriter } from './sse';
import { modeOf, runTool } from './tools';
import { waitForApproval } from './approvals';
import { tokenSupport, countPrompt, type TokenSupport } from './tokens';
import { mcpTools } from './mcp/registry';

/**
 * Drives one assistant turn: build the upstream payload, stream it into the
 * database row, and forward the deltas to the browser as SSE events. The tools
 * run here too, so the turn finishes with no page open.
 */

export interface TurnRequest {
	conversationId: string;
	providerId?: string;
	model?: string;
	/** Continue this answer instead of starting a new one. */
	continueMessageId?: string;
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
async function generationOptions(model: string, conversationId: string, support?: TokenSupport): Promise<ChatPayload> {
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
	// Variables such as {{date}} or {{model}} are filled in on every request, so a
	// stored prompt can stay generic. A name the app does not know is left alone.
	const providerName =
		(conversation?.providerId ? getProvider(conversation.providerId)?.name : undefined) ??
		defaultProvider()?.name ??
		'';
	const system = [
		expandPromptVars(params.system.trim(), {
			...clockVars(),
			model,
			provider: providerName,
			chat: conversation?.title ?? ''
		}),
		skills
	].filter(Boolean).join('\n\n');
	const names = advertisedTools({
		modes: settings.tools.modes,
		skills: skills.length > 0,
		// Tools from MCP servers are advertised like the builtins, and a new one
		// asks first until the user decides otherwise.
		extra: (await mcpTools()).map((tool) => ({
			name: tool.id,
			description: tool.description || `A tool from the MCP server ${tool.serverName}.`,
			parameters: tool.parameters,
			defaultMode: 'ask' as ToolMode
		}))
	});
	if (names.length) {
		payload.tools = upstreamToolsFrom(names);
		payload.tool_choice = params.toolChoice;
	}

	const extra = parseExtra(params.extra);
	if (extra) {
		for (const [key, value] of Object.entries(extra)) {
			if (PROTECTED_BODY_KEYS.has(key)) continue;
			payload[key] = value;
		}
	}

	// Ask for the numbers this server can report about its own work. A server
	// that does not know these fields is never asked for them.
	if (support?.tokenIds) payload.return_token_ids = true;
	if (support?.perToken) payload.timings_per_token = true;

	const history: Message[] = [];
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
	payload.messages = toUpstreamMessages(history, {
		docMaxChars: settings.tools.pdfMaxChars,
		textMaxChars: settings.tools.textMaxChars
	});
	return payload;
}

/**
 * How a provider says it cannot take tools. A refusal word and a tool word have to
 * sit within a few characters of each other, either way round, because an ordinary
 * failure can hold both words far apart: "an unexpected error in the worker that
 * serves the tool server" must not cost a turn its tools.
 */
const TOOL_REJECTIONS = [
	/\b(?:tools?\b|function[ _]?call(?:ing)?|tool_choice)[^.\n]{0,24}(?:not support|unsupported|unrecognized|unknown|invalid|unexpected|not available|unavailable|disabled|does not (?:recogni[sz]e|support|know))/i,
	/(?:not support|unsupported|unrecognized|unknown|invalid|unexpected|not available|unavailable|disabled|does not (?:recogni[sz]e|support|know))[^.\n]{0,24}\b(?:tools?|function[ _]?call(?:ing)?|tool_choice)\b/i,
	// A server that does not know the field at all answers with a schema error.
	/extra (inputs|fields) are not permitted/i
];

/** True when the provider refused the tools of the request, not the request itself. */
export function isToolRejection(message: string): boolean {
	return TOOL_REJECTIONS.some((shape) => shape.test(message));
}

/**
 * Adds timing to the provider usage, or estimates the counts when the provider
 * omitted them, which some local servers do. Estimated values are marked so the
 * interface can label them.
 */
function measure(
	upstream: Usage | undefined,
	timing: {
		textChars: number;
		promptChars: number;
		ttftMs: number;
		decodeMs: number;
		/** Exact counts from the stream, when the server reports them. */
		promptTokens?: number;
		completionTokens?: number;
	},
	reported?: RuntimeTimings
): Usage {
	const estimatedCompletion = Math.ceil(timing.textChars / 4);
	// The order is exact first: the usage report, then the server timings, then
	// the count from the stream, and the character estimate last.
	const completion =
		upstream?.completion ??
		reported?.completion ??
		timing.completionTokens ??
		(timing.textChars ? estimatedCompletion : 0);
	const prompt =
		upstream?.prompt ?? reported?.prompt ?? timing.promptTokens ?? Math.ceil(timing.promptChars / 4);
	const counted = upstream?.completion !== undefined || reported?.completion !== undefined || timing.completionTokens !== undefined;
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
		estimated: counted ? undefined : true
	};
}

/** Streams one assistant message and forwards deltas. Retries two known quirks. */
async function streamIntoAssistant(
	provider: Provider,
	payload: ChatPayload,
	assistantId: string,
	w: SseWriter,
	signal: AbortSignal,
	/** Text the row already holds, when an answer is continued. */
	seed = { text: '', reasoning: '' }
): Promise<{ toolCalls: ToolCall[]; finishReason: string; usage: Usage }> {
	let textBuf = '';
	let reasoningBuf = '';
	let textAll = seed.text;
	let reasonAll = seed.reasoning;
	let emitted = false;
	let lastFlush = Date.now();
	/** Tokens the server counted for the chunks that are still buffered. */
	let tokenBuf = 0;
	// Timing for the prefill and generation rates.
	const requestStart = Date.now();
	let firstTokenAt: number | undefined;

	const flush = () => {
		const tokens = tokenBuf;
		tokenBuf = 0;
		if (reasoningBuf) {
			// The count rides on the answer when there is one, so a client never
			// counts the same tokens two times.
			w.send({ type: 'reasoning', text: reasoningBuf, tokens: textBuf ? 0 : tokens });
			reasoningBuf = '';
		}
		if (textBuf) {
			w.send({ type: 'text', text: textBuf, tokens });
			textBuf = '';
		}
		lastFlush = Date.now();
		if (emitted) finalizeMessage(assistantId, { text: textAll, reasoning: reasonAll || undefined });
	};

	const onDelta = (delta: { content?: string; reasoning?: string; tokens?: number }) => {
		emitted = true;
		firstTokenAt ??= Date.now();
		tokenBuf += delta.tokens ?? 0;
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
			decodeMs: Math.max(0, finishedAt - first),
			promptTokens: result.promptTokens,
			completionTokens: result.completionTokens
		},
		result.timings
	);

	// A stream that ended without a finish reason was cut short: an abort, or a
	// connection that died. The text is not a finished answer, so the row says so.
	const cut = !result.finishReason;

	finalizeMessage(assistantId, {
		// A continued answer keeps what it already had, then adds the rest.
		text: seed.text + result.content,
		reasoning: seed.reasoning + (result.reasoning || '') || undefined,
		toolCalls: toolCalls.length ? toolCalls : [],
		usage: cut ? { ...usage, interrupted: true } : usage,
		finishReason: result.finishReason ?? 'aborted'
	});
	for (const call of toolCalls) {
		w.send({ type: 'tool_call', call });
	}
	// The caller sends done, because a tool round continues the same turn.
	return { toolCalls, finishReason: result.finishReason ?? 'stop', usage };
}

function parseArgs(raw: string): unknown {
	try {
		return JSON.parse(raw || '{}');
	} catch {
		// Keep the partial text so the card can still show what the model meant.
		return raw;
	}
}

/**
 * Runs one turn to the end: stream an answer, run the tools it asks for on the
 * server, and continue until the model stops asking. A tool in the mode ask
 * first holds the turn until the user answers.
 */
export async function runTurn(req: TurnRequest, w: SseWriter, signal: AbortSignal): Promise<void> {
	const { provider, model } = resolveTarget(req);
	// The provider is asked one time what it can report about its own tokens.
	const support = await tokenSupport(provider);

	// Close anything a lost turn left open before the history goes upstream.
	closeDanglingToolCalls(req.conversationId);

	let payload = await generationOptions(model, req.conversationId, support);
	if (!payload.messages.length) throw new TurnError('Nothing to send: the conversation is empty');
	// A continued answer asks the server to carry on with the last message.
	const seed = req.continueMessageId ? getMessage(req.continueMessageId) : undefined;
	if (seed && support.continueFinal) {
		payload.continue_final_message = true;
		payload.add_generation_prompt = false;
	}

	// A continued answer grows one row. The text each round wrote has to be handed
	// to the next round, or that round writes over the answer before it.
	let carry = seed ? { text: seed.text, reasoning: seed.reasoning ?? '' } : undefined;

	for (let round = 0; ; round++) {
		const assistant = seed
			? seed
			: appendMessage({ conversationId: req.conversationId, role: 'assistant', model });
		w.send({ type: 'start', messageId: assistant.id });
		// Recording the assistant row makes the conversation dirty, keep ordering sane.
		touchConversation(req.conversationId);

		let result: { toolCalls: ToolCall[]; finishReason: string; usage: Usage };
		try {
			result = await streamIntoAssistant(provider, payload, assistant.id, w, signal, carry);
		} catch (err) {
			const message = errorMessage(err);
			// Partial text is already in the database, so a reload shows what arrived.
			if (signal.aborted) {
				w.send({ type: 'done', finishReason: 'aborted', messageId: assistant.id });
			} else {
				w.send({ type: 'error', message });
			}
			return;
		}

		if (signal.aborted) {
			w.send({ type: 'done', finishReason: 'aborted', messageId: assistant.id });
			return;
		}
		if (carry) {
			// The row now holds every round so far, so the next one adds to that.
			const grown = getMessage(assistant.id);
			carry = { text: grown?.text ?? carry.text, reasoning: grown?.reasoning ?? carry.reasoning };
		}
		if (!result.toolCalls.length) {
			w.send({ type: 'done', finishReason: result.finishReason, usage: result.usage, messageId: assistant.id });
			return;
		}
		const limit = getSettings().tools.maxRounds;
		if (round >= limit) {
			w.send({ type: 'notice', message: `Stopped after ${limit} tool rounds` });
			w.send({ type: 'done', finishReason: 'tool_limit', usage: result.usage, messageId: assistant.id });
			return;
		}

		for (const call of result.toolCalls) {
			// Read the settings again for each call, so a change during the turn
			// takes effect at once. Always allow writes the mode while a tool waits.
			const settings = getSettings();
			const mode = await modeOf(call.name, settings);
			if (mode === 'off') {
				writeToolRow(req.conversationId, call, 'Error: the user turned this tool off.', true);
				w.send({ type: 'tool_result', toolCallId: call.id, isError: true, detail: 'turned off' });
				continue;
			}
			if (mode === 'ask') {
				w.send({ type: 'tool_ask', call });
				const decision = await waitForApproval(req.conversationId, call, signal);
				if (signal.aborted) {
					w.send({ type: 'done', finishReason: 'aborted', messageId: assistant.id });
					return;
				}
				if (decision !== 'allow') {
					const why = decision === 'timeout' ? 'did not answer in time' : 'denied';
					writeToolRow(req.conversationId, call, `Error: the user ${why} this tool call.`, true);
					w.send({ type: 'tool_result', toolCallId: call.id, isError: true, detail: why });
					continue;
				}
			}
			const run = await runTool(call, settings, signal);
			if (signal.aborted) {
				w.send({ type: 'done', finishReason: 'aborted', messageId: assistant.id });
				return;
			}
			writeToolRow(req.conversationId, call, run.content, run.isError === true);
			w.send({
				type: 'tool_result',
				toolCallId: call.id,
				isError: run.isError === true,
				detail: run.detail,
				data: run.data
			});
		}

		// The results are in the history now, so the model answers them.
		payload = await generationOptions(model, req.conversationId, support);
	}
}

/**
 * The exact prompt count of a conversation, when the provider counts tokens
 * itself. The body is the one a turn would send, so the number matches the
 * prompt the model reads.
 */
export async function promptTokenCount(conversationId: string): Promise<number | undefined> {
	try {
		const { provider, model } = resolveTarget({ conversationId });
		const support = await tokenSupport(provider);
		if (support.counter === 'none') return undefined;
		return await countPrompt(provider, (await generationOptions(model, conversationId, support)).messages);
	} catch {
		// No provider, no model, or no tokenizer: the caller keeps its estimate.
		return undefined;
	}
}

/** Stores the result of one tool call, which is what the model reads back. */
function writeToolRow(conversationId: string, call: ToolCall, content: string, isError: boolean): void {
	appendMessage({
		conversationId,
		role: 'tool',
		text: content,
		toolCallId: call.id,
		toolName: call.name,
		isError
	});
}

/**
 * A turn that a restart killed leaves tool calls without an answer. Providers
 * refuse that history, so close each call before the next request goes out.
 */
function closeDanglingToolCalls(conversationId: string): void {
	const messages = listMessages(conversationId);
	const answered = new Set(
		messages
			.filter((message) => message.role === 'tool' && message.toolCallId)
			.map((message) => message.toolCallId as string)
	);
	// The list is the active line of the chat, so every row in it is one the
	// provider is about to see.
	for (const message of messages) {
		if (message.role !== 'assistant') continue;
		for (const call of message.toolCalls ?? []) {
			if (answered.has(call.id)) continue;
			// Marked here as well, so a call id that appears twice is closed once.
			answered.add(call.id);
			writeToolRow(conversationId, call, 'Error: the turn stopped before this tool ran.', true);
		}
	}
}
