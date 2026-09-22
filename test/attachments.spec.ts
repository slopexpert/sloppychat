import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '$lib/client/api';
import { app } from '$lib/client/state.svelte';
import type { DocumentRef, ImageRef } from '$lib/shared/types';

/**
 * An upload writes a row, and a row that nothing points at stays for the life of
 * the database. So when the user removes an attachment from the composer, the
 * route has to take the row back. A row a message already names is a different
 * case: the chat still reads it back, so it stays.
 *
 * The store reads the database path when the module loads, so the data directory
 * is set before the first server import.
 */

process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-attachments-'));

const store = await import('$lib/server/store');
const images = await import('../src/routes/api/images/[id]/+server');
const documents = await import('../src/routes/api/documents/[id]/+server');

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** Runs one DELETE request through the route and gives back the status and body. */
async function drop(
	route: { DELETE: (event: never) => Response | Promise<Response> },
	id: string
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await route.DELETE({ params: { id } } as never);
	return { status: response.status, body: await response.json() };
}

describe('an image row', () => {
	it('goes when the user drops the attachment', async () => {
		store.saveImage('img-drop', 'image/png', png);

		const result = await drop(images, 'img-drop');

		expect(result.status).toBe(200);
		expect(result.body.dropped).toBe(true);
		expect(store.getImage('img-drop'), 'the bytes must leave too').toBeUndefined();
	});

	it('says so when the id never landed', async () => {
		const result = await drop(images, 'img-missing');

		expect(result.status).toBe(404);
		expect(store.deleteImage('img-missing')).toBe(false);
	});

	it('stays while a stored message names it', async () => {
		store.saveImage('img-sent', 'image/png', png);
		const chat = store.createConversation();
		store.appendMessage({
			conversationId: chat.id,
			role: 'user',
			text: 'look at this',
			images: [{ id: 'img-sent', mime: 'image/png' }]
		});

		const result = await drop(images, 'img-sent');

		expect(result.body.dropped).toBe(false);
		expect(store.getImage('img-sent'), 'the chat still reads the image back').toBeDefined();
	});

	it('stays while a waiting message names it', async () => {
		store.saveImage('img-queued', 'image/png', png);
		const chat = store.createConversation();
		store.queueMessage({
			conversationId: chat.id,
			text: 'wait for me',
			images: [{ id: 'img-queued', mime: 'image/png' }]
		});

		expect(store.deleteImage('img-queued')).toBe(false);
		expect(store.getImage('img-queued')).toBeDefined();

		store.deleteQueued(chat.id, store.listQueued(chat.id)[0].id);
		expect(store.deleteImage('img-queued')).toBe(true);
	});
});

describe('a document row', () => {
	it('goes when the user drops the attachment', async () => {
		store.saveDocument('doc-drop', 'notes.md', 'text/plain', 0, 'hello');

		const result = await drop(documents, 'doc-drop');

		expect(result.status).toBe(200);
		expect(result.body.dropped).toBe(true);
		expect(store.getDocument('doc-drop')).toBeUndefined();
	});

	it('says so when the id never landed', async () => {
		const result = await drop(documents, 'doc-missing');

		expect(result.status).toBe(404);
		expect(store.deleteDocument('doc-missing')).toBe(false);
	});

	it('stays while a stored message names it', async () => {
		store.saveDocument('doc-sent', 'manual.pdf', 'application/pdf', 3, 'chapter one');
		const chat = store.createConversation();
		store.appendMessage({
			conversationId: chat.id,
			role: 'user',
			text: 'summarise',
			documents: [{ id: 'doc-sent', name: 'manual.pdf', pages: 3, chars: 11 }]
		});

		const result = await drop(documents, 'doc-sent');

		expect(result.body.dropped).toBe(false);
		expect(store.getDocument('doc-sent')).toBeDefined();
	});
});

/* ------------------------------------------------------------ the composer */

const doc: DocumentRef = { id: 'ui-doc', name: 'notes.md', pages: 0, lines: 2, chars: 5 };
const page: ImageRef = { id: 'ui-page', mime: 'image/png', name: 'notes.md page 1' };

afterEach(() => {
	vi.restoreAllMocks();
	app.pendingImages = [];
	app.pendingDocuments = [];
});

describe('the composer', () => {
	it('frees the rows of an image the user removes', async () => {
		const dropped = vi.spyOn(api, 'deleteImage').mockResolvedValue({ ok: true, dropped: true });
		app.pendingImages = [{ id: 'ui-img', mime: 'image/png' }];

		app.removePendingImage('ui-img');

		expect(app.pendingImages).toEqual([]);
		await vi.waitFor(() => expect(dropped).toHaveBeenCalledWith('ui-img'));
	});

	it('frees the page images of a document the user removes', async () => {
		const droppedImage = vi.spyOn(api, 'deleteImage').mockResolvedValue({ ok: true, dropped: true });
		const droppedDocument = vi.spyOn(api, 'deleteDocument').mockResolvedValue({ ok: true, dropped: true });
		app.pendingDocuments = [{ document: doc, images: [page], sendImages: true }];

		app.removePendingDocument(doc.id);

		expect(app.pendingDocuments).toEqual([]);
		await vi.waitFor(() => {
			expect(droppedDocument).toHaveBeenCalledWith(doc.id);
			expect(droppedImage).toHaveBeenCalledWith(page.id);
		});
	});

	it('frees the page images a text only model will never see', async () => {
		const droppedImage = vi.spyOn(api, 'deleteImage').mockResolvedValue({ ok: true, dropped: true });
		vi.spyOn(api, 'uploadDocument').mockResolvedValue({ document: doc, images: [page], preview: 'hello' });
		// The cap is off, so the pages are uploaded and then dropped again.
		app.settings = { ...app.settings, tools: { ...app.settings.tools, pdfImages: false } };

		await app.attach([new File(['hello'], 'notes.md', { type: 'text/markdown' })]);

		expect(app.pendingDocuments[0]?.images).toEqual([]);
		expect(droppedImage).toHaveBeenCalledWith(page.id);
	});

	it('still clears the composer when the server cannot be reached', async () => {
		vi.spyOn(api, 'deleteImage').mockRejectedValue(new Error('offline'));
		app.pendingImages = [{ id: 'ui-img', mime: 'image/png' }];

		app.removePendingImage('ui-img');

		expect(app.pendingImages).toEqual([]);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
});
