import type { Skill } from '$lib/shared/skills';
import type {
	Conversation,
	DocumentRef,
	GenerationParams,
	ImageRef,
	Message,
	ModelInfo,
	ProviderDTO,
	QueuedMessage,
	Settings,
	StreamEvent,
	ToolResult
} from '$lib/shared/types';

/** Thin fetch layer for the app's own endpoints. */

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, {
		...init,
		headers: init?.body instanceof FormData ? init.headers : { 'content-type': 'application/json', ...init?.headers }
	});
	if (!res.ok) {
		let message = `HTTP ${res.status}`;
		try {
			const body = (await res.json()) as { error?: string };
			if (body.error) message = body.error;
		} catch {
			/* keep the status text */
		}
		throw new ApiError(message, res.status);
	}
	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
}

export const api = {
	getSettings: () => request<Settings>('/api/settings'),
	saveSettings: (patch: Partial<Settings>) =>
		request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),

	listProviders: () => request<{ providers: ProviderDTO[] }>('/api/providers'),
	createProvider: (input: Partial<ProviderDTO> & { apiKey?: string }) =>
		request<{ provider: ProviderDTO }>('/api/providers', { method: 'POST', body: JSON.stringify(input) }),
	updateProvider: (id: string, patch: Partial<ProviderDTO> & { apiKey?: string }) =>
		request<{ provider: ProviderDTO }>(`/api/providers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
	deleteProvider: (id: string) => request<{ ok: true }>(`/api/providers/${id}`, { method: 'DELETE' }),
	listModels: (id: string, signal?: AbortSignal) =>
		request<{ models: ModelInfo[]; count: number }>(`/api/providers/${id}/models`, { signal }),

	listConversations: () => request<{ conversations: Conversation[] }>('/api/conversations'),
	createConversation: (input: Partial<Conversation> = {}) =>
		request<{ conversation: Conversation }>('/api/conversations', { method: 'POST', body: JSON.stringify(input) }),
	getConversation: (id: string) =>
		request<{ conversation: Conversation; messages: Message[]; queued: QueuedMessage[] }>(
			`/api/conversations/${id}`
		),
	updateConversation: (id: string, patch: Partial<Conversation>) =>
		request<{ conversation: Conversation }>(`/api/conversations/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		}),
	deleteConversation: (id: string) => request<{ ok: true }>(`/api/conversations/${id}`, { method: 'DELETE' }),

	addMessage: (conversationId: string, input: { text: string; images?: ImageRef[]; documents?: DocumentRef[] }) =>
		request<{ message: Message }>(`/api/conversations/${conversationId}/messages`, {
			method: 'POST',
			body: JSON.stringify(input)
		}),
	/** Holds a message until the turn in flight finishes. */
	queueMessage: (
		conversationId: string,
		input: { text: string; images?: ImageRef[]; documents?: DocumentRef[] }
	) =>
		request<{ queued: QueuedMessage }>(`/api/conversations/${conversationId}/queue`, {
			method: 'POST',
			body: JSON.stringify(input)
		}),
	deleteQueued: (conversationId: string, id: string) =>
		request<{ ok: true }>(`/api/conversations/${conversationId}/queue/${id}`, { method: 'DELETE' }),

	deleteFrom: (conversationId: string, messageId: string) =>
		request<{ removed: number }>(`/api/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' }),

	uploadImage: (file: File) => {
		const form = new FormData();
		form.append('file', file);
		return request<{ image: ImageRef }>('/api/images', { method: 'POST', body: form });
	},

	stopTurn: (conversationId: string) =>
		request<{ stopped: boolean }>('/api/chat/stop', {
			method: 'POST',
			body: JSON.stringify({ conversationId })
		}),

	/** Answers the tool request that holds a turn, when its mode is ask first. */
	approveTool: (conversationId: string, toolCallId: string, decision: 'allow' | 'deny', always = false) =>
		request<{ answered: boolean }>('/api/chat/approve', {
			method: 'POST',
			body: JSON.stringify({ conversationId, toolCallId, decision, always })
		}),

	listSkills: () => request<{ skills: Skill[] }>('/api/skills'),
	readSkill: (name: string) => request<{ skill: Skill }>(`/api/skills?name=${encodeURIComponent(name)}`),
	createSkill: (input: { name: string; description?: string; body?: string }) =>
		request<{ skill: Skill }>('/api/skills', { method: 'POST', body: JSON.stringify(input) }),
	uploadSkills: (files: File[]) => {
		const form = new FormData();
		for (const file of files) form.append('file', file, file.name);
		return request<{ skills: Skill[] }>('/api/skills', { method: 'POST', body: form });
	},
	updateSkill: (id: string, patch: Partial<Skill>) =>
		request<{ skill: Skill }>(`/api/skills/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
	deleteSkill: (id: string) => request<{ ok: true }>(`/api/skills/${id}`, { method: 'DELETE' }),

	uploadDocument: (file: File) => {
		const form = new FormData();
		form.append('file', file);
		return request<{ document: DocumentRef; images: ImageRef[]; preview: string }>('/api/documents', {
			method: 'POST',
			body: form
		});
	},

	search: (query: string, maxResults: number, signal?: AbortSignal) =>
		request<{
			query: string;
			provider: string;
			results: { title: string; url: string; snippet: string; domain: string }[];
			text: string;
		}>('/api/search', { method: 'POST', body: JSON.stringify({ query, max_results: maxResults }), signal }),

	fetchPage: (url: string, raw: boolean, signal?: AbortSignal) =>
		request<{
			url: string;
			title?: string;
			mode: string;
			markdown: string;
			truncated: boolean;
			text: string;
		}>('/api/fetch', { method: 'POST', body: JSON.stringify({ url, raw }), signal })
};

/** Reads our SSE stream and calls the handler for every parsed event. */
export async function readEventStream(
	res: Response,
	onEvent: (event: StreamEvent) => void
): Promise<void> {
	if (!res.body) throw new ApiError('The server sent no stream body', res.status);
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let cut = buffer.indexOf('\n\n');
		while (cut !== -1) {
			const frame = buffer.slice(0, cut);
			buffer = buffer.slice(cut + 2);
			for (const line of frame.split(/\r?\n/)) {
				if (!line.startsWith('data:')) continue;
				const payload = line.slice(5).trim();
				if (!payload) continue;
				try {
					onEvent(JSON.parse(payload) as StreamEvent);
				} catch {
					/* ignore malformed frames */
				}
			}
			cut = buffer.indexOf('\n\n');
		}
	}
}

/** Opens a GET event stream, used to attach to a running turn. */
export async function getStream(
	url: string,
	signal: AbortSignal,
	onEvent: (event: StreamEvent) => void
): Promise<void> {
	const res = await fetch(url, { headers: { accept: 'text/event-stream' }, signal });
	if (!res.ok) {
		let message = `HTTP ${res.status}`;
		try {
			const parsed = (await res.json()) as { error?: string };
			if (parsed.error) message = parsed.error;
		} catch {
			/* keep the status text */
		}
		throw new ApiError(message, res.status);
	}
	await readEventStream(res, onEvent);
}

/** Posts a streaming chat request and forwards its events. */
export async function postStream(
	url: string,
	body: unknown,
	signal: AbortSignal,
	onEvent: (event: StreamEvent) => void
): Promise<void> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal
	});
	if (!res.ok) {
		let message = `HTTP ${res.status}`;
		try {
			const parsed = (await res.json()) as { error?: string };
			if (parsed.error) message = parsed.error;
		} catch {
			/* keep the status text */
		}
		throw new ApiError(message, res.status);
	}
	await readEventStream(res, onEvent);
}

export type { ToolResult, GenerationParams };
