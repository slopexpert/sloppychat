import type { ToolCall } from '$lib/shared/types';

/**
 * A turn that asks for a tool in the mode ask first holds here until the user
 * answers. The turn lives on the server, so the wait survives a reload and any
 * window can answer it. One request waits per conversation, which matches the
 * one turn per conversation rule.
 */

export type ApprovalDecision = 'allow' | 'deny' | 'timeout';

/** How long a request waits before the turn goes on without the tool. */
const WAIT_MS = 30 * 60 * 1000;

interface Waiting {
	call: ToolCall;
	answer: (decision: ApprovalDecision) => void;
}

const waiting = new Map<string, Waiting>();

/** Holds the turn until the user answers, until Stop, or until the wait ends. */
export function waitForApproval(
	conversationId: string,
	call: ToolCall,
	signal: AbortSignal
): Promise<ApprovalDecision> {
	return new Promise((resolve) => {
		const finish = (decision: ApprovalDecision) => {
			clearTimeout(timer);
			signal.removeEventListener('abort', onAbort);
			waiting.delete(conversationId);
			resolve(decision);
		};
		const onAbort = () => finish('deny');
		const timer = setTimeout(() => finish('timeout'), WAIT_MS);
		signal.addEventListener('abort', onAbort, { once: true });
		waiting.set(conversationId, { call, answer: finish });
	});
}

/** Answers the pending request of a conversation. False means nothing waited. */
export function resolveApproval(
	conversationId: string,
	toolCallId: string,
	decision: 'allow' | 'deny'
): boolean {
	const entry = waiting.get(conversationId);
	if (!entry || entry.call.id !== toolCallId) return false;
	entry.answer(decision);
	return true;
}

/** The request a client must show when it attaches, or undefined when idle. */
export function pendingApproval(conversationId: string): ToolCall | undefined {
	return waiting.get(conversationId)?.call;
}
