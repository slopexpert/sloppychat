import { describe, expect, it } from 'vitest';
import { pageTitle } from '$lib/shared/title';

describe('the page title', () => {
	it('puts the open chat first', () => {
		expect(pageTitle('Release notes')).toBe('Release notes / sloppychat');
	});

	it('falls back to the app name', () => {
		expect(pageTitle()).toBe('sloppychat');
		expect(pageTitle('')).toBe('sloppychat');
		expect(pageTitle('   ')).toBe('sloppychat');
	});
});
