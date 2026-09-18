import { describe, expect, it } from 'vitest';
import { BlockedAddressError, SafeFetchError, blockedReason, safeFetch } from '$lib/server/safe-fetch';

/** Collects the refusal reason for a URL, or fails when the URL is not refused. */
async function refusalFor(url: string): Promise<string> {
	try {
		await safeFetch(url, { timeoutMs: 3000 });
	} catch (err) {
		if (err instanceof BlockedAddressError) return `${err.hostname}: ${err.reason}`.toLowerCase();
		if (err instanceof SafeFetchError) return `safe: ${err.message}`.toLowerCase();
		throw err;
	}
	throw new Error(`expected ${url} to be refused`);
}

describe('safeFetch SSRF guard', () => {
	it('refuses loopback IPv4', async () => {
		expect(await refusalFor('http://127.0.0.1:8080/')).toMatch(/loopback/);
	});

	it('refuses the loopback hostname', async () => {
		expect(await refusalFor('http://localhost/')).toMatch(/local name|loopback/);
	});

	it('refuses loopback IPv6', async () => {
		expect(await refusalFor('http://[::1]/')).toMatch(/loopback/);
	});

	it('refuses the cloud metadata address', async () => {
		expect(await refusalFor('http://169.254.169.254/latest/meta-data/')).toMatch(/link local|private/);
	});

	it('refuses private ranges', async () => {
		expect(await refusalFor('http://10.1.2.3/')).toMatch(/private/);
		expect(await refusalFor('http://192.168.0.1/')).toMatch(/private/);
		expect(await refusalFor('http://172.16.5.5/')).toMatch(/private/);
		expect(await refusalFor('http://100.64.0.1/')).toMatch(/private/);
	});

	it('refuses IPv4 mapped IPv6 and NAT64 forms of loopback', async () => {
		expect(await refusalFor('http://[::ffff:127.0.0.1]/')).toMatch(/loopback/);
		expect(await refusalFor('http://[64:ff9b::127.0.0.1]/')).toMatch(/loopback/);
	});

	it('refuses unique local and link local IPv6', async () => {
		expect(await refusalFor('http://[fd00::1]/')).toMatch(/unique local/);
		expect(await refusalFor('http://[fe80::1]/')).toMatch(/link local/);
	});

	it('refuses intranet names and unexpected ports', async () => {
		expect(await refusalFor('http://intranet/')).toMatch(/single label/);
		expect(await refusalFor('http://example.com:8080/')).toMatch(/port 8080/);
	});

	it('refuses other schemes and embedded credentials', async () => {
		expect(await refusalFor('file:///etc/passwd')).toMatch(/only http and https/);
		expect(await refusalFor('gopher://example.com/')).toMatch(/only http and https/);
		expect(await refusalFor('http://user:pass@example.com/')).toMatch(/credentials/);
	});
});

describe('blockedReason with private hosts allowed', () => {
	it('still blocks link local and metadata addresses', () => {
		expect(blockedReason('169.254.169.254', true)).toMatch(/link local/);
		expect(blockedReason('169.254.1.1', true)).toBeTruthy();
		expect(blockedReason('fe80::1', true)).toMatch(/link local/);
	});

	it('still blocks multicast, reserved and unspecified space', () => {
		expect(blockedReason('224.0.0.1', true)).toMatch(/multicast/);
		expect(blockedReason('255.255.255.255', true)).toBeTruthy();
		expect(blockedReason('0.0.0.0', true)).toMatch(/unspecified/);
		expect(blockedReason('ff02::1', true)).toMatch(/multicast/);
	});

	it('allows loopback, RFC1918 and unique local addresses', () => {
		expect(blockedReason('127.0.0.1', true)).toBeUndefined();
		expect(blockedReason('10.0.0.5', true)).toBeUndefined();
		expect(blockedReason('192.168.1.20', true)).toBeUndefined();
		expect(blockedReason('100.64.0.7', true)).toBeUndefined();
		expect(blockedReason('::1', true)).toBeUndefined();
		expect(blockedReason('fd00::1', true)).toBeUndefined();
	});

	it('keeps the strict list when private hosts are off', () => {
		expect(blockedReason('127.0.0.1', false)).toMatch(/loopback/);
		expect(blockedReason('10.0.0.5', false)).toBeTruthy();
		expect(blockedReason('fd00::1', false)).toMatch(/unique local/);
		expect(blockedReason('1.1.1.1', false)).toBeUndefined();
		expect(blockedReason('2606:4700::1111', false)).toBeUndefined();
	});
});
