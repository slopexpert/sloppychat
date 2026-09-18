import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { IncomingMessage } from 'node:http';

/**
 * SSRF resistant HTTP GET for web_fetch.
 *
 * Defenses, in the order they apply:
 *  1. only http and https, no credentials in the URL, no odd ports,
 *  2. every resolved address must be globally routable, so a name that points
 *     at loopback, a LAN, a cloud metadata service or a carrier NAT is refused,
 *  3. the socket connects to the address that was checked (IP pinning), which
 *     stops DNS rebinding between the check and the request,
 *  4. redirects are followed by hand and every hop repeats steps 1 to 3,
 *  5. the body is capped while it streams in.
 */

export class BlockedAddressError extends Error {
	constructor(
		readonly hostname: string,
		readonly address: string,
		readonly reason: string
	) {
		super(`${hostname} resolves to ${address}, which is ${reason}`);
	}
}

export class SafeFetchError extends Error {}

export interface SafeFetchOptions {
	allowPrivate?: boolean;
	/** Ports allowed for public hosts. Defaults to 80 and 443. */
	allowedPorts?: number[];
	maxBytes?: number;
	maxRedirects?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
	headers?: Record<string, string>;
}

export interface SafeFetchResult {
	url: string;
	status: number;
	headers: Record<string, string>;
	body: Uint8Array;
	truncated: boolean;
}

const DEFAULT_PORTS = [80, 443];
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 45000;
const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.home.arpa', '.lan', '.intranet'];

/* ------------------------------------------------------------ ip classification */

/**
 * Address ranges that must never be reached. `always` entries stay blocked even
 * when private hosts are allowed, because link local space holds the cloud
 * metadata services that are the classic SSRF target.
 */
const IPV4_BLOCKS: [string, number, 'always' | 'private'][] = [
	['0.0.0.0', 8, 'always'],
	['169.254.0.0', 16, 'always'],
	['224.0.0.0', 4, 'always'],
	['240.0.0.0', 4, 'always'],
	['10.0.0.0', 8, 'private'],
	['100.64.0.0', 10, 'private'], // carrier grade NAT
	['127.0.0.0', 8, 'private'],
	['172.16.0.0', 12, 'private'],
	['192.0.0.0', 24, 'private'],
	['192.0.2.0', 24, 'private'],
	['192.88.99.0', 24, 'private'],
	['192.168.0.0', 16, 'private'],
	['198.18.0.0', 15, 'private'],
	['198.51.100.0', 24, 'private'],
	['203.0.113.0', 24, 'private']
];

/** Why an IPv4 address is refused, or undefined when it may be used. */
function ipv4Blocked(ip: string, allowPrivate: boolean): string | undefined {
	const value = ipv4ToInt(ip);
	if (value === undefined) return undefined;
	for (const [base, bits, kind] of IPV4_BLOCKS) {
		if (kind === 'private' && allowPrivate) continue;
		const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
		const baseValue = ipv4ToInt(base);
		if (baseValue === undefined) continue;
		if ((value & mask) !== (baseValue & mask)) continue;
		if (base === '169.254.0.0') return 'a link local address, often a cloud metadata endpoint';
		if (base === '0.0.0.0') return 'the unspecified address';
		if (base === '224.0.0.0') return 'a multicast address';
		if (base === '240.0.0.0') return 'a reserved address';
		if (base === '127.0.0.0') return 'a loopback address';
		return 'a private or reserved address';
	}
	return undefined;
}

function ipv4ToInt(ip: string): number | undefined {
	const parts = ip.split('.');
	if (parts.length !== 4) return undefined;
	let value = 0;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return undefined;
		const octet = Number(part);
		if (octet > 255) return undefined;
		value = value * 256 + octet;
	}
	return value;
}


function parseIpv6(ip: string): Uint8Array | undefined {
	const zoneFree = ip.split('%')[0];
	const halves = zoneFree.split('::');
	if (halves.length > 2) return undefined;
	const head = halves[0] ? halves[0].split(':') : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	const groups: number[] = [];
	const push = (list: string[]): boolean => {
		for (const group of list) {
			if (group === '') continue;
			if (!/^[0-9a-f]{1,4}$/i.test(group)) {
				// Embedded IPv4 tail, for example ::ffff:192.0.2.1
				if (group.includes('.') && list === tail && tail.indexOf(group) === tail.length - 1) {
					const v4 = ipv4ToInt(group);
					if (v4 === undefined) return false;
					groups.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
					continue;
				}
				return false;
			}
			groups.push(Number.parseInt(group, 16));
		}
		return true;
	};
	if (!push(head)) return undefined;
	if (halves.length === 2) {
		const fill = 8 - head.filter(Boolean).length - tail.filter(Boolean).length;
		for (let i = 0; i < fill; i++) groups.push(0);
		if (!push(tail)) return undefined;
	}
	if (groups.length !== 8) return undefined;
	const bytes = new Uint8Array(16);
	groups.forEach((group, index) => {
		bytes[index * 2] = (group >> 8) & 0xff;
		bytes[index * 2 + 1] = group & 0xff;
	});
	return bytes;
}

function unwrapV4(bytes: Uint8Array, at: number): string {
	return `${bytes[at]}.${bytes[at + 1]}.${bytes[at + 2]}.${bytes[at + 3]}`;
}

/** Why an IPv6 address is refused, or undefined when it may be used. */
function ipv6Blocked(ip: string, allowPrivate: boolean): string | undefined {
	const bytes = parseIpv6(ip);
	if (!bytes) return 'not a usable address';
	const zeroPrefix = bytes.slice(0, 10).every((b) => b === 0);
	if (zeroPrefix && bytes[10] === 0xff && bytes[11] === 0xff) {
		return ipv4Blocked(unwrapV4(bytes, 12), allowPrivate);
	}
	if (bytes.every((b) => b === 0)) return 'the unspecified address';
	const loopback = zeroPrefix && bytes[10] === 0 && bytes[11] === 0 && bytes[15] === 1 && bytes.slice(12, 15).every((b) => b === 0);
	if (loopback) return allowPrivate ? undefined : 'a loopback address';
	// NAT64 well known prefix, the tail is the real IPv4 target.
	if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
		return ipv4Blocked(unwrapV4(bytes, 12), allowPrivate);
	}
	// 6to4 tunnels carry the IPv4 address right after the prefix.
	if (bytes[0] === 0x20 && bytes[1] === 0x02) return ipv4Blocked(unwrapV4(bytes, 2), allowPrivate);
	// Teredo, the embedded address is inverted, so block it outright.
	if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return 'a Teredo tunnel address';
	if ((bytes[0] & 0xfe) === 0xfc) return allowPrivate ? undefined : 'a unique local address';
	if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return 'a link local address';
	if (bytes[0] === 0xff) return 'a multicast address';
	if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return 'a documentation address';
	// Only global unicast (2000::/3) may pass.
	if ((bytes[0] & 0xe0) !== 0x20) return 'outside the global unicast range';
	return undefined;
}

/** Public classification helper, also used by the unit tests. */
export function blockedReason(address: string, allowPrivate: boolean): string | undefined {
	const version = isIP(address);
	if (version === 4) return ipv4Blocked(address, allowPrivate);
	if (version === 6) return ipv6Blocked(address, allowPrivate);
	return 'not an IP address';
}


/** Picks a routable address and returns it with the rest, or throws. */
async function resolvePinned(hostname: string, allowPrivate: boolean): Promise<string> {
	const records = await lookup(hostname, { all: true, verbatim: true }).catch(() => {
		throw new SafeFetchError(`Cannot resolve ${hostname}`);
	});
	if (!records.length) throw new SafeFetchError(`Cannot resolve ${hostname}`);
	const reasons: string[] = [];
	for (const record of records) {
		const reason = blockedReason(record.address, allowPrivate);
		if (!reason) return record.address;
		reasons.push(`${record.address} is ${reason}`);
	}
	throw new BlockedAddressError(hostname, records[0].address, reasons[0] ?? 'not routable');
}

function assertHostAllowed(hostname: string, options: SafeFetchOptions): void {
	if (options.allowPrivate === true) return;
	const lower = hostname.toLowerCase();
	if (lower === 'localhost' || BLOCKED_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
		throw new BlockedAddressError(hostname, hostname, 'a local name');
	}
	// A name without a dot is an intranet shortcut, never a public site.
	if (!lower.includes('.') && isIP(lower) === 0) {
		throw new BlockedAddressError(hostname, hostname, 'a single label intranet name');
	}
}

function assertPortAllowed(port: number, options: SafeFetchOptions): void {
	if (options.allowPrivate === true) return;
	const ports = options.allowedPorts ?? DEFAULT_PORTS;
	if (!ports.includes(port)) {
		throw new SafeFetchError(`Port ${port} is not allowed for public hosts (allowed: ${ports.join(', ')})`);
	}
}

/* ------------------------------------------------------------------ transport */

function decompressor(encoding: string) {
	if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip();
	if (encoding === 'deflate') return createInflate();
	if (encoding === 'br') return createBrotliDecompress();
	return undefined;
}

function requestOnce(
	url: URL,
	hostname: string,
	pinnedAddress: string,
	options: SafeFetchOptions
): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array; truncated: boolean }> {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const isHttps = url.protocol === 'https:';
	const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
	const path = `${url.pathname}${url.search}`;
	const headers: Record<string, string> = {
		// url.host keeps the brackets around IPv6 literals.
		host: url.host,
		accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
		'accept-encoding': 'gzip, deflate, br',
		'accept-language': 'en;q=0.9',
		'user-agent':
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 sloppychat/0.1',
		...options.headers
	};

	return new Promise((resolve, reject) => {
		const common = {
			// Connect to the checked address while keeping the original name for
			// the Host header and for TLS SNI plus certificate validation.
			host: pinnedAddress,
			servername: isHttps && isIP(hostname) === 0 ? hostname : undefined,
			port,
			path,
			method: 'GET',
			headers,
			signal: options.signal,
			timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			// The Host header is set from url.host above.
			setHost: false
		} as const;

		const req = isHttps
			? httpsRequest({ ...common, agent: false, rejectUnauthorized: true }, onResponse)
			: httpRequest({ ...common, agent: false }, onResponse);

		let settled = false;
		req.on('timeout', () => {
			req.destroy(new SafeFetchError(`Timed out after ${common.timeout} ms`));
		});
		req.on('error', (err) => {
			if (settled) return;
			settled = true;
			reject(err instanceof Error ? err : new SafeFetchError(String(err)));
		});
		req.end();

		function onResponse(res: IncomingMessage) {
			const status = res.statusCode ?? 0;
			const flatHeaders: Record<string, string> = {};
			for (const [key, value] of Object.entries(res.headers)) {
				if (typeof value === 'string') flatHeaders[key.toLowerCase()] = value;
				else if (Array.isArray(value)) flatHeaders[key.toLowerCase()] = value.join(', ');
			}
			const encoding = (flatHeaders['content-encoding'] ?? '').toLowerCase().trim();
			const decode = encoding && encoding !== 'identity' ? decompressor(encoding) : undefined;
			if (encoding && encoding !== 'identity' && !decode) {
				res.destroy();
				if (!settled) {
					settled = true;
					reject(new SafeFetchError(`Unsupported content encoding: ${encoding}`));
				}
				return;
			}
			const source = decode ? res.pipe(decode) : res;
			const chunks: Uint8Array[] = [];
			let size = 0;
			let truncated = false;
			source.on('data', (chunk: Buffer) => {
				if (truncated) return;
				chunks.push(new Uint8Array(chunk));
				size += chunk.byteLength;
				if (size >= maxBytes) {
					truncated = true;
					res.destroy();
					decode?.destroy();
					finish();
				}
			});
			const finish = () => {
				if (settled) return;
				settled = true;
				const body = new Uint8Array(size);
				let at = 0;
				for (const chunk of chunks) {
					body.set(chunk, at);
					at += chunk.byteLength;
				}
				resolve({ status, headers: flatHeaders, body, truncated });
			};
			source.on('end', finish);
			source.on('close', finish);
			source.on('error', (err) => {
				if (truncated) return finish();
				if (settled) return;
				settled = true;
				reject(err instanceof Error ? err : new SafeFetchError(String(err)));
			});
		}
	});
}

/** GETs a URL with every SSRF guard applied, following redirects by hand. */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new SafeFetchError(`Not a valid URL: ${rawUrl}`);
	}
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

	for (let hop = 0; hop <= maxRedirects; hop++) {
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw new SafeFetchError(`Only http and https are supported, got ${url.protocol}`);
		}
		if (url.username || url.password) {
			throw new SafeFetchError('URLs with embedded credentials are not fetched');
		}
		const isHttps = url.protocol === 'https:';
		const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
		if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new SafeFetchError(`Bad port: ${url.port}`);
		// url.hostname keeps the brackets on IPv6 literals, drop them for checks.
		const hostname = url.hostname.replace(/^\[|\]$/g, '');
		assertHostAllowed(hostname, options);
		const pinned = await resolvePinned(hostname, options.allowPrivate === true);
		assertPortAllowed(port, options);
		const response = await requestOnce(url, hostname, pinned, options);

		const location = response.headers.location;
		if (response.status >= 300 && response.status < 400 && location) {
			if (hop === maxRedirects) throw new SafeFetchError(`Too many redirects (limit ${maxRedirects})`);
			url = new URL(location, url);
			continue;
		}
		return { url: url.toString(), ...response };
	}
	throw new SafeFetchError('Too many redirects');
}
