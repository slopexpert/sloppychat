import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Layout invariants that no server rendered test can catch, because they depend
 * on how the browser sizes things. The compiled stylesheet was measured by hand
 * in a browser for each of these; the checks below keep the cause in place.
 */

const topBar = readFileSync('src/lib/components/TopBar.svelte', 'utf8');
const messageItem = readFileSync('src/lib/components/MessageItem.svelte', 'utf8');

describe('top bar', () => {
	it('does not change height when the chat title is renamed', () => {
		// The field replaces the heading inside the same flexible container, so the
		// other controls keep their place, and its height matches the icon buttons
		// (padding 6px + 18px icon + 6px + border = 32px) instead of the 35px a
		// default field asks for.
		expect(topBar).toContain('class="field h-8 min-w-0 flex-1 py-0 text-sm"');
		// One container, used by both the heading and the field.
		expect(topBar.match(/class="flex min-w-0 flex-1 items-center gap-1"/g)).toHaveLength(1);
	});

	it('keeps the model picker from demanding a fixed width', () => {
		// A fixed width would wrap the bar on a narrow window.
		expect(topBar).toContain('field w-36 text-xs sm:w-52 md:w-64');
	});
});

describe('message bubbles', () => {
	it('hugs the text so a wide caption cannot stretch it', () => {
		expect(messageItem).toContain('ml-auto w-fit rounded-card bg-accent');
	});
});
