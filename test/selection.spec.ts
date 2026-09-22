import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from '../src/routes/+page.svelte';
import { quoteSpot } from '$lib/shared/selection';

describe('quoteSpot', () => {
	it('floats the chip above the selection', () => {
		expect(quoteSpot({ top: 300, bottom: 320, left: 120 }, 1200)).toEqual({ x: 120, y: 266 });
	});

	it('drops it under the selection near the top of the window', () => {
		expect(quoteSpot({ top: 20, bottom: 40, left: 40 }, 1200)).toEqual({ x: 40, y: 46 });
	});

	it('keeps the chip inside a narrow window', () => {
		expect(quoteSpot({ top: 300, bottom: 320, left: 1160 }, 1200).x).toBe(1084);
	});

	it('never goes left of the edge', () => {
		expect(quoteSpot({ top: 300, bottom: 320, left: -40 }, 1200).x).toBe(8);
	});
});

describe('the quote chip', () => {
	it('is absent while nothing is selected', () => {
		const { body } = render(Page);
		expect(body).not.toContain('Quote the selection in the message box');
	});
});
