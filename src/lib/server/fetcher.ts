import { htmlToMarkdown } from './reader/extract';
import { safeFetch, type SafeFetchResult } from './safe-fetch';

/**
 * web_fetch backend: guarded GET plus reader mode extraction.
 * The page chrome removal lives in ./reader, ported from pi-minimal-web.
 */

export interface FetchPage {
	url: string;
	status: number;
	contentType: string;
	title?: string;
	mode: 'reader' | 'fallback' | 'raw';
	markdown: string;
	truncated: boolean;
	bytes: number;
}

export interface FetchOptions {
	maxChars: number;
	allowPrivate: boolean;
	/** Return the untouched body instead of reader mode markdown. */
	raw?: boolean;
	signal?: AbortSignal;
}

const MAX_BYTES = 4 * 1024 * 1024;
const TEXTUAL = /^text\/|^application\/(json|xml|xhtml|javascript|yaml|x-yaml)/;

function decodeUtf8(body: Uint8Array, contentType: string, charsetHint?: string): string {
	const charset = (contentType.match(/charset=([\w-]+)/i)?.[1] ?? charsetHint ?? 'utf-8').toLowerCase();
	try {
		return new TextDecoder(charset, { fatal: false }).decode(body);
	} catch {
		return new TextDecoder('utf-8', { fatal: false }).decode(body);
	}
}

/** Pulls the charset out of the HTML head when the header does not carry one. */
function metaCharset(head: string): string | undefined {
	const direct = head.match(/<meta[^>]+charset=["']?([\w-]+)/i);
	if (direct) return direct[1];
	const declared = head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i);
	return declared?.[1];
}

function clamp(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) return { text, truncated: false };
	const cut = text.slice(0, maxChars);
	const newline = cut.lastIndexOf('\n');
	return { text: (newline > maxChars * 0.6 ? cut.slice(0, newline) : cut) + '\n\n[truncated]', truncated: true };
}

export async function fetchPage(rawUrl: string, options: FetchOptions): Promise<FetchPage> {
	const response: SafeFetchResult = await safeFetch(rawUrl, {
		allowPrivate: options.allowPrivate,
		maxBytes: MAX_BYTES,
		signal: options.signal
	});

	const contentType = (response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
	const isHtml = contentType === '' || contentType === 'text/html' || contentType === 'application/xhtml+xml';

	if (options.raw) {
		if (contentType && !TEXTUAL.test(contentType)) {
			return {
				url: response.url,
				status: response.status,
				contentType,
				mode: 'raw',
				markdown: `[${response.status}] ${contentType} at ${response.url} is binary and was skipped.`,
				truncated: false,
				bytes: response.body.byteLength
			};
		}
		const head = decodeUtf8(response.body.slice(0, 4096), contentType);
		const text = decodeUtf8(response.body, contentType, metaCharset(head));
		const kept = clamp(text.trim(), options.maxChars);
		return {
			url: response.url,
			status: response.status,
			contentType,
			mode: 'raw',
			markdown: kept.text,
			truncated: kept.truncated || response.truncated,
			bytes: response.body.byteLength
		};
	}

	if (!isHtml) {
		if (TEXTUAL.test(contentType)) {
			const text = decodeUtf8(response.body, contentType);
			const kept = clamp(text.trim(), options.maxChars);
			return {
				url: response.url,
				status: response.status,
				contentType,
				mode: 'raw',
				markdown: kept.text,
				truncated: kept.truncated || response.truncated,
				bytes: response.body.byteLength
			};
		}
		return {
			url: response.url,
			status: response.status,
			contentType: contentType || 'unknown',
			mode: 'raw',
			markdown: `[${response.status}] ${contentType || 'unknown type'} at ${response.url} is not text and was not read.`,
			truncated: false,
			bytes: response.body.byteLength
		};
	}

	const head = decodeUtf8(response.body.slice(0, 4096), contentType);
	const html = decodeUtf8(response.body, contentType, metaCharset(head));
	const extracted = htmlToMarkdown(html, response.url);
	const kept = clamp(extracted.markdown.trim(), options.maxChars);
	return {
		url: response.url,
		status: response.status,
		contentType,
		title: extracted.title,
		mode: extracted.mode,
		markdown: kept.text,
		truncated: kept.truncated || response.truncated,
		bytes: response.body.byteLength
	};
}
