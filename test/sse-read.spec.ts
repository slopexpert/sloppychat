import { describe, expect, it } from 'vitest';
import { frameData, sseFrames } from '$lib/server/sse-read';
import { sseData } from '$lib/server/openai';

/**
 * A provider or a MCP server may answer with frames that end in CRLF instead of
 * LF, and may end the stream without a blank line of its own. Reading only LF
 * frames throws every answer of such a server away.
 */

function body(chunks: string[]): Response {
	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
				controller.close();
			}
		})
	);
}

async function frames(...chunks: string[]): Promise<string[]> {
	const seen: string[] = [];
	for await (const frame of sseFrames(body(chunks))) seen.push(frame);
	return seen;
}

async function payloads(...chunks: string[]): Promise<string[]> {
	const seen: string[] = [];
	for await (const payload of sseData(body(chunks))) seen.push(payload);
	return seen;
}

describe('the frames of an event stream', () => {
	it('reads LF frames', async () => {
		expect(await frames('data: one\n\ndata: two\n\n')).toEqual(['data: one', 'data: two']);
	});

	it('reads CRLF frames', async () => {
		expect(await frames('data: one\r\n\r\ndata: two\r\n\r\n')).toEqual(['data: one', 'data: two']);
	});

	it('reads a CRLF break that is split between two chunks', async () => {
		expect(await frames('data: split\r', '\n\r\ndata: next\r\n\r\n')).toEqual(['data: split', 'data: next']);
	});

	it('reads the last frame when the stream ends without a blank line', async () => {
		expect(await frames('data: first\n\ndata: last')).toEqual(['data: first', 'data: last']);
	});

	it('keeps a frame that arrives in pieces', async () => {
		expect(await frames('data: hal', 'f\n\ndata: done\n\n')).toEqual(['data: half', 'data: done']);
	});

	it('gives the payload of each data line', () => {
		expect(frameData('event: message\r\ndata: {"a":1}')).toEqual(['{"a":1}']);
		expect(frameData(': keep alive')).toEqual([]);
	});
});

describe('the payloads a provider sends', () => {
	it('comes through when the server uses CRLF', async () => {
		expect(await payloads('data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n')).toEqual([
			'{"a":1}',
			'{"b":2}'
		]);
	});

	it('drops the marker that says the answer is over', async () => {
		expect(await payloads('data: {"a":1}\r\n\r\ndata: [DONE]\r\n\r\n')).toEqual(['{"a":1}']);
	});

	it('reads the final chunk that ends with the stream', async () => {
		expect(await payloads('data: {"a":1}\n\ndata: {"tail":true}')).toEqual(['{"a":1}', '{"tail":true}']);
	});
});
