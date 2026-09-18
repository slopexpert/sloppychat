import type { StreamEvent, ToolCall, ToolResult } from '$lib/shared/types';
import { continueWithToolResults, runTurn, type TurnRequest } from './bridge';
import type { SseWriter } from './sse';
import { finalizeMessage, getMessage } from './store';

/**
 * Turns run here, not in the browser.
 *
 * A turn is a background job per conversation. Any number of clients can watch
 * it, none of them owns it, and one closing its connection does not stop the
 * model. A client that arrives late gets a snapshot from the database first and
 * then the live events, so a reload, a second window or another device picks up
 * the answer mid sentence.
 */

interface Turn {
	conversationId: string;
	controller: AbortController;
	subscribers: Set<SseWriter>;
	assistantId: string | null;
	done: Promise<void>;
}

const turns = new Map<string, Turn>();

export function isTurnRunning(conversationId: string): boolean {
	return turns.has(conversationId);
}

/** Stops the running turn for a conversation. Only the user does this. */
export function stopTurn(conversationId: string): boolean {
	const turn = turns.get(conversationId);
	if (!turn) return false;
	turn.controller.abort();
	return true;
}

/** Marks an answer that never got a finish reason, so a reload can tell. */
function markInterrupted(turn: Turn): void {
	const id = turn.assistantId;
	if (!id) return;
	const message = getMessage(id);
	if (!message) return;
	finalizeMessage(id, { usage: { ...(message.usage ?? {}), interrupted: true } });
}

function begin(
	conversationId: string,
	run: (writer: SseWriter, signal: AbortSignal) => Promise<void>
): Turn {
	const controller = new AbortController();
	const turn: Turn = {
		conversationId,
		controller,
		subscribers: new Set(),
		assistantId: null,
		done: Promise.resolve()
	};
	turns.set(conversationId, turn);

	const writer: SseWriter = {
		send(event) {
			if (event.type === 'start') turn.assistantId = event.messageId;
			// A failing subscriber must not stop the others or the turn.
			for (const subscriber of [...turn.subscribers]) {
				try {
					subscriber.send(event);
				} catch {
					turn.subscribers.delete(subscriber);
				}
			}
		},
		close() {
			/* the fan out writer has no stream of its own to close */
		}
	};

	turn.done = (async () => {
		try {
			await run(writer, controller.signal);
		} catch (err) {
			writer.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
		} finally {
			if (controller.signal.aborted) markInterrupted(turn);
			turns.delete(conversationId);
		}
	})();

	return turn;
}

/** Starts a turn unless one is already running for that conversation. */
export function startTurn(request: TurnRequest): boolean {
	if (turns.has(request.conversationId)) return false;
	begin(request.conversationId, (writer, signal) => runTurn(request, writer, signal));
	return true;
}

/** Stores tool results and continues the chain, unless a turn is already running. */
export function startToolContinuation(conversationId: string, results: ToolResult[]): boolean {
	if (turns.has(conversationId)) return false;
	begin(conversationId, (writer, signal) => continueWithToolResults(conversationId, results, writer, signal));
	return true;
}

/**
 * What a client needs to render a turn that is already in progress. The row the
 * turn is writing into comes from the turn itself, not from the last message in
 * the conversation, so a client that attaches at any moment gets its id even if
 * it missed the start event.
 */
export function snapshotFor(conversationId: string): StreamEvent {
	const turn = turns.get(conversationId);
	const assistant = turn?.assistantId ? getMessage(turn.assistantId) : undefined;
	if (turn && assistant) {
		return {
			type: 'snapshot',
			messageId: assistant.id,
			text: assistant.text,
			reasoning: assistant.reasoning ?? '',
			toolCalls: (assistant.toolCalls ?? []) as ToolCall[],
			running: true
		};
	}
	return { type: 'snapshot', messageId: null, text: '', reasoning: '', toolCalls: [], running: Boolean(turn) };
}

export interface Subscription {
	done: Promise<void>;
	unsubscribe(): void;
}

/** Attaches a writer to the running turn, or returns undefined when idle. */
export function subscribe(conversationId: string, writer: SseWriter): Subscription | undefined {
	const turn = turns.get(conversationId);
	if (!turn) return undefined;
	// Nothing is replayed: the snapshot the client just received already holds
	// everything up to this moment, and the events after it arrive live.
	turn.subscribers.add(writer);
	return {
		done: turn.done,
		unsubscribe: () => turn.subscribers.delete(writer)
	};
}
