import {
	DEFAULT_PARAMS,
	DEFAULT_SETTINGS,
	DEFAULT_THEME,
	type Conversation,
	type DocumentRef,
	type ImageRef,
	type Message,
	type ModelInfo,
	type ProviderDTO,
	type Settings,
	type StreamEvent,
	type ThemeSettings,
	type ToolCall,
	type ToolMode,
	type ToolResult
} from '$lib/shared/types';
import type { Skill } from '$lib/shared/skills';
import { resolveParams } from '$lib/shared/params';
import { TOOL_CATALOG } from '$lib/shared/tools';
import { contextUsage, liveRate, ratePerSecond } from '$lib/shared/stats';
import { resolveTheme } from '$lib/shared/themes';
import { fontChoice, fontStack } from '$lib/shared/fonts';
import { api, getStream, postStream } from './api';
import { replaceState } from '$app/navigation';
import { applyFavicon } from './favicon';
import type { ToolProgress } from './tools';
import type { GenerationParams } from '$lib/shared/types';

/** Single store for the whole app. Svelte 5 runes keep every view in sync. */

export interface Toast {
	id: number;
	kind: 'info' | 'error' | 'ok';
	text: string;
}

/** A PDF attached to the next message, with its rendered page images. */
export interface PendingDocument {
	document: DocumentRef;
	images: ImageRef[];
	/** False when the picked model cannot look at images. */
	sendImages: boolean;
}

/** A message held back until the running turn finishes. */
export interface QueuedMessage {
	id: string;
	text: string;
	images: ImageRef[];
	documents: DocumentRef[];
}

const THEME_KEY = 'sloppychat:theme';
const TOAST_MS = 7000;

export function errorText(err: unknown): string {
	if (err instanceof Error) return err.name === 'AbortError' ? 'Cancelled' : err.message;
	return String(err);
}

function isPdf(file: File): boolean {
	return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export class AppState {
	ready = $state(false);
	settings = $state<Settings>(structuredClone(DEFAULT_SETTINGS));
	providers = $state<ProviderDTO[]>([]);
	conversations = $state<Conversation[]>([]);
	conversation = $state<Conversation | null>(null);
	messages = $state<Message[]>([]);
	skills = $state<Skill[]>([]);
	models = $state<Record<string, ModelInfo[]>>({});
	modelsLoading = $state<Record<string, boolean>>({});
	modelsError = $state<Record<string, string>>({});
	running = $state(false);
	/** True while the server has a turn in flight for this conversation. */
	turnRunning = $state(false);
	/** Estimated prefill speed while the model is still reading the prompt. */
	prefillRate = $state<number | undefined>(undefined);
	/** True between sending and the first token, when the prompt is being read. */
	prefilling = $state(false);
	liveMessageId = $state<string | null>(null);
	/** Estimated generation speed while a turn is streaming. */
	liveRate = $state<number | undefined>(undefined);
	#streamChars = 0;
	#streamFirstAt: number | null = null;
	/** Rough prompt size for the turn in flight, used for the prefill rate. */
	#promptTokens = 0;
	#requestStartedAt = 0;
	#prefillTicker: ReturnType<typeof setInterval> | undefined;
	toolProgress = $state<Record<string, ToolProgress>>({});
	toasts = $state<Toast[]>([]);
	/** Messages typed while a turn was streaming, sent in order afterwards. */
	queued = $state<QueuedMessage[]>([]);
	pendingImages = $state<ImageRef[]>([]);
	pendingDocuments = $state<PendingDocument[]>([]);
	uploading = $state(false);
	showSettings = $state(false);
	showParams = $state(false);
	sidebarOpen = $state(true);
	/** True on a narrow viewport, where the chat list becomes a drawer. */
	narrow = $state(false);
	/** The control that opens the drawer, so focus can go back to it. */
	sidebarTrigger: HTMLElement | null = null;

	#controller: AbortController | null = null;
	#toastId = 0;
	#draining = false;
	#pickingModel = false;

	get provider(): ProviderDTO | undefined {
		const id = this.conversation?.providerId ?? this.settings.defaults.providerId;
		return this.providers.find((p) => p.id === id) ?? this.providers.find((p) => p.enabled);
	}

	get model(): string {
		return this.conversation?.model ?? this.settings.defaults.model ?? this.provider?.defaultModel ?? '';
	}

	get availableModels(): ModelInfo[] {
		const provider = this.provider;
		return provider ? (this.models[provider.id] ?? []) : [];
	}

	/** Parameters this conversation will actually send, including inherited ones. */
	get params(): GenerationParams {
		return resolveParams(
			this.settings.generation,
			this.conversation?.params,
			this.conversation?.system ? { system: this.conversation.system } : undefined
		);
	}

	get overriddenParams(): number {
		const own = this.conversation?.params ?? {};
		const keys = Object.keys(own).filter((key) => {
			const value = (own as Record<string, unknown>)[key];
			if (value === undefined || value === null) return false;
			if (Array.isArray(value)) return value.length > 0;
			if (typeof value === 'string') return value.trim() !== '';
			return true;
		});
		return keys.length;
	}

	/* ------------------------------------------------------------- lifecycle */

	async init(): Promise<void> {
		applyTheme(this.settings.theme);
		try {
			const [settings, providers, conversations] = await Promise.all([
				api.getSettings(),
				api.listProviders(),
				api.listConversations()
			]);
			this.settings = settings;
			this.providers = providers.providers;
			this.conversations = conversations.conversations;
			void this.refreshSkills();
			applyTheme(settings.theme);
			// The address bar remembers the chat, so a reload opens the same one.
			const wanted = this.#conversationFromUrl();
			const known = wanted ? this.conversations.find((item) => item.id === wanted) : undefined;
			if (known) await this.open(known.id);
			else if (this.conversations.length) await this.open(this.conversations[0].id);
			else await this.newConversation();
			// Model lists load in the background; ensureModel runs again per list.
			void this.refreshAllModels();
			void this.ensureModel();
		} catch (err) {
			this.toast('error', errorText(err));
		} finally {
			this.ready = true;
		}
	}

	/** Light and dark always follow the system preference. */
	watchSystemTheme(): () => void {
		const media = matchMedia('(prefers-color-scheme: dark)');
		const handler = () => applyTheme(this.settings.theme);
		media.addEventListener('change', handler);
		return () => media.removeEventListener('change', handler);
	}

	/**
	 * The chat list is a column when there is room and a drawer when there is not,
	 * so the width of the window decides which one it is and whether it starts
	 * open: a drawer would cover the conversation, a column would not.
	 */
	watchViewport(): () => void {
		const query = matchMedia('(max-width: 767px)');
		const apply = () => {
			if (query.matches === this.narrow) return;
			this.narrow = query.matches;
			this.sidebarOpen = !query.matches;
		};
		apply();
		query.addEventListener('change', apply);
		return () => query.removeEventListener('change', apply);
	}

	/** Closes the chat list, handing focus back to the control that opened it. */
	closeSidebar(): void {
		this.sidebarOpen = false;
		if (this.narrow) this.sidebarTrigger?.focus();
	}

	toggleSidebar(): void {
		if (this.sidebarOpen) this.closeSidebar();
		else this.sidebarOpen = true;
	}

	/* --------------------------------------------------------- conversations */

	async refreshConversations(): Promise<void> {
		const { conversations } = await api.listConversations();
		this.conversations = conversations;
	}

	async newConversation(): Promise<void> {
		// A new chat inherits the provider and model that are in view.
		const providerId = this.conversation?.providerId ?? this.provider?.id ?? null;
		const model = this.conversation?.model ?? this.pickModel(providerId);
		const { conversation } = await api.createConversation({
			providerId,
			model: model || undefined
		});
		this.conversations = [conversation, ...this.conversations];
		this.conversation = conversation;
		this.messages = [];
		this.toolProgress = {};
		this.#rememberConversation(conversation.id);
		// Discovery may still be running, in which case the model lands later.
		if (!conversation.model) void this.ensureModel();
	}

	/**
	 * Best model for a provider, most specific source first: the model last used
	 * with that provider, then its configured default, then the first one it
	 * reported, then any remembered model as a last resort.
	 */
	private pickModel(providerId: string | null | undefined): string {
		const provider = this.providers.find((item) => item.id === providerId) ?? this.provider;
		if (!provider) return this.settings.defaults.model ?? '';
		const discovered = this.models[provider.id] ?? [];
		const remembered = this.settings.defaults.model;
		const rememberedHere =
			remembered &&
			(this.settings.defaults.providerId === provider.id || !this.settings.defaults.providerId) &&
			// A remembered id that discovery no longer lists may still be valid,
			// but do not prefer it over a model the provider actually reports.
			(discovered.length === 0 || discovered.some((model) => model.id === remembered))
				? remembered
				: undefined;
		return rememberedHere ?? provider.defaultModel ?? discovered[0]?.id ?? '';
	}

	/** Fills in a model when the open chat has none, so sending works at once. */
	async ensureModel(): Promise<void> {
		const conversation = this.conversation;
		if (!conversation || conversation.model || this.#pickingModel) return;
		const model = this.pickModel(conversation.providerId);
		if (!model) return;
		this.#pickingModel = true;
		try {
			await this.patchConversation({ model });
		} finally {
			this.#pickingModel = false;
		}
	}

	/** Remembers the model so a fresh chat starts where the last one left off. */
	private rememberModel(model: string, providerId = this.provider?.id ?? null): void {
		if (!model) return;
		if (this.settings.defaults.model === model && this.settings.defaults.providerId === providerId) return;
		const defaults = { providerId, model };
		this.settings = { ...this.settings, defaults };
		void this.saveSettings({ defaults });
	}

	/** The chat the address bar points at, or null when it holds no chat. */
	#conversationFromUrl(): string | null {
		if (typeof window === 'undefined') return null;
		return new URL(window.location.href).searchParams.get('c');
	}

	/** Puts the open chat in the address bar, without a new history entry. */
	#rememberConversation(id: string): void {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		if (url.searchParams.get('c') === id) return;
		url.searchParams.set('c', id);
		replaceState(url, {});
	}

	async open(id: string): Promise<void> {
		// Switching chats only stops this page from watching, the turn runs on.
		if (this.running) this.detach();
		try {
			const { conversation, messages } = await api.getConversation(id);
			this.conversation = conversation;
			this.messages = messages;
			this.toolProgress = {};
			this.#rememberConversation(conversation.id);
			// An older chat may predate model discovery.
			if (!conversation.model) void this.ensureModel();
			// Picking a chat in the drawer means the drawer has done its job.
			if (this.narrow) this.closeSidebar();
			// Pick up a turn that is still running, on this device or another one.
			void this.resume();
		} catch (err) {
			this.toast('error', errorText(err));
		}
	}

	async patchConversation(patch: Partial<Conversation>): Promise<void> {
		if (!this.conversation) return;
		const { conversation } = await api.updateConversation(this.conversation.id, patch);
		this.conversation = conversation;
		this.conversations = this.conversations.map((c) => (c.id === conversation.id ? conversation : c));
	}

	async setModel(model: string): Promise<void> {
		const picked = model.trim();
		if (!picked) return;
		await this.patchConversation({ model: picked });
		this.rememberModel(picked);
	}

	async setProvider(providerId: string): Promise<void> {
		const provider = this.providers.find((p) => p.id === providerId);
		const model = this.pickModel(providerId) || null;
		await this.patchConversation({ providerId, model });
		this.rememberModel(model ?? '', providerId);
		if (provider && !this.models[provider.id]) void this.refreshModels(provider.id);
	}

	async deleteConversation(id: string): Promise<void> {
		await api.deleteConversation(id);
		this.conversations = this.conversations.filter((c) => c.id !== id);
		if (this.conversation?.id === id) {
			if (this.conversations.length) await this.open(this.conversations[0].id);
			else await this.newConversation();
		}
	}

	async renameConversation(title: string): Promise<void> {
		await this.patchConversation({ title });
	}

	/* --------------------------------------------------------------- messages */

	/**
	 * After loading a chat: attach to a turn that is already running, then carry
	 * on with anything the conversation is still waiting for, such as tool calls
	 * the page never got to run.
	 */
	async resume(): Promise<void> {
		const conversation = this.conversation;
		if (!conversation || this.running) return;
		const controller = new AbortController();
		this.#controller = controller;
		this.running = true;
		try {
			await this.streamTurn(
				{ url: `/api/chat/stream?conversationId=${conversation.id}`, method: 'GET' },
				controller.signal
			);
		} catch (err) {
			if (!controller.signal.aborted) this.toast('error', errorText(err));
		} finally {
			this.running = false;
			this.#controller = null;
			this.liveMessageId = null;
			this.liveRate = undefined;
			await this.refreshMessages().catch(() => {});
		}
		if (controller.signal.aborted) return;
		await this.continuePending();
	}

	/** Starts the turn that a stopped or reloaded page left unasked. */
	private async continuePending(): Promise<void> {
		const conversation = this.conversation;
		const last = this.messages[this.messages.length - 1];
		if (!conversation || !last) return;
		if (!this.provider || !this.model || this.queued.length) return;
		// An unanswered tool call means the turn died with the server. Starting the
		// turn again makes the server close the call and answer from there.
		if (last.role === 'assistant') {
			const answered = new Set(
				this.messages.filter((message) => message.role === 'tool' && message.toolCallId).map((m) => m.toolCallId)
			);
			const waiting = (last.toolCalls ?? []).some((call) => !answered.has(call.id));
			if (!waiting) return;
			await this.runLoop({ url: '/api/chat', body: this.turnBody() });
			return;
		}
		// A trailing user or tool message means no answer was ever produced.
		if (last.role === 'user' || last.role === 'tool') {
			await this.runLoop({ url: '/api/chat', body: this.turnBody() });
		}
	}

	async refreshMessages(): Promise<void> {
		if (!this.conversation) return;
		const { messages } = await api.getConversation(this.conversation.id);
		this.messages = messages;
	}

	async deleteFrom(messageId: string): Promise<void> {
		if (!this.conversation) return;
		await api.deleteFrom(this.conversation.id, messageId);
		await this.refreshMessages();
	}

	/** Re-runs the answer for the most recent user message. */
	async retry(): Promise<void> {
		const index = [...this.messages].reverse().findIndex((m) => m.role === 'user');
		if (index === -1) return;
		const userIndex = this.messages.length - 1 - index;
		const next = this.messages[userIndex + 1];
		if (next) await this.deleteFrom(next.id);
		await this.runLoop({ url: '/api/chat', body: this.turnBody() });
	}

	/** Drops a user message and sends the edited text again. */
	async editAndResend(messageId: string, text: string): Promise<void> {
		await this.deleteFrom(messageId);
		await this.send(text);
	}

	/* ---------------------------------------------------------------- sending */

	async attach(files: File[]): Promise<void> {
		this.uploading = true;
		try {
			for (const file of files) {
				if (isPdf(file)) {
					await this.attachDocument(file);
					continue;
				}
				if (!file.type.startsWith('image/')) {
					this.toast('error', `${file.name} is not an image`);
					continue;
				}
				const { image } = await api.uploadImage(file);
				this.pendingImages = [...this.pendingImages, image];
			}
		} catch (err) {
			this.toast('error', errorText(err));
		} finally {
			this.uploading = false;
		}
	}

	/** PDFs are converted on the server: text always, page images for vision models. */
	private async attachDocument(file: File): Promise<void> {
		try {
			const { document, images } = await api.uploadDocument(file);
			const vision = this.availableModels.find((model) => model.id === this.model)?.vision;
			const wantsImages = this.settings.tools.pdfImages && vision !== false;
			this.pendingDocuments = [
				...this.pendingDocuments,
				{ document, images: wantsImages ? images : [], sendImages: wantsImages }
			];
			if (vision === false && images.length) {
				this.toast(
					'info',
					`${document.name}: page images skipped because ${this.model} is text only, the text is still sent`
				);
			}
		} catch (err) {
			this.toast('error', `${file.name}: ${errorText(err)}`);
		}
	}

	removePendingDocument(id: string): void {
		this.pendingDocuments = this.pendingDocuments.filter((item) => item.document.id !== id);
	}

	removePendingImage(id: string): void {
		this.pendingImages = this.pendingImages.filter((image) => image.id !== id);
	}

	private turnBody() {
		return {
			conversationId: this.conversation?.id,
			providerId: this.provider?.id ?? null,
			model: this.model || null
		};
	}

	/**
	 * Sends a message. While a turn is still streaming the message is queued and
	 * sent as soon as the current turn finishes, so a follow up is never lost.
	 */
	async send(text: string): Promise<void> {
		if (!this.conversation) return;
		const trimmed = text.trim();
		const images = this.pendingImages;
		const documents = this.pendingDocuments;
		const sentImages = [
			...images,
			...documents.filter((item) => item.sendImages).flatMap((item) => item.images)
		];
		if (!trimmed && !sentImages.length && !documents.length) return;
		if (!this.provider) {
			this.toast('error', 'Add a provider in Settings first');
			this.showSettings = true;
			return;
		}
		if (!this.model) {
			this.toast('error', 'Pick a model first');
			return;
		}
		this.pendingImages = [];
		this.pendingDocuments = [];
		if (this.running) {
			this.queued = [
				...this.queued,
				{ id: crypto.randomUUID(), text: trimmed, images: sentImages, documents: documents.map((item) => item.document) }
			];
			return;
		}
		const sent = await this.dispatch(trimmed, sentImages, documents.map((item) => item.document));
		if (!sent) {
			// Put the attachments back so the user can retry.
			this.pendingImages = images;
			this.pendingDocuments = documents;
		}
	}

	/** Stores a user message and runs the assistant turn for it. */
	private async dispatch(text: string, images: ImageRef[], documents: DocumentRef[]): Promise<boolean> {
		if (!this.conversation) return false;
		// Whatever model actually runs counts as the last used one.
		this.rememberModel(this.model);
		try {
			const { message } = await api.addMessage(this.conversation.id, { text, images, documents });
			this.messages = [...this.messages, message];
			await this.refreshConversations();
			this.conversation = this.conversations.find((c) => c.id === this.conversation?.id) ?? this.conversation;
		} catch (err) {
			this.toast('error', errorText(err));
			return false;
		}
		await this.runLoop({ url: '/api/chat', body: this.turnBody() });
		return true;
	}

	removeQueued(id: string): void {
		this.queued = this.queued.filter((item) => item.id !== id);
	}

	/** Sends everything that was typed while the previous turn was streaming. */
	private async drainQueue(): Promise<void> {
		if (this.#draining) return;
		this.#draining = true;
		try {
			while (this.queued.length) {
				const [next, ...rest] = this.queued;
				this.queued = rest;
				const sent = await this.dispatch(next.text, next.images, next.documents);
				if (!sent) break;
			}
		} finally {
			this.#draining = false;
		}
	}

	/** Stops watching the stream without touching the running turn. */
	detach(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.running = false;
		this.liveMessageId = null;
		this.liveRate = undefined;
		this.stopPrefillTimer();
	}

	/** Answers a tool that waits, because its mode is ask first. */
	async approve(call: ToolCall, decision: 'allow' | 'deny', always = false): Promise<void> {
		if (!this.conversation) return;
		this.toolProgress[call.id] = {
			state: decision === 'allow' ? 'running' : 'error',
			detail: decision === 'allow' ? 'approved' : 'denied'
		};
		try {
			await api.approveTool(this.conversation.id, call.id, decision, always);
			// Always allow saves the mode on the server, so the view must catch up.
			if (always) this.settings = await api.getSettings();
		} catch (err) {
			this.toast('error', errorText(err));
		}
	}

	/** Ends the turn for real, which is only ever the user's decision. */
	stop(): void {
		const conversationId = this.conversation?.id;
		this.detach();
		if (conversationId) void api.stopTurn(conversationId).catch(() => {});
		if (this.queued.length) {
			this.queued = [];
			this.toast('info', 'Stopped, queued messages dropped');
		}
	}

	/** Streams one turn. The server runs the tools and continues on its own. */
	private async runLoop(payload: { url: string; body: unknown }): Promise<void> {
		if (!this.conversation) return;
		this.running = true;
		this.#controller = new AbortController();
		const signal = this.#controller.signal;
		try {
			await this.streamTurn({ url: payload.url, body: payload.body, method: 'POST' }, signal);
			await this.refreshMessages();
		} catch (err) {
			if (!signal.aborted) this.toast('error', errorText(err));
		} finally {
			this.running = false;
			this.liveMessageId = null;
			this.liveRate = undefined;
			this.stopPrefillTimer();
			this.#controller = null;
			await this.refreshMessages().catch(() => {});
			// A follow up typed during the turn starts now. The guard in drainQueue
			// keeps this from recursing when called again from a nested turn.
			if (this.queued.length) void this.drainQueue();
		}
	}

	/**
	 * Applies one stream event to the local view. The same handling is used when
	 * a turn is started here and when this page attaches to a turn that is
	 * already running, on this device or another one.
	 */
	private handleEvent(event: StreamEvent): void {
		switch (event.type) {
			case 'snapshot':
				this.applySnapshot(event);
				break;
			case 'idle':
				this.turnRunning = false;
				break;
			case 'start': {
				this.liveMessageId = event.messageId;
				this.turnRunning = true;
				this.liveRate = undefined;
				// A repeated start for a row the snapshot already gave us: keep the
				// counters so the live rate does not restart from zero.
				if (this.messages.some((message) => message.id === event.messageId)) break;
				this.#streamChars = 0;
				this.#streamFirstAt = null;
				this.messages = [
					...this.messages,
					{
						id: event.messageId,
						conversationId: this.conversation?.id ?? '',
						role: 'assistant',
						text: '',
						reasoning: '',
						images: [],
						toolCalls: [],
						model: this.model,
						createdAt: new Date().toISOString()
					}
				];
				break;
			}
			case 'text':
				this.patchLive((message) => {
					message.text += event.text;
				});
				this.countLive(event.text.length);
				break;
			case 'reasoning':
				this.patchLive((message) => {
					message.reasoning = (message.reasoning ?? '') + event.text;
				});
				this.countLive(event.text.length);
				break;
			case 'tool_call':
				this.patchLive((message) => {
					message.toolCalls = [...(message.toolCalls ?? []), event.call];
				});
				break;
			case 'tool_result':
				this.toolProgress[event.toolCallId] = {
					state: event.isError ? 'error' : 'done',
					detail: event.detail,
					data: event.data
				};
				break;
			case 'tool_ask':
				this.toolProgress[event.call.id] = { state: 'ask', detail: 'waiting for you' };
				break;
			case 'notice':
				this.toast('info', event.message);
				break;
			case 'done':
				this.liveMessageId = null;
				this.turnRunning = false;
				break;
			case 'error':
				this.turnRunning = false;
				this.toast('error', event.message);
				break;
		}
	}

	/**
	 * Prefill is the wait before the first token, which is where a slow local
	 * model spends its time. The rate is prompt tokens divided by that wait, so
	 * it has to be recomputed while we wait rather than when something arrives.
	 */
	private startPrefillTimer(): void {
		this.stopPrefillTimer();
		this.#requestStartedAt = Date.now();
		this.#promptTokens = contextUsage({
			messages: this.messages,
			system: this.params.system
		}).used;
		this.prefilling = true;
		const tick = () => {
			const elapsed = Date.now() - this.#requestStartedAt;
			// A rate needs a little data before it means anything. The threshold is
			// well under the tick interval, so the first tick always has a value.
			this.prefillRate = elapsed >= 100 ? ratePerSecond(this.#promptTokens, elapsed) : undefined;
		};
		tick();
		this.#prefillTicker = setInterval(tick, 200);
	}

	private stopPrefillTimer(): void {
		if (this.#prefillTicker) clearInterval(this.#prefillTicker);
		this.#prefillTicker = undefined;
		this.prefillRate = undefined;
		this.prefilling = false;
	}

	/** Rough generation speed: four characters per token over the decode window. */
	private countLive(chars: number): void {
		// The first token ends the prefill phase.
		this.stopPrefillTimer();
		this.#streamChars += chars;
		this.#streamFirstAt ??= Date.now();
		this.liveRate = liveRate(this.#streamChars, Date.now() - this.#streamFirstAt);
	}

	private patchLive(fn: (message: Message) => void): void {
		const target = this.liveMessageId
			? this.messages.find((message) => message.id === this.liveMessageId)
			: this.unclaimedAssistant();
		if (!target) return;
		// Adopt whatever row the deltas clearly belong to.
		this.liveMessageId = target.id;
		fn(target);
	}

	/**
	 * The row a stray delta belongs to: the newest assistant message that no
	 * finished turn owns, since a completed answer always carries usage.
	 */
	private unclaimedAssistant(): Message | undefined {
		for (let at = this.messages.length - 1; at >= 0; at--) {
			const candidate = this.messages[at];
			if (candidate.role === 'assistant' && !candidate.usage) return candidate;
		}
		return undefined;
	}

	/** Restores the answer that is already in the database when attaching. */
	private applySnapshot(event: Extract<StreamEvent, { type: 'snapshot' }>): void {
		this.turnRunning = event.running;
		// A tool that waits for the user is part of the snapshot, so a reload shows it.
		if (event.approval) this.toolProgress[event.approval.id] = { state: 'ask', detail: 'waiting for you' };
		if (!event.messageId) return;
		const existing = this.messages.find((message) => message.id === event.messageId);
		if (existing) {
			existing.text = event.text;
			existing.reasoning = event.reasoning;
			existing.toolCalls = event.toolCalls;
		} else {
			this.messages = [
				...this.messages,
				{
					id: event.messageId,
					conversationId: this.conversation?.id ?? '',
					role: 'assistant',
					text: event.text,
					reasoning: event.reasoning,
					images: [],
					toolCalls: event.toolCalls,
					model: this.model,
					createdAt: new Date().toISOString()
				}
			];
		}
		if (event.running) {
			// No text yet means the prompt is still being read, wherever it was started.
			this.prefilling = !event.text && !event.reasoning;
			// Arriving mid prefill still deserves a rate, measured from here on.
			if (this.prefilling) this.startPrefillTimer();
			else this.stopPrefillTimer();
			this.liveMessageId = event.messageId;
			this.#streamChars = event.text.length + event.reasoning.length;
			this.#streamFirstAt = Date.now();
		}
	}

	/** Streams one turn and returns the tool calls it asked for. */
	private async streamTurn(
		request: { url: string; body?: unknown; method?: 'POST' | 'GET' },
		signal: AbortSignal
	): Promise<void> {
		this.turnRunning = true;
		if (request.method !== 'GET') this.startPrefillTimer();
		const handler = (event: StreamEvent) => this.handleEvent(event);
		if (request.method === 'GET') await getStream(request.url, signal, handler);
		else await postStream(request.url, request.body, signal, handler);
	}

	/* --------------------------------------------------------------- settings */

	async saveSettings(patch: Partial<Settings>): Promise<void> {
		try {
			const saved = await api.saveSettings(patch);
			this.settings = saved;
			applyTheme(saved.theme);
		} catch (err) {
			this.toast('error', errorText(err));
		}
	}

	async setTheme(theme: Partial<Settings['theme']>): Promise<void> {
		this.settings = { ...this.settings, theme: { ...this.settings.theme, ...theme } };
		applyTheme(this.settings.theme);
		await this.saveSettings({ theme: this.settings.theme });
	}

	/** Sets one tool to off, ask first or on. The choice is global and persisted. */
	async setToolMode(name: string, mode: ToolMode): Promise<void> {
		const modes = { ...this.settings.tools.modes, [name]: mode };
		this.settings = { ...this.settings, tools: { ...this.settings.tools, modes } };
		await this.saveSettings({ tools: this.settings.tools });
	}

	/** The mode of a tool, with the default of its catalog entry as the fallback. */
	toolMode(name: string): ToolMode {
		const spec = TOOL_CATALOG.find((tool) => tool.name === name);
		return this.settings.tools.modes[name] ?? spec?.defaultMode ?? 'off';
	}

	/* --------------------------------------------------------------- providers */

	async refreshModels(providerId: string): Promise<void> {
		this.modelsLoading = { ...this.modelsLoading, [providerId]: true };
		this.modelsError = { ...this.modelsError, [providerId]: '' };
		try {
			const { models } = await api.listModels(providerId);
			this.models = { ...this.models, [providerId]: models };
			// A fresh list may be what lets an empty chat pick a model.
			if (this.conversation?.providerId === providerId || this.provider?.id === providerId) {
				void this.ensureModel();
			}
		} catch (err) {
			this.modelsError = { ...this.modelsError, [providerId]: errorText(err) };
		} finally {
			this.modelsLoading = { ...this.modelsLoading, [providerId]: false };
		}
	}

	async refreshAllModels(): Promise<void> {
		await Promise.all(this.providers.map((provider) => this.refreshModels(provider.id)));
	}

	async refreshSkills(): Promise<void> {
		try {
			const { skills } = await api.listSkills();
			this.skills = skills;
		} catch (err) {
			this.toast('error', errorText(err));
		}
	}

	async reloadProviders(): Promise<void> {
		const { providers } = await api.listProviders();
		this.providers = providers;
		// A provider that was just added has no model list yet.
		for (const provider of providers) {
			if (provider.enabled && !this.models[provider.id] && !this.modelsLoading[provider.id]) {
				void this.refreshModels(provider.id);
			}
		}
	}

	/* ------------------------------------------------------------------ toasts */

	toast(kind: Toast['kind'], text: string): void {
		const id = ++this.#toastId;
		this.toasts = [...this.toasts, { id, kind, text }];
		setTimeout(() => this.dismiss(id), TOAST_MS);
	}

	dismiss(id: number): void {
		this.toasts = this.toasts.filter((toast) => toast.id !== id);
	}
}

export type ThemeChoice = Partial<ThemeSettings>;

/**
 * Writes every appearance choice to <html>, so the stylesheet can react to it,
 * and to localStorage where the boot script picks it up before the first paint.
 */
export function applyTheme(theme: ThemeChoice): void {
	if (typeof document === 'undefined') return;
	const chosen: ThemeSettings = { ...DEFAULT_THEME, ...theme };
	const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
	// The system scheme picks the light or dark variant of the chosen family.
	const resolved = resolveTheme(chosen.name, systemDark);
	const root = document.documentElement;
	root.dataset.mode = resolved.scheme;
	root.dataset.theme = resolved.variant;
	root.dataset.font = fontChoice(chosen.font);
	// The stylesheet resolves this var only while data-font is custom.
	root.style.setProperty('--ui-font-custom', fontStack(chosen.fontFamily));
	root.dataset.text = chosen.textSize;
	root.dataset.radius = chosen.radius;
	root.dataset.density = chosen.density;
	// The tab icon is drawn from the colours this just resolved.
	applyFavicon();
	try {
		localStorage.setItem(THEME_KEY, JSON.stringify(chosen));
	} catch {
		/* storage can be blocked, the theme still applies */
	}
}

export const app = new AppState();
export { DEFAULT_PARAMS };
