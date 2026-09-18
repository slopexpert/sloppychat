/** Shared shapes used by both the server routes and the browser UI. */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ImageRef {
	/** Image row id, also the id used in the /api/images/<id> route. */
	id: string;
	mime: string;
	name?: string;
	width?: number;
	height?: number;
}

export interface DocumentRef {
	id: string;
	name: string;
	pages: number;
	/** Characters of text extracted from the document. */
	chars: number;
}

/** A message held back until the running turn finishes. */
export interface QueuedMessage {
	id: string;
	text: string;
	images: ImageRef[];
	documents: DocumentRef[];
}

/** One MCP server, as the user configured it. */
export interface McpServerConfig {
	/** stdio starts a process, http dials a Streamable HTTP endpoint. */
	transport: 'stdio' | 'http';
	/** stdio: the program, its arguments, its environment and its directory. */
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	/** http: the endpoint and the headers it needs. */
	url?: string;
	headers?: Record<string, string>;
	/** Milliseconds one request may take. */
	timeoutMs?: number;
}

export interface McpServer {
	id: string;
	name: string;
	enabled: boolean;
	config: McpServerConfig;
	createdAt: string;
	updatedAt: string;
}

/** One tool of an MCP server, named the way the model sees it. */
export interface McpToolInfo {
	/** `<server>_<tool>`, the id used in the tools menu and in the request. */
	id: string;
	serverId: string;
	serverName: string;
	/** The name inside the server, which the call uses. */
	name: string;
	description: string;
	/** The JSON schema of the arguments, as the server describes them. */
	parameters: Record<string, unknown>;
}

/** What the settings window shows for one server. */
export interface McpServerState extends McpServer {
	status: 'ready' | 'failed' | 'stopped';
	error?: string;
	tools: McpToolInfo[];
}

export interface ToolCall {
	id: string;
	name: string;
	/** Parsed arguments. Raw JSON text while the stream is still arriving. */
	args: unknown;
	raw?: string;
}

export interface Usage {
	prompt?: number;
	completion?: number;
	total?: number;
	/** Milliseconds from request start to the first streamed token (prefill). */
	ttftMs?: number;
	/** Milliseconds spent streaming after the first token (generation). */
	decodeMs?: number;
	/** True when token counts were estimated from text length. */
	estimated?: boolean;
	/** Prefill tokens per second reported by the runtime itself. */
	ppRate?: number;
	/** Generation tokens per second reported by the runtime itself. */
	tgRate?: number;
	/** True when the timing above came from the server instead of this app. */
	reported?: boolean;
	/** Prompt tokens served from the prefix cache (llama.cpp cache_n). */
	cachedPrompt?: number;
	/** Time the request waited for a free slot, when the server reports it. */
	queueMs?: number;
	/** True when the answer stopped early, for example on stop or a crash. */
	interrupted?: boolean;
}

/** Timing numbers a server reports about its own work. */
export interface RuntimeTimings {
	source: 'llamacpp' | 'vllm';
	ppRate?: number;
	tgRate?: number;
	ttftMs?: number;
	decodeMs?: number;
	prompt?: number;
	completion?: number;
	cachedPrompt?: number;
	queueMs?: number;
}

export interface Message {
	id: string;
	conversationId: string;
	role: Role;
	text: string;
	/** Chain-of-thought text returned by reasoning models. */
	reasoning?: string;
	images: ImageRef[];
	/** Attached documents whose text is inlined for the model. */
	documents?: DocumentRef[];
	toolCalls?: ToolCall[];
	/** Set on role=tool messages: the call this message answers. */
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	model?: string;
	usage?: Usage;
	createdAt: string;
}

export interface Conversation {
	id: string;
	title: string;
	providerId: string | null;
	model: string | null;
	system: string | null;
	/** Per conversation overrides of DEFAULT_PARAMS. */
	params: Partial<GenerationParams>;
	createdAt: string;
	updatedAt: string;
	messageCount?: number;
}

export interface Provider {
	id: string;
	name: string;
	baseUrl: string;
	/** Never sent to the browser; only hasKey is exposed. */
	apiKey: string;
	kind: 'openai';
	defaultModel: string | null;
	enabled: boolean;
	sort: number;
	createdAt: string;
}

export interface ProviderDTO extends Omit<Provider, 'apiKey'> {
	hasKey: boolean;
}

export interface ModelInfo {
	id: string;
	name?: string;
	contextLength?: number;
	/** True when the upstream metadata says the model accepts images. */
	vision?: boolean;
}

export interface UpstreamTool {
	type: 'function';
	function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	domain: string;
	publishedDate?: string;
}

export interface SearchConfig {
	url: string;
	apiKey: string;
	maxResults: number;
}

export type ReasoningEffort = 'auto' | 'low' | 'medium' | 'high';
export type ToolChoice = 'auto' | 'none' | 'required';

/**
 * Everything that shapes a request. A null means "do not send this field",
 * which matters because vendors reject unknown or empty sampling values.
 */
export interface GenerationParams {
	system: string;
	temperature: number | null;
	topP: number | null;
	topK: number | null;
	minP: number | null;
	maxTokens: number | null;
	frequencyPenalty: number | null;
	presencePenalty: number | null;
	repetitionPenalty: number | null;
	seed: number | null;
	stop: string[];
	reasoningEffort: ReasoningEffort;
	toolChoice: ToolChoice;
	/** Raw JSON object merged into the request body for vendor specific fields. */
	extra: string;
}

export const DEFAULT_PARAMS: GenerationParams = {
	system: 'You are a helpful assistant. Answer in the language the user writes in.',
	temperature: null,
	topP: null,
	topK: null,
	minP: null,
	maxTokens: null,
	frequencyPenalty: null,
	presencePenalty: null,
	repetitionPenalty: null,
	seed: null,
	stop: [],
	reasoningEffort: 'auto',
	toolChoice: 'auto',
	extra: ''
};

export type FontChoice = 'system' | 'custom';
export type TextSizeChoice = 'small' | 'default' | 'large';
export type RadiusChoice = 'square' | 'small' | 'default' | 'large' | 'round';
export type DensityChoice = 'compact' | 'default' | 'spacious';

/** Everything the appearance tab controls. */
export interface ThemeSettings {
	/** Named palette, see src/lib/shared/themes.ts. The scheme follows the system. */
	name: string;
	font: FontChoice;
	/** Used when font is custom; a name or a whole family list. */
	fontFamily: string;
	textSize: TextSizeChoice;
	radius: RadiusChoice;
	density: DensityChoice;
}

export const DEFAULT_THEME: ThemeSettings = {
	name: 'sloppy',
	font: 'system',
	fontFamily: '',
	textSize: 'default',
	radius: 'default',
	density: 'default'
};

/** How a tool is offered to the model. */
export type ToolMode = 'off' | 'ask' | 'on';

export interface Settings {
	theme: ThemeSettings;
	search: SearchConfig;
	generation: GenerationParams;
	tools: {
		/** Mode per tool id. A tool with no entry uses the default of its catalog entry. */
		modes: Record<string, ToolMode>;
		maxRounds: number;
		fetchMaxChars: number;
		/** Lets web_fetch reach loopback and LAN addresses. Off by default. */
		fetchAllowPrivate: boolean;
		/** Render PDF pages to images for vision models. */
		pdfImages: boolean;
		/** Pages rendered per document. */
		pdfMaxImages: number;
		/** Characters of extracted PDF text sent to the model. */
		pdfMaxChars: number;
	};
	defaults: { providerId: string | null; model: string | null };
}

export const DEFAULT_SETTINGS: Settings = {
	theme: { ...DEFAULT_THEME },
	search: { url: '', apiKey: '', maxResults: 5 },
	generation: { ...DEFAULT_PARAMS },
	tools: {
		modes: {},
		maxRounds: 6,
		fetchMaxChars: 20000,
		fetchAllowPrivate: false,
		pdfImages: true,
		pdfMaxImages: 8,
		pdfMaxChars: 12000
	},
	defaults: { providerId: null, model: null }
};

/** Stream events sent from the chat endpoint to the browser over SSE. */
export type StreamEvent =
	/** Sent first on every attach, so a late client can pick up a running turn. */
	| {
			type: 'snapshot';
			messageId: string | null;
			text: string;
			reasoning: string;
			toolCalls: ToolCall[];
			running: boolean;
			/** A tool that waits for the user, so a reload still shows the card. */
			approval?: ToolCall | null;
	  }
	/** No turn is running for this conversation. */
	| { type: 'idle' }
	| { type: 'start'; messageId: string }
	| { type: 'text'; text: string; tokens?: number }
	| { type: 'reasoning'; text: string; tokens?: number }
	| { type: 'tool_call'; call: ToolCall }
	/** A tool finished on the server, with the text the model reads back. */
	| { type: 'tool_result'; toolCallId: string; isError: boolean; detail: string; data?: unknown }
	/** A tool waits for the user, because its mode is ask first. */
	| { type: 'tool_ask'; call: ToolCall }
	| { type: 'done'; finishReason: string; usage?: Usage; messageId: string }
	| { type: 'notice'; message: string }
	| { type: 'error'; message: string };

export interface ToolResult {
	toolCallId: string;
	content: string;
	isError?: boolean;
}

export interface ChatRequest {
	conversationId: string;
	providerId?: string;
	model?: string;
}
