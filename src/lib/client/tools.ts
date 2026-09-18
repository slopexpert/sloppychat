/**
 * How one tool call is going, for the tool card. The server runs the tools and
 * reports each step, so this is a view of the server state, not a queue of work.
 */
export interface ToolProgress {
	state: 'running' | 'done' | 'error' | 'ask';
	detail?: string;
	/** Structured payload for a richer card, for example search hits. */
	data?: unknown;
}

/**
 * True when a key press means allow once: Enter, with no other key held. A field
 * keeps Enter for itself, unless the user left it empty, where Enter does
 * nothing else. This is what makes the answer a single keystroke away.
 */
export function isApproveKey(event: {
	key: string;
	shiftKey?: boolean;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	target?: unknown;
}): boolean {
	if (event.key !== 'Enter') return false;
	if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
	if (!event.target || typeof event.target !== 'object') return true;
	const element = event.target as { tagName?: string; isContentEditable?: boolean; value?: string };
	if (element.isContentEditable) return false;
	const tag = (element.tagName ?? '').toUpperCase();
	if (tag === 'SELECT') return false;
	if (tag === 'INPUT' || tag === 'TEXTAREA') return (element.value ?? '').trim() === '';
	return true;
}
