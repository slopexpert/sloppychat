import { describe, expect, it, vi } from 'vitest';
import { onStop } from '$lib/server/shutdown';

/**
 * A MCP server that runs as a child process belongs to this process. When the
 * process stops, the child has to go with it, once, however the stop arrived.
 */

/** A process double that records the handlers and the exit calls. */
function fakeProcess() {
	const handlers = new Map<string, Array<() => void>>();
	const exits: number[] = [];
	const add = (event: string, fn: () => void) => {
		handlers.set(event, [...(handlers.get(event) ?? []), fn]);
	};
	return {
		handlers,
		exits,
		once: (event: string, fn: () => void) => add(event, fn),
		on: (event: string, fn: () => void) => add(event, fn),
		exit: (code: number) => void exits.push(code),
		emit(event: string): void {
			for (const fn of handlers.get(event) ?? []) fn();
		}
	};
}

describe('stopping the process', () => {
	it('closes what the process opened when it is asked to stop', () => {
		const target = fakeProcess();
		const cleanup = vi.fn();

		onStop(cleanup, target as unknown as NodeJS.Process);
		target.emit('SIGTERM');

		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(target.exits).toEqual([0]);
	});

	it('takes a break between Ctrl-C and the end of the process', () => {
		const target = fakeProcess();
		const cleanup = vi.fn();

		onStop(cleanup, target as unknown as NodeJS.Process);
		target.emit('SIGINT');
		// The end of the process follows the signal, and must not clean up twice.
		target.emit('exit');

		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it('cleans up when the process ends on its own', () => {
		const target = fakeProcess();
		const cleanup = vi.fn();

		onStop(cleanup, target as unknown as NodeJS.Process);
		target.emit('exit');

		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(target.exits, 'no exit was asked for').toEqual([]);
	});
});

describe('arming the app', () => {
	it('arms the MCP child cleanup once, and stops on the signal', async () => {
		const close = vi.fn();
		vi.resetModules();
		vi.doMock('$lib/server/mcp/registry', () => ({ closeMcpServers: close }));
		const { armShutdown } = await import('$lib/server/lifecycle');
		const target = fakeProcess();

		armShutdown(target as unknown as NodeJS.Process);
		// The request hook runs again for every request, and only one stop is wanted.
		armShutdown(target as unknown as NodeJS.Process);

		expect(target.handlers.get('SIGTERM')).toHaveLength(1);
		target.emit('SIGTERM');
		expect(close, 'the children go before the process does').toHaveBeenCalledTimes(1);
		expect(target.exits).toEqual([0]);

		vi.doUnmock('$lib/server/mcp/registry');
	});
});
