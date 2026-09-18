import type { StreamEvent } from '$lib/shared/types';

/** Server-sent events writer used by the chat and tool-continue endpoints. */

const encoder = new TextEncoder();
const KEEPALIVE_MS = 15000;

export interface SseWriter {
	send(event: StreamEvent): void;
	close(): void;
}

export function sseResponse(
	signal: AbortSignal,
	start: (w: SseWriter) => Promise<void>
): Response {
	let timer: ReturnType<typeof setInterval> | undefined;
	let closed = false;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const write = (chunk: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					closed = true;
				}
			};
			const writer: SseWriter = {
				send(event) {
					write(`data: ${JSON.stringify(event)}\n\n`);
				},
				close() {
					if (closed) return;
					closed = true;
					if (timer) clearInterval(timer);
					try {
						controller.close();
					} catch {
						/* already closed */
					}
				}
			};
			write(': ok\n\n');
			timer = setInterval(() => write(': ping\n\n'), KEEPALIVE_MS);
			signal.addEventListener('abort', () => writer.close());
			void start(writer)
				.catch((err: unknown) => {
					writer.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
				})
				.finally(() => writer.close());
		},
		cancel() {
			if (timer) clearInterval(timer);
			closed = true;
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
}
