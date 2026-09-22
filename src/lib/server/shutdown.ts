/**
 * Cleanup for the moment the process stops.
 *
 * A MCP server that runs as a child process belongs to this process. If the
 * process goes away without closing it, the child stays behind with its input
 * pipe open, and a restart leaves another one next to it.
 */

/**
 * Runs the cleanup once, however the process stops: a signal, a normal end, or
 * a crash. A signal takes the default action away, so the stop is finished by
 * hand after the cleanup.
 */
export function onStop(cleanup: () => void, target: NodeJS.Process = process): void {
	let done = false;
	const run = (): void => {
		if (done) return;
		done = true;
		cleanup();
	};
	const stop = (): void => {
		run();
		target.exit(0);
	};
	target.once('SIGTERM', stop);
	target.once('SIGINT', stop);
	// An end of its own still has to close what the process opened.
	target.on('exit', run);
}
