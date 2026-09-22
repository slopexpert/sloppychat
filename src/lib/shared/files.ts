/**
 * Text and code attachments: plain files whose content is sent as text, with no
 * extraction step in between. The rules live here so the file picker, the upload
 * route and the prompt builder agree on what counts as a text file.
 *
 * A binary file is refused rather than guessed at: the check is on the bytes, so
 * a renamed object file still fails.
 */

/** Extensions read as text. Kept to what a chat is given, not every text format. */
export const TEXT_EXTENSIONS = new Set([
	'txt',
	'md',
	'markdown',
	'csv',
	'tsv',
	'json',
	'jsonc',
	'json5',
	'geojson',
	'jsonl',
	'ndjson',
	'yaml',
	'yml',
	'toml',
	'ini',
	'cfg',
	'conf',
	'properties',
	'env',
	'log',
	'xml',
	'html',
	'htm',
	'svg',
	'css',
	'scss',
	'less',
	'js',
	'mjs',
	'cjs',
	'jsx',
	'ts',
	'cts',
	'mts',
	'tsx',
	'vue',
	'svelte',
	'py',
	'pyi',
	'go',
	'rs',
	'java',
	'kt',
	'swift',
	'c',
	'h',
	'cc',
	'cpp',
	'hpp',
	'cs',
	'rb',
	'php',
	'lua',
	'pl',
	'r',
	'sql',
	'sh',
	'bash',
	'zsh',
	'fish',
	'ps1',
	'make',
	'diff',
	'patch',
	'po',
	'gradle',
	'tf',
	'hcl'
]);

/** Names without a useful extension, in lowercase. */
export const TEXT_FILE_NAMES = new Set([
	'makefile',
	'dockerfile',
	'containerfile',
	'cmakelists.txt',
	'gemfile',
	'rakefile',
	'procfile',
	'justfile',
	'readme',
	'license',
	'notice',
	'changelog',
	'authors'
]);

/** Extension without the dot, or the whole name when it has no extension. */
export function fileExtension(name: string): string {
	const base = (name ?? '').split(/[\\/]/).pop() ?? '';
	const dot = base.lastIndexOf('.');
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : base.toLowerCase();
}

/** True when the name or the reported type says plain text. */
export function isTextFile(file: { name: string; type?: string }): boolean {
	const type = (file.type ?? '').toLowerCase();
	if (type.startsWith('text/')) return true;
	if (type === 'application/json' || type === 'application/xml' || type === 'application/x-sh') return true;
	const base = (file.name ?? '').split(/[\\/]/).pop()?.toLowerCase() ?? '';
	if (TEXT_FILE_NAMES.has(base)) return true;
	return TEXT_EXTENSIONS.has(fileExtension(file.name));
}

/** The fence language for the file, so the model sees the code marked up. */
const FENCES: Record<string, string> = {
	md: 'markdown',
	markdown: 'markdown',
	json: 'json',
	jsonc: 'jsonc',
	json5: 'json5',
	geojson: 'json',
	jsonl: 'json',
	ndjson: 'json',
	yaml: 'yaml',
	yml: 'yaml',
	toml: 'toml',
	ini: 'ini',
	cfg: 'ini',
	conf: 'ini',
	properties: 'ini',
	env: 'ini',
	xml: 'xml',
	svg: 'xml',
	html: 'html',
	htm: 'html',
	vue: 'html',
	css: 'css',
	scss: 'scss',
	less: 'less',
	js: 'js',
	mjs: 'js',
	cjs: 'js',
	jsx: 'jsx',
	ts: 'ts',
	cts: 'ts',
	mts: 'ts',
	tsx: 'tsx',
	svelte: 'svelte',
	py: 'py',
	pyi: 'py',
	go: 'go',
	rs: 'rust',
	java: 'java',
	kt: 'kotlin',
	swift: 'swift',
	c: 'c',
	h: 'c',
	cc: 'cpp',
	cpp: 'cpp',
	hpp: 'cpp',
	cs: 'csharp',
	rb: 'ruby',
	php: 'php',
	lua: 'lua',
	pl: 'perl',
	r: 'r',
	sql: 'sql',
	sh: 'bash',
	bash: 'bash',
	zsh: 'bash',
	fish: 'bash',
	ps1: 'powershell',
	make: 'makefile',
	diff: 'diff',
	patch: 'diff',
	po: 'po',
	gradle: 'groovy',
	tf: 'hcl',
	hcl: 'hcl',
	csv: 'csv',
	tsv: 'tsv'
};

export function codeLanguage(name: string): string {
	const base = (name ?? '').split(/[\\/]/).pop()?.toLowerCase() ?? '';
	if (base === 'dockerfile' || base === 'containerfile') return 'dockerfile';
	if (base === 'makefile') return 'makefile';
	if (base === 'cmakelists.txt') return 'cmake';
	return FENCES[fileExtension(name)] ?? '';
}

/**
 * The accept list of the file picker. Files without an extension, Makefile for
 * example, are left out because a picker cannot list them; dropping them still
 * works, since the drop zone asks the server instead.
 */
export const TEXT_ACCEPT = [...TEXT_EXTENSIONS].map((ext) => `.${ext}`).join(',');

/** Largest text file read from disk. Larger files are refused, not truncated. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export class TextFileError extends Error {}

/**
 * A paste of at least this many characters becomes an attachment instead of
 * filling the composer, which keeps a long log or source file out of the way.
 */
export const PASTE_AS_FILE_CHARS = 2000;

/** Name for a pasted block: a stamp, and a counter when one is already pending. */
export function pastedName(now: Date = new Date(), index = 1): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
	return index > 1 ? `pasted-${stamp}-${index}.txt` : `pasted-${stamp}.txt`;
}

/**
 * Decodes bytes as UTF-8 text. A byte pattern that belongs to a binary file is
 * refused, because the text of an executable only wastes the window.
 */
export function decodeText(bytes: Uint8Array, name = 'file'): string {
	if (!bytes.length) throw new TextFileError(`${name} is empty`);
	if (bytes.length > MAX_TEXT_BYTES) {
		throw new TextFileError(`${name} is larger than ${Math.round(MAX_TEXT_BYTES / 1024 / 1024)} MB`);
	}
	const head = bytes.subarray(0, Math.min(bytes.length, 8000));
	let control = 0;
	for (const byte of head) {
		// NUL is the usual sign of a binary file, and no text format allows it.
		if (byte === 0) throw new TextFileError(`${name} is not a text file`);
		if (byte < 9 || (byte > 13 && byte < 32 && byte !== 27)) control++;
	}
	if (control / head.length > 0.02) throw new TextFileError(`${name} is not a text file`);

	// Not fatal on purpose: one bad byte should not lose the whole file.
	let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	return text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

/** Lines of the text, used by the chip and the message row. */
export function countLines(text: string): number {
	if (!text) return 0;
	let lines = 1;
	for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) lines++;
	return lines;
}

/** The block added to the prompt for one text file. */
export function textFileBlock(name: string, text: string, cap: number): string {
	const lang = codeLanguage(name);
	const body = text.length > cap ? `${text.slice(0, cap)}\n\n[file text truncated]` : text;
	const fence = '`'.repeat(Math.max(3, longestFence(body) + 1));
	return `Content of the attached file "${name}":\n\n${fence}${lang}\n${body}\n${fence}`;
}

/** A fence long enough to hold any run of backticks inside the body. */
function longestFence(body: string): number {
	let longest = 0;
	for (const match of body.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
	return longest;
}
