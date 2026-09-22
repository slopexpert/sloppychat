import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	PASTE_AS_FILE_CHARS,
	codeLanguage,
	countLines,
	decodeText,
	fileExtension,
	isTextFile,
	pastedName,
	textFileBlock
} from '$lib/shared/files';
import { toUpstreamMessages } from '$lib/server/openai';
import type { Message } from '$lib/shared/types';

/** Text and code files reach the model as a fenced block, nothing else. */

describe('fileExtension and isTextFile', () => {
	it('reads the extension, and the name when there is none', () => {
		expect(fileExtension('src/app.Server.ts')).toBe('ts');
		expect(fileExtension('Makefile')).toBe('makefile');
		expect(fileExtension('.gitignore')).toBe('.gitignore');
	});

	it('takes source, markup and data by extension', () => {
		for (const name of ['a.ts', 'a.py', 'a.md', 'a.json', 'a.csv', 'a.sql', 'a.svg', 'a.diff']) {
			expect(isTextFile({ name, type: '' }), name).toBe(true);
		}
	});

	it('takes JSON with comments and the other JSON dialects', () => {
		for (const name of ['settings.jsonc', 'data.json5', 'map.geojson']) {
			expect(isTextFile({ name, type: '' }), name).toBe(true);
		}
		expect(codeLanguage('settings.jsonc')).toBe('jsonc');
	});

	it('takes a bare name that is known on its own', () => {
		expect(isTextFile({ name: 'Dockerfile', type: '' })).toBe(true);
		expect(isTextFile({ name: 'dir/Makefile', type: '' })).toBe(true);
	});

	it('takes anything the browser calls text', () => {
		expect(isTextFile({ name: 'mystery', type: 'text/plain' })).toBe(true);
		expect(isTextFile({ name: 'mystery', type: 'application/json' })).toBe(true);
	});

	it('refuses images, archives and files with no clue', () => {
		for (const name of ['a.png', 'a.zip', 'a.pdf', 'a.wasm', 'mystery']) {
			expect(isTextFile({ name, type: '' }), name).toBe(false);
		}
	});
});

describe('codeLanguage', () => {
	it('marks the fence with the language the model expects', () => {
		expect(codeLanguage('app.tsx')).toBe('tsx');
		expect(codeLanguage('main.rs')).toBe('rust');
		expect(codeLanguage('Dockerfile')).toBe('dockerfile');
		expect(codeLanguage('Makefile')).toBe('makefile');
	});

	it('leaves plain prose unmarked', () => {
		expect(codeLanguage('notes.txt')).toBe('');
		expect(codeLanguage('mystery')).toBe('');
	});
});

describe('decodeText', () => {
	const bytes = (value: string) => new TextEncoder().encode(value);

	it('normalises line ends, the byte order mark, and trailing spaces', () => {
		expect(decodeText(bytes('\ufeffone  \r\ntwo\t\r\n'))).toBe('one\ntwo');
	});

	it('refuses an empty file and a binary one', () => {
		expect(() => decodeText(new Uint8Array(0), 'a.txt')).toThrow(/empty/);
		expect(() => decodeText(bytes('a\0b'), 'a.txt')).toThrow(/not a text file/);
	});

	it('refuses a file that is mostly control characters', () => {
		const binary = Uint8Array.from(Array.from({ length: 400 }, (_, i) => (i % 4 === 0 ? 1 : 2)));
		expect(() => decodeText(binary, 'a.bin')).toThrow(/not a text file/);
	});

	it('keeps one bad byte instead of losing the file', () => {
		expect(decodeText(Uint8Array.from([0x61, 0xff, 0x62]), 'a.txt')).toContain('a');
	});
});

describe('countLines', () => {
	it('counts the last line even without a line feed', () => {
		expect(countLines('a\nb\nc')).toBe(3);
		expect(countLines('a\n')).toBe(2);
		expect(countLines('')).toBe(0);
	});
});

describe('textFileBlock', () => {
	it('names the file and marks the language', () => {
		const block = textFileBlock('app.ts', 'const a = 1;', 1000);
		expect(block).toContain('Content of the attached file "app.ts"');
		expect(block).toContain('```ts\nconst a = 1;\n```');
	});

	it('cuts at the cap and says so', () => {
		const block = textFileBlock('a.txt', 'x'.repeat(50), 10);
		expect(block).toContain('x'.repeat(10));
		expect(block).toContain('[file text truncated]');
	});

	it('outgrows a run of backticks inside the body', () => {
		// A three backtick run cannot close a four backtick fence.
		const block = textFileBlock('a.md', '```x```', 1000);
		expect(block).toContain('````markdown');
		expect(block).toContain('\n````');
	});

	it('keeps a plain fence for a shorter run', () => {
		const block = textFileBlock('a.md', '``code``', 1000);
		expect(block).toContain('```markdown');
	});
});

describe('pastedName', () => {
	it('stamps the name with the local clock', () => {
		expect(pastedName(new Date(2026, 7, 14, 17, 5))).toBe('pasted-20260814-1705.txt');
	});

	it('counts up while another paste is still pending', () => {
		expect(pastedName(new Date(2026, 7, 14, 17, 5), 2)).toBe('pasted-20260814-1705-2.txt');
	});

	it('keeps the threshold well clear of an ordinary paste', () => {
		expect(PASTE_AS_FILE_CHARS).toBeGreaterThanOrEqual(1000);
	});
});

/* ------------------------------------------------- the block that is actually sent */

const dir = mkdtempSync(join(tmpdir(), 'sloppychat-files-'));
process.env.SLOPPYCHAT_DB = join(dir, 'files.db');

const store = await import('$lib/server/store');

function userMessage(documents: Message['documents']): Message {
	return {
		id: 'm1',
		conversationId: 'c1',
		role: 'user',
		text: 'Look at this',
		images: [],
		documents,
		createdAt: ''
	};
}

function textOf(message: ReturnType<typeof toUpstreamMessages>[number]): string {
	const content = message.content;
	return Array.isArray(content) ? content.map((part) => part.text ?? '').join('\n') : String(content);
}

describe('the prompt builder with attachments', () => {
	it('inlines a text file inside a fence, after the question', () => {
		store.saveDocument('d1', 'src/app.ts', 'text/plain', 0, 'const a = 1;');
		const [message] = toUpstreamMessages([userMessage([{ id: 'd1', name: 'src/app.ts', pages: 0, lines: 1, chars: 13 }])]);
		const text = textOf(message);
		expect(text).toContain('Look at this');
		expect(text).toContain('Content of the attached file "src/app.ts"');
		expect(text).toContain('```ts\nconst a = 1;\n```');
		expect(text).not.toContain('pages');
	});

	it('keeps the PDF wording for a document with pages', () => {
		store.saveDocument('d2', 'report.pdf', 'application/pdf', 3, 'Extracted body');
		const [message] = toUpstreamMessages([userMessage([{ id: 'd2', name: 'report.pdf', pages: 3, chars: 14 }])]);
		const text = textOf(message);
		expect(text).toContain('attached document "report.pdf" (3 pages)');
		expect(text).toContain('Extracted body');
	});

	it('caps each kind by its own setting', () => {
		store.saveDocument('d3', 'big.txt', 'text/plain', 0, 'y'.repeat(100));
		const [message] = toUpstreamMessages([userMessage([{ id: 'd3', name: 'big.txt', pages: 0, lines: 1, chars: 100 }])], {
			textMaxChars: 20
		});
		const text = textOf(message);
		expect(text).toContain('y'.repeat(20));
		expect(text).toContain('[file text truncated]');
		expect(text).not.toContain('y'.repeat(21));
	});
});

/* --------------------------------------------------------- the routes on their own */

describe('the attachment routes', () => {
	it('gives the stored text of one document, and 404 for none', async () => {
		const route = await import('../src/routes/api/documents/[id]/+server');
		store.saveDocument('d4', 'notes.md', 'text/plain', 0, '# Title\nbody');
		const found = await route.GET({ params: { id: 'd4' } } as never);
		expect(found.status).toBe(200);
		const body = await found.json();
		expect(body.document.text).toContain('# Title');
		expect(body.document.lines).toBe(2);
		expect(body.document.truncated).toBe(false);
		const missing = await route.GET({ params: { id: 'nope' } } as never);
		expect(missing.status).toBe(404);
	});

	it('stores a message that is only an attachment', async () => {
		const messages = await import('../src/routes/api/conversations/[id]/messages/+server');
		const conversation = store.createConversation({ title: 'Attachment only' });
		store.saveDocument('d6', 'notes.md', 'text/plain', 0, '# Title\nbody');
		const response = await messages.POST({
			params: { id: conversation.id },
			request: new Request('http://local/api/conversations/x/messages', {
				method: 'POST',
				body: JSON.stringify({ text: '', documents: [{ id: 'd6', name: 'notes.md', pages: 0, chars: 12 }] })
			})
		} as never);
		expect(response.status).toBe(201);
		const { message } = await response.json();
		expect(message.text).toBe('');
		expect(message.documents).toHaveLength(1);
	});

	it('keeps the line count when a message is stored', async () => {
		const messages = await import('../src/routes/api/conversations/[id]/messages/+server');
		const conversation = store.createConversation({ title: 'Attachments' });
		store.saveDocument('d5', 'src/app.ts', 'text/plain', 0, 'const a = 1;\nconst b = 2;');
		const response = await messages.POST({
			params: { id: conversation.id },
			request: new Request('http://local/api/conversations/x/messages', {
				method: 'POST',
				body: JSON.stringify({
					text: 'read it',
					documents: [{ id: 'd5', name: 'src/app.ts', pages: 0, chars: 25 }]
				})
			})
		} as never);
		expect(response.status).toBe(201);
		const { message } = await response.json();
		expect(message.documents[0].lines).toBe(2);
		expect(message.documents[0].chars).toBe(25);
	});
});
