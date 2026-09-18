import { describe, expect, it } from 'vitest';
import { readEventStream } from '$lib/client/api';
import type { StreamEvent } from '$lib/shared/types';

/**
 * The browser must hand each event to the app as it arrives. If this ever
 * buffers until the stream ends, answers appear complete instead of streaming.
 */

function tickingStream() {
	const encoder = new TextEncoder();
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		}
	});
	return {
		response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
		push: (text: string) => controller?.enqueue(encoder.encode(text)),
		close: () => controller?.close()
	};
}

async function tick(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('readEventStream', () => {
	it('emits each event before the stream ends', async () => {
		const { response, push, close } = tickingStream();
		const seen: string[] = [];
		const finished = readEventStream(response, (event: StreamEvent) => seen.push(event.type));

		push('data: {"type":"start","messageId":"a1"}\n\n');
		await tick();
		expect(seen).toEqual(['start']);

		push('data: {"type":"text","text":"streamed "}\n\n');
		await tick();
		expect(seen).toEqual(['start', 'text']);

		push('data: {"type":"text","text":"token by token"}\n\n');
		await tick();
		expect(seen).toEqual(['start', 'text', 'text']);

		close();
		await finished;
		expect(seen).toHaveLength(3);
	});

	it('reassembles frames that are split across chunks', async () => {
		const { response, push, close } = tickingStream();
		const texts: string[] = [];
		const finished = readEventStream(response, (event) => {
			if (event.type === 'text') texts.push(event.text);
		});

		push('data: {"type":"text","te');
		await tick();
		expect(texts).toEqual([]);
		push('xt":"split frame"}\n');
		await tick();
		expect(texts).toEqual([]);
		push('\n');
		await tick();
		expect(texts).toEqual(['split frame']);

		close();
		await finished;
	});

	it('skips comments, blank frames and malformed data', async () => {
		const { response, push, close } = tickingStream();
		const seen: string[] = [];
		const finished = readEventStream(response, (event) => seen.push(event.type));

		push(': ping\n\n');
		push('data: not json\n\n');
		push('data: {"type":"done","finishReason":"stop","messageId":"a1"}\n\n');
		await tick();
		expect(seen).toEqual(['done']);

		close();
		await finished;
	});
});
