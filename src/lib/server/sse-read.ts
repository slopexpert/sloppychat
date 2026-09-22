/**
 * Reads the frames of a server-sent event stream that another program sent: a
 * provider answer, or a MCP server that answers over an event stream.
 *
 * A frame ends at a blank line, and the line break may be LF or CRLF. Text that
 * is left when the stream closes is read too, because a server may end without a
 * blank line of its own.
 */

/**
 * Turns the CRLF breaks of accumulated text into LF. A CR at the very end waits,
 * because its LF may arrive with the next chunk.
 */
function lineFeeds(text: string): string {
	const hold = text.endsWith('\r') ? '\r' : '';
	const rest = hold ? text.slice(0, -1) : text;
	return rest.replace(/\r\n/g, '\n') + hold;
}

/** Yields the text of every frame, without the blank line that ends it. */
export async function* sseFrames(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
	if (!res.body) return;
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	signal?.addEventListener('abort', () => void reader.cancel().catch(() => {}));
	try {
		for (;;) {
			const { done, value } = await reader.read();
			// At the end the decoder is flushed, so a split multi byte character is kept.
			buffer = lineFeeds(buffer + decoder.decode(value, { stream: !done }));
			if (done) break;
			for (const frame of wholeFrames()) yield frame;
		}
		// Whatever is left is one last frame, if it holds anything at all.
		const rest = buffer.trim();
		buffer = '';
		if (rest) yield rest;
	} finally {
		reader.releaseLock();
	}

	/** Takes every frame that is finished out of the buffer. */
	function* wholeFrames(): Generator<string> {
		for (;;) {
			const cut = buffer.indexOf('\n\n');
			if (cut === -1) return;
			const frame = buffer.slice(0, cut);
			buffer = buffer.slice(cut + 2);
			yield frame;
		}
	}
}

/** The payload of each `data:` line of one frame, in the order they came. */
export function frameData(frame: string): string[] {
	const out: string[] = [];
	for (const line of frame.split('\n')) {
		const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
		if (!trimmed.startsWith('data:')) continue;
		const payload = trimmed.slice(5).replace(/^ /, '');
		if (payload) out.push(payload);
	}
	return out;
}
