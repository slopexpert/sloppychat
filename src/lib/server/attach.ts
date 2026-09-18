import type { StreamEvent } from '$lib/shared/types';
import { snapshotFor, subscribe } from './hub';
import { sseResponse } from './sse';

/**
 * Attaches one client to the turn running for a conversation. The response
 * carries a snapshot first, then the live events, and it ends when the turn
 * ends or the client goes away. Neither case stops the turn itself.
 */
export function attachResponse(request: Request, conversationId: string): Response {
	return sseResponse(request.signal, async (writer) => {
		const snapshot = snapshotFor(conversationId);
		writer.send(snapshot);
		if (snapshot.type === 'snapshot' && snapshot.running && snapshot.messageId) {
			// Repeating the start event keeps any client that ignores the snapshot
			// working; the current one already has the row and skips it.
			writer.send({ type: 'start', messageId: snapshot.messageId });
		}
		const subscription = subscribe(conversationId, writer);
		if (!subscription) {
			writer.send({ type: 'idle' } satisfies StreamEvent);
			return;
		}
		try {
			await subscription.done;
		} finally {
			subscription.unsubscribe();
		}
	});
}
