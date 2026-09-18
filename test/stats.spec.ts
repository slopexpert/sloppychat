import { describe, expect, it } from 'vitest';
import {
	contextUsage,
	formatBriefStats,
	formatPrefillStats,
	formatRate,
	formatSeconds,
	formatTokens,
	formatUsageLine,
	liveRate,
	ratesOf,
	usageTooltip
} from '$lib/shared/stats';
import type { Message } from '$lib/shared/types';

describe('ratesOf', () => {
	it('computes prefill and generation rates from timing', () => {
		const rates = ratesOf({ prompt: 1024, completion: 200, ttftMs: 500, decodeMs: 4000 });
		expect(rates.pp).toBeCloseTo(2048, 5);
		expect(rates.tg).toBeCloseTo(50, 5);
	});

	it('leaves rates out when the timing is missing', () => {
		expect(ratesOf({ prompt: 10, completion: 5 })).toEqual({
			pp: undefined,
			tg: undefined,
			ttftMs: undefined,
			decodeMs: undefined
		});
		expect(ratesOf(undefined)).toEqual({});
	});

	it('ignores a zero length decode window', () => {
		expect(ratesOf({ completion: 7, decodeMs: 0 }).tg).toBeUndefined();
	});
});

describe('formatting', () => {
	it('scales precision with the value', () => {
		expect(formatRate(1250.4)).toBe('1250 tok/s');
		expect(formatRate(42.5)).toBe('42.5 tok/s');
		expect(formatRate(3.456)).toBe('3.46 tok/s');
		expect(formatRate(undefined)).toBeUndefined();
	});

	it('formats milliseconds and seconds', () => {
		expect(formatSeconds(320)).toBe('320 ms');
		expect(formatSeconds(2400)).toBe('2.40 s');
	});

	it('builds one line with only the numbers it has', () => {
		const line = formatUsageLine({ prompt: 2048, completion: 256, ttftMs: 1000, decodeMs: 6400 });
		expect(line).toContain('pp 2048 tok/s');
		expect(line).toContain('tg 40.0 tok/s');
		expect(line).toContain('ttft 1.00 s');
		expect(line).toContain('256 tok');
	});

	it('marks estimated counts', () => {
		expect(formatUsageLine({ completion: 30, estimated: true })).toContain('30 tok est');
	});

	it('returns an empty line without usage', () => {
		expect(formatUsageLine(undefined)).toBe('');
	});
});

describe('server reported timings', () => {
	it('prefers rates from the runtime over calculated ones', () => {
		// The wall clock numbers would give 100 tok/s and 20 tok/s.
		const rates = ratesOf({
			prompt: 100,
			completion: 200,
			ttftMs: 1000,
			decodeMs: 10000,
			ppRate: 32.3,
			tgRate: 52.94,
			reported: true
		});
		expect(rates.pp).toBe(32.3);
		expect(rates.tg).toBe(52.94);
	});

	it('falls back to the calculated rates when there is no report', () => {
		const rates = ratesOf({ prompt: 100, completion: 200, ttftMs: 1000, decodeMs: 10000 });
		expect(rates.pp).toBeCloseTo(100, 5);
		expect(rates.tg).toBeCloseTo(20, 5);
	});

	it('marks the line as coming from the server', () => {
		const line = formatUsageLine({
			prompt: 1024,
			completion: 254,
			ttftMs: 41.2,
			decodeMs: 1830.5,
			tgRate: 78.74,
			reported: true
		});
		expect(line).toContain('tg 78.7 tok/s');
		expect(line).toContain('server');
	});

	it('explains the numbers in the tooltip', () => {
		const reported = usageTooltip({
			completion: 10,
			reported: true,
			queueMs: 3.1,
			cachedPrompt: 236
		});
		expect(reported).toContain('reported by the server');
		expect(reported).toContain('queue wait 3 ms');
		expect(reported).toContain('236 prompt tokens from the prefix cache');

		const measured = usageTooltip({ completion: 10 });
		expect(measured).toContain('measured around the HTTP call');

		const estimated = usageTooltip({ completion: 10, estimated: true });
		expect(estimated).toContain('estimated from text length');
	});
});

describe('liveRate', () => {
	it('estimates tokens per second from characters', () => {
		// 400 characters in 2 seconds is 100 tokens over 2 seconds.
		expect(liveRate(400, 2000)).toBeCloseTo(50, 5);
	});

	it('stays undefined before any output', () => {
		expect(liveRate(0, 500)).toBeUndefined();
		expect(liveRate(100, 0)).toBeUndefined();
	});
});

/* ------------------------------------------------------------ context gauge */

function message(overrides: Partial<Message> = {}): Message {
	return {
		id: 'm',
		conversationId: 'c',
		role: 'user',
		text: '',
		images: [],
		createdAt: new Date(0).toISOString(),
		...overrides
	};
}

describe('contextUsage', () => {
	it('uses the last usage report for everything up to that turn', () => {
		const messages = [
			message({ role: 'user', text: 'x'.repeat(400) }),
			message({ role: 'assistant', text: 'y'.repeat(400), usage: { prompt: 1200, completion: 100 } })
		];
		const usage = contextUsage({ messages, system: 'ignored, already counted', window: 8192 });
		expect(usage.used).toBe(1300);
		expect(usage.measured).toBe(true);
		expect(usage.window).toBe(8192);
		expect(usage.ratio).toBeCloseTo(1300 / 8192, 6);
	});

	it('estimates only the messages newer than the report', () => {
		const messages = [
			message({ role: 'assistant', text: 'answer', usage: { prompt: 1000, completion: 200 } }),
			message({ role: 'tool', text: 'z'.repeat(400) }),
			message({ role: 'user', text: 'w'.repeat(40) })
		];
		// 1200 from the report, then 100 + 10 estimated from the two newer messages.
		expect(contextUsage({ messages, window: 10000 }).used).toBe(1310);
	});

	it('counts images roughly when they are not covered by a report', () => {
		const messages = [message({ text: '', images: [{ id: 'i', mime: 'image/png' }] })];
		expect(contextUsage({ messages }).used).toBe(750);
	});

	it('estimates the whole conversation when there is no report', () => {
		const messages = [message({ text: 'a'.repeat(400) }), message({ role: 'assistant', text: 'b'.repeat(200) })];
		const usage = contextUsage({ messages, system: 'c'.repeat(40) });
		expect(usage.used).toBe(100 + 50 + 10);
		expect(usage.measured).toBe(false);
		expect(usage.ratio).toBeUndefined();
	});

	it('reports no ratio without a window', () => {
		const usage = contextUsage({ messages: [message({ text: 'hello' })] });
		expect(usage.window).toBeUndefined();
		expect(usage.ratio).toBeUndefined();
	});

	it('ignores a zero window', () => {
		expect(contextUsage({ messages: [message({ text: 'hello' })], window: 0 }).ratio).toBeUndefined();
	});

	it('is empty for an empty conversation', () => {
		expect(contextUsage({ messages: [] })).toEqual({ used: 0, window: undefined, ratio: undefined, measured: false });
	});
});

describe('formatBriefStats', () => {
	it('keeps to the generation rate and the length', () => {
		expect(formatBriefStats({ completion: 256, decodeMs: 6400, tgRate: 40 })).toBe('40.0 tok/s · 256 tok');
	});

	it('leaves out what it does not know', () => {
		expect(formatBriefStats({ completion: 256 })).toBe('256 tok');
		expect(formatBriefStats({ decodeMs: 1000 })).toBe('');
		expect(formatBriefStats(undefined)).toBe('');
	});
});

describe('formatPrefillStats', () => {
	it('shows the prompt speed on its own', () => {
		expect(formatPrefillStats({ prompt: 2048, ttftMs: 1000, ppRate: 2048 })).toBe('2048 tok/s');
	});

	it('computes the rate when only counts were reported', () => {
		expect(formatPrefillStats({ prompt: 1000, ttftMs: 500 })).toBe('2000 tok/s');
	});

	it('shows nothing when only the wait is known', () => {
		expect(formatPrefillStats({ ttftMs: 1200 })).toBe('');
	});

	it('shows nothing without timing', () => {
		expect(formatPrefillStats({ completion: 10 })).toBe('');
		expect(formatPrefillStats(undefined)).toBe('');
	});
});

describe('formatTokens', () => {
	it('scales the unit with the size', () => {
		expect(formatTokens(0)).toBe('0');
		expect(formatTokens(980)).toBe('980');
		expect(formatTokens(1234)).toBe('1.2k');
		expect(formatTokens(24680)).toBe('24.7k');
		expect(formatTokens(1_050_000)).toBe('1.05M');
		expect(formatTokens(undefined)).toBe('');
	});
});
