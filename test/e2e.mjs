// End to end smoke test: mock OpenAI compatible provider plus the built app.
// Run with: npm run build && node test/e2e.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MOCK_PORT = 5399;
const APP_PORT = 5499;
const APP = `http://127.0.0.1:${APP_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

const ARTICLE = 'The reader extracts this body text from the mock page.';

/** Filled by the mock so the test can inspect what the app sent upstream. */
const upstream = { toolContent: '', lastBody: null };

/** Minimal valid PDF with one page, built here to avoid a binary fixture. */
function buildPdf(text) {
	const content = `BT /F1 18 Tf 40 120 Td (${text}) Tj ET`;
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>'
	];
	const total = objects.length + 1;
	let body = '%PDF-1.4\n';
	const offsets = [];
	objects.forEach((object, index) => {
		offsets[index + 1] = body.length;
		body += `${index + 1} 0 obj\n${object}\nendobj\n`;
	});
	const xrefOffset = body.length;
	body += `xref\n0 ${total}\n0000000000 65535 f \n`;
	for (let number = 1; number < total; number++) {
		body += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
	}
	body += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return Buffer.from(body, 'latin1');
}

const PDF_TEXT = 'Mock pdf body text';

let passed = 0;
function check(label, condition, extra = '') {
	if (condition) {
		passed++;
		console.log(`ok   ${label}`);
		return;
	}
	console.error(`FAIL ${label}${extra ? ` - ${extra}` : ''}`);
	process.exitCode = 1;
}

/* --------------------------------------------------------------- mock provider */

function sse(res, chunks) {
	res.writeHead(200, { 'content-type': 'text/event-stream' });
	for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
	res.write('data: [DONE]\n\n');
	res.end();
}

/** Writes the frames with a gap so a buffering proxy would be caught. */
function sseTimed(res, chunks, gapMs = 250) {
	res.writeHead(200, { 'content-type': 'text/event-stream' });
	let index = 0;
	const next = () => {
		if (index >= chunks.length) {
			res.write('data: [DONE]\n\n');
			res.end();
			return;
		}
		res.write(`data: ${JSON.stringify(chunks[index++])}\n\n`);
		setTimeout(next, gapMs);
	};
	next();
}

const mock = createServer((req, res) => {
	const url = new URL(req.url ?? '/', MOCK);

	if (url.pathname === '/v1/models') {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(
			JSON.stringify({
				data: [{ id: 'mock-model', architecture: { input_modalities: ['text', 'image'] } }]
			})
		);
		return;
	}

	if (url.pathname === '/search') {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(
			JSON.stringify({
				results: [
					{
						title: 'Mock result',
						url: `${MOCK}/page`,
						content: 'A snippet about the mock page.'
					}
				]
			})
		);
		return;
	}

	if (url.pathname === '/page') {
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		res.end(
			`<html><head><title>Mock page</title></head><body>
				<nav>Home About Contact</nav>
				<article><h1>Mock article</h1><p>${ARTICLE}</p><p>Second paragraph of the article body.</p></article>
				<footer>Copyright</footer>
			</body></html>`
		);
		return;
	}

	if (url.pathname === '/v1/chat/completions') {
		let raw = '';
		req.on('data', (part) => (raw += part));
		req.on('end', () => {
			const body = JSON.parse(raw);
			upstream.lastBody = body;
			const askedSlow = body.messages.some(
				(message) => typeof message.content === 'string' && message.content.includes('slow stream')
			);
			if (askedSlow) {
				// Long enough to close the tab in the middle of it.
				const chunks = [];
				for (let part = 0; part < 10; part++) {
					chunks.push({ choices: [{ index: 0, delta: { content: `tick${part} ` }, finish_reason: null }] });
				}
				chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
				chunks.push({
					choices: [],
					usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
				});
				sseTimed(res, chunks, 220);
				return;
			}
			const hasToolResult = body.messages.some((message) => message.role === 'tool');
			const toolCount = body.messages.filter((message) => message.role === 'tool').length;
			// A prompt that asks for two tools makes the mock call the tool twice, which
			// is what the Always allow check needs.
			const wantsTwo = body.messages.some(
				(message) => typeof message.content === 'string' && message.content.includes('two tools')
			);
			// A turn that carries page images is the PDF path, answer it directly.
			const hasImage = body.messages.some(
				(message) =>
					Array.isArray(message.content) &&
					message.content.some((part) => part.type === 'image_url')
			);
			if (hasImage) {
				sse(res, [
					{ choices: [{ index: 0, delta: { role: 'assistant', content: 'MOCK VISION' }, finish_reason: null }] },
					{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
					{ choices: [], usage: { prompt_tokens: 900, completion_tokens: 3, total_tokens: 903 } }
				]);
				return;
			}
			if (!hasToolResult || (wantsTwo && toolCount === 1)) {
				const callId = toolCount === 0 ? 'call_1' : 'call_2';
				// Ask for a tool call, split across deltas to test accumulation.
				sse(res, [
					{ choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
					{
						choices: [
							{
								index: 0,
								delta: {
									tool_calls: [
										{ index: 0, id: callId, type: 'function', function: { name: 'web_fetch' } }
									]
								},
								finish_reason: null
							}
						]
					},
					{
						choices: [
							{
								index: 0,
								delta: {
									tool_calls: [{ index: 0, function: { arguments: `{"url":"${MOCK}/page"}` } }]
								},
								finish_reason: null
							}
						]
					},
					{ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
					{ choices: [], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } }
				]);
				return;
			}
			const toolText = body.messages.find((message) => message.role === 'tool')?.content ?? '';
			upstream.toolContent = toolText;
			sseTimed(res, [
				{
					choices: [
						{ index: 0, delta: { role: 'assistant', content: 'MOCK ' }, finish_reason: null }
					]
				},
				// Reasoning output must reach the client as reasoning, not text.
				{ choices: [{ index: 0, delta: { reasoning_content: 'thinking...' }, finish_reason: null }] },
				{ choices: [{ index: 0, delta: { content: 'ANSWER' }, finish_reason: null }] },
				{
					choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
					timings: {
						cache_n: 30,
						prompt_n: 12,
						prompt_ms: 40.5,
						prompt_per_token_ms: 3.375,
						prompt_per_second: 296.3,
						predicted_n: 5,
						predicted_ms: 118.2,
						predicted_per_token_ms: 23.64,
						predicted_per_second: 42.3
					}
				},
				{
					choices: [],
					usage: { prompt_tokens: 42, completion_tokens: 5, total_tokens: 47 }
				}
			]);
		});
		return;
	}

	res.writeHead(404).end('not found');
});

/* ------------------------------------------------------------------ helpers */

async function waitFor(url, timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			const res = await fetch(url);
			if (res.ok) return res;
		} catch {
			/* not up yet */
		}
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}`);
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
}

async function json(url, init) {
	const res = await fetch(url, init);
	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}
	return { status: res.status, body };
}

/** Reads an SSE response and returns the parsed events. */
/** Waits until a conversation satisfies a condition, or gives up. */
async function waitForMessages(conversationId, predicate, timeoutMs = 10000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const answer = await json(`${APP}/api/conversations/${conversationId}`);
		const messages = answer.body.messages ?? [];
		if (predicate(messages)) return messages;
		if (Date.now() > deadline) return messages;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

async function readStream(url, payload, signal) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
		signal
	});
	if (!res.ok) throw new Error(`stream ${url} failed: HTTP ${res.status} ${await res.text()}`);
	const events = [];
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let cut = buffer.indexOf('\n\n');
		while (cut !== -1) {
			const frame = buffer.slice(0, cut);
			buffer = buffer.slice(cut + 2);
			for (const line of frame.split('\n')) {
				if (line.startsWith('data:')) {
					const body = line.slice(5).trim();
					if (body) events.push({ ...JSON.parse(body), at: Date.now() });
				}
			}
			cut = buffer.indexOf('\n\n');
		}
	}
	return events;
}

/** Reads events until `stop` says so, then aborts the request. */
async function readUntil(url, payload, stop, events = []) {
	const controller = new AbortController();
	try {
		const res = await fetch(url, {
			method: payload === undefined ? 'GET' : 'POST',
			headers: { 'content-type': 'application/json' },
			body: payload === undefined ? undefined : JSON.stringify(payload),
			signal: controller.signal
		});
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let cut = buffer.indexOf('\n\n');
			while (cut !== -1) {
				const frame = buffer.slice(0, cut);
				buffer = buffer.slice(cut + 2);
				for (const line of frame.split('\n')) {
					if (!line.startsWith('data:')) continue;
					const body = line.slice(5).trim();
					if (body) events.push(JSON.parse(body));
				}
				cut = buffer.indexOf('\n\n');
			}
			if (stop(events)) {
				controller.abort();
				await reader.cancel().catch(() => {});
				return events;
			}
		}
	} catch (err) {
		if (err?.name !== 'AbortError') throw err;
	}
	return events;
}

/* --------------------------------------------------------------------- run */

const dataDir = mkdtempSync(join(tmpdir(), 'sloppychat-e2e-'));
await new Promise((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve));

const appProcess = spawn('node', ['build'], {
	cwd: process.cwd(),
	env: { ...process.env, PORT: String(APP_PORT), HOST: '127.0.0.1', SLOPPYCHAT_DATA_DIR: dataDir, ORIGIN: APP },
	stdio: ['ignore', 'pipe', 'pipe']
});
let appLog = '';
appProcess.stdout.on('data', (part) => (appLog += part));
appProcess.stderr.on('data', (part) => (appLog += part));

try {
	await waitFor(`${APP}/api/settings`);

	const page = await fetch(`${APP}/`);
	check('page shell is served', page.ok && (await page.text()).includes('sloppychat'));

	// Point the tools at the mock and allow the loopback mock host.
	const saved = await json(`${APP}/api/settings`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			search: { url: MOCK, apiKey: '', maxResults: 5 },
			tools: {
				modes: { web_search: 'on', web_fetch: 'on' },
				maxRounds: 6,
				fetchMaxChars: 20000,
				fetchAllowPrivate: true
			}
		})
	});
	check('settings save', saved.status === 200 && saved.body.search.url === MOCK, JSON.stringify(saved.body));

	// SSRF guard must still refuse metadata addresses.
	const metadata = await json(`${APP}/api/fetch`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' })
	});
	check(
		'refuses the metadata address',
		metadata.status === 400 && /refused/i.test(metadata.body.error ?? ''),
		JSON.stringify(metadata.body)
	);

	const createdProvider = await json(`${APP}/api/providers`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'Mock', baseUrl: `${MOCK}/v1`, apiKey: 'test-key' })
	});
	const providerId = createdProvider.body.provider?.id;
	check('provider created without leaking the key', !!providerId && createdProvider.body.provider.hasKey === true);

	const models = await json(`${APP}/api/providers/${providerId}/models`);
	check(
		'model discovery finds a vision capable model',
		models.body.models?.length === 1 && models.body.models[0].vision === true,
		JSON.stringify(models.body)
	);

	const conversation = await json(`${APP}/api/conversations`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providerId, model: 'mock-model' })
	});
	const conversationId = conversation.body.conversation?.id;
	check('conversation created', !!conversationId);

	const message = await json(`${APP}/api/conversations/${conversationId}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'Read the mock page please' })
	});
	check('user message stored', message.status === 201);

	const first = await readStream(`${APP}/api/chat`, { conversationId });
	// The id arrives in the opening snapshot, and in a start event when the
	// client was attached before the turn created its row.
	const start =
		first.find((event) => event.type === 'snapshot' && event.messageId) ??
		first.find((event) => event.type === 'start');
	const calls = first.filter((event) => event.type === 'tool_call');
	const results = first.filter((event) => event.type === 'tool_result');
	const done = first.find((event) => event.type === 'done');
	check('streaming turn starts with a message id', !!start?.messageId);
	check(
		'tool call arguments accumulate across deltas',
		calls.length === 1 && calls[0].call.name === 'web_fetch' && calls[0].call.args?.url === `${MOCK}/page`,
		JSON.stringify(calls)
	);
	check(
		'the server runs the tool with no page attached',
		results.length === 1 && results[0].toolCallId === 'call_1' && results[0].isError === false,
		JSON.stringify(results)
	);
	check('turn finishes with a reason', done?.finishReason === 'stop', JSON.stringify(done));

	// The endpoints stay for other clients and for debugging.
	const search = await json(`${APP}/api/search`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query: 'mock page' })
	});
	check(
		'searxng search returns text for the model',
		search.status === 200 && search.body.results?.length === 1 && search.body.text.includes(`${MOCK}/page`),
		JSON.stringify(search.body)
	);

	const pageFetch = await json(`${APP}/api/fetch`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ url: `${MOCK}/page` })
	});
	check(
		'reader mode strips navigation and keeps the article',
		pageFetch.status === 200 &&
			pageFetch.body.markdown.includes(ARTICLE) &&
			!pageFetch.body.markdown.includes('Home About Contact'),
		JSON.stringify(pageFetch.body).slice(0, 300)
	);

	const text = first
		.filter((event) => event.type === 'text')
		.map((event) => event.text)
		.join('');
	const reasoning = first
		.filter((event) => event.type === 'reasoning')
		.map((event) => event.text)
		.join('');
	check('assistant answer streams after the tool result', text === 'MOCK ANSWER', JSON.stringify(text));

	// The provider waits between frames, so a buffering proxy would collapse this.
	const textEvents = first.filter((event) => event.type === 'text');
	const span = textEvents.length > 1 ? textEvents.at(-1).at - textEvents.at(0).at : 0;
	check(
		'tokens reach the client as they are produced',
		textEvents.length >= 2 && span >= 200,
		`${textEvents.length} text events spread over ${span} ms`
	);
	check(
		'the first token arrives before the turn ends',
		textEvents.length > 0 && textEvents[0].at < first.at(-1).at,
		JSON.stringify({ first: textEvents[0]?.at, done: first.at(-1)?.at })
	);
	check(
		'the tool result reaches the provider',
		upstream.toolContent.includes('Mock article') && upstream.toolContent.includes(`${MOCK}/page`),
		upstream.toolContent.slice(0, 200)
	);
	check('reasoning stays out of the answer text', reasoning === 'thinking...', JSON.stringify(reasoning));
	check(
		'the turn reports usage',
		done?.usage?.total === 47,
		JSON.stringify(first.filter((event) => event.type === 'done'))
	);

	const history = await json(`${APP}/api/conversations/${conversationId}`);
	const roles = (history.body.messages ?? []).map((item) => item.role).join(',');
	check(
		'history keeps the tool round trip in order',
		roles === 'user,assistant,tool,assistant',
		roles
	);
	check(
		'stored answer and usage survive the round trip',
		history.body.messages.at(-1).text === 'MOCK ANSWER' && history.body.messages.at(-1).usage?.total === 47
	);
	check(
		'conversation title follows the first message',
		history.body.conversation.title.startsWith('Read the mock page'),
		history.body.conversation.title
	);

	// The mode ask first holds the turn until a window answers.
	const askSaved = await json(`${APP}/api/settings`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			tools: { ...saved.body.tools, modes: { web_search: 'on', web_fetch: 'ask' } }
		})
	});
	check(
		'the ask mode is stored',
		askSaved.body.tools?.modes?.web_fetch === 'ask',
		JSON.stringify(askSaved.body.tools?.modes)
	);
	const askChat = await json(`${APP}/api/conversations`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providerId, model: 'mock-model' })
	});
	const askId = askChat.body.conversation?.id;
	await json(`${APP}/api/conversations/${askId}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'Read the mock page please' })
	});
	const asked = [];
	await readUntil(
		`${APP}/api/chat`,
		{ conversationId: askId },
		(events) => events.some((event) => event.type === 'tool_ask'),
		asked
	);
	check(
		'the tool waits for the user',
		asked.some((event) => event.type === 'tool_ask' && event.call.id === 'call_1'),
		JSON.stringify(asked.map((event) => event.type))
	);

	// A reload, or a second window, sees the same request in its snapshot.
	const seen = [];
	await readUntil(
		`${APP}/api/chat/stream?conversationId=${askId}`,
		undefined,
		(events) => events.length >= 1,
		seen
	);
	check(
		'a reload shows the waiting tool',
		seen[0]?.approval?.id === 'call_1',
		JSON.stringify(seen[0]?.approval)
	);

	const rest = [];
	const askWatch = readUntil(
		`${APP}/api/chat/stream?conversationId=${askId}`,
		undefined,
		(events) => events.some((event) => event.type === 'done'),
		rest
	);
	await new Promise((resolve) => setTimeout(resolve, 300));
	const approved = await json(`${APP}/api/chat/approve`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ conversationId: askId, toolCallId: 'call_1', decision: 'allow' })
	});
	check('the approval is accepted', approved.body.answered === true, JSON.stringify(approved.body));
	await askWatch;
	check(
		'the turn finishes after the approval',
		rest.some((event) => event.type === 'tool_result' && !event.isError) &&
			rest.some((event) => event.type === 'done'),
		JSON.stringify(rest.map((event) => event.type))
	);

	// A denial becomes an error result, and the model answers from there.
	const denyChat = await json(`${APP}/api/conversations`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providerId, model: 'mock-model' })
	});
	const denyId = denyChat.body.conversation?.id;
	await json(`${APP}/api/conversations/${denyId}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'Read the mock page please' })
	});
	await readUntil(
		`${APP}/api/chat`,
		{ conversationId: denyId },
		(events) => events.some((event) => event.type === 'tool_ask')
	);
	const deniedRest = [];
	const deniedWatch = readUntil(
		`${APP}/api/chat/stream?conversationId=${denyId}`,
		undefined,
		(events) => events.some((event) => event.type === 'done'),
		deniedRest
	);
	await new Promise((resolve) => setTimeout(resolve, 300));
	await json(`${APP}/api/chat/approve`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ conversationId: denyId, toolCallId: 'call_1', decision: 'deny' })
	});
	await deniedWatch;
	const deniedHistory = await json(`${APP}/api/conversations/${denyId}`);
	const deniedRow = (deniedHistory.body.messages ?? []).find((item) => item.role === 'tool');
	check(
		'a denied tool is recorded as an error',
		deniedRow?.isError === true && /denied/i.test(deniedRow.text),
		JSON.stringify(deniedRow)
	);
	check(
		'the model answers after a denial',
		deniedHistory.body.messages.at(-1)?.text === 'MOCK ANSWER',
		JSON.stringify(deniedHistory.body.messages.at(-1)?.text)
	);

	// Always allow writes the mode, so a second call in the same turn runs free.
	const alwaysChat = await json(`${APP}/api/conversations`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providerId, model: 'mock-model' })
	});
	const alwaysId = alwaysChat.body.conversation?.id;
	await json(`${APP}/api/conversations/${alwaysId}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'Read the mock page with two tools please' })
	});
	const firstAsk = [];
	await readUntil(
		`${APP}/api/chat`,
		{ conversationId: alwaysId },
		(events) => events.some((event) => event.type === 'tool_ask'),
		firstAsk
	);
	check(
		'the first call of the turn waits',
		firstAsk.some((event) => event.type === 'tool_ask' && event.call.id === 'call_1'),
		JSON.stringify(firstAsk.map((event) => event.type))
	);
	const alwaysRest = [];
	const alwaysWatch = readUntil(
		`${APP}/api/chat/stream?conversationId=${alwaysId}`,
		undefined,
		(events) => events.some((event) => event.type === 'done'),
		alwaysRest
	);
	await new Promise((resolve) => setTimeout(resolve, 300));
	const always = await json(`${APP}/api/chat/approve`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			conversationId: alwaysId,
			toolCallId: 'call_1',
			decision: 'allow',
			always: true
		})
	});
	check('always allow is accepted', always.body.answered === true, JSON.stringify(always.body));
	await alwaysWatch;
	const secondAsks = alwaysRest.filter((event) => event.type === 'tool_ask');
	const ranTools = alwaysRest.filter((event) => event.type === 'tool_result');
	check(
		'always allow stops the second question in the same turn',
		secondAsks.length === 0 && ranTools.length >= 1,
		`${secondAsks.length} asks, ${ranTools.length} results`
	);
	const storedModes = (await json(`${APP}/api/settings`)).body.tools?.modes ?? {};
	check(
		'always allow saves the mode',
		storedModes.web_fetch === 'on',
		JSON.stringify(storedModes)
	);

	// Put both modes back for the checks below.
	await json(`${APP}/api/settings`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			tools: { ...askSaved.body.tools, modes: { web_search: 'on', web_fetch: 'on' } }
		})
	});

	// A tool that is off sends no schema at all, so a disabled tool costs no tokens.
	const offSaved = await json(`${APP}/api/settings`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			tools: { ...saved.body.tools, modes: { web_search: 'off', web_fetch: 'on' } }
		})
	});
	check(
		'a tool that is off survives the round trip',
		offSaved.body.tools?.modes?.web_search === 'off',
		JSON.stringify(offSaved.body.tools?.modes)
	);
	const schemaChat = await json(`${APP}/api/conversations`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providerId, model: 'mock-model' })
	});
	await json(`${APP}/api/conversations/${schemaChat.body.conversation.id}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'slow stream, tool schema check' })
	});
	await readStream(`${APP}/api/chat`, { conversationId: schemaChat.body.conversation.id });
	const offered = (upstream.lastBody.tools ?? []).map((tool) => tool.function.name);
	check(
		'an off tool sends no schema to the provider',
		!offered.includes('web_search') && offered.includes('web_fetch'),
		JSON.stringify(offered)
	);
	// Put the search tool back for the checks below.
	await json(`${APP}/api/settings`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			tools: { ...offSaved.body.tools, modes: { web_search: 'on', web_fetch: 'on' } }
		})
	});

	// A turn must outlive the connection that started it.
	const slowChat = await json(`${APP}/api/conversations`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providerId, model: 'mock-model' })
	});
	const slowId = slowChat.body.conversation?.id;
	await json(`${APP}/api/conversations/${slowId}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'slow stream please' })
	});

	const started = [];
	await readUntil(`${APP}/api/chat`, { conversationId: slowId }, (seen) => seen.length >= 3, started);
	check(
		'the turn starts and streams before the client goes away',
		started.some((event) => event.type === 'text'),
		JSON.stringify(started.map((event) => event.type))
	);

	// Watch the same turn from a second client while it is still running.
	const late = [];
	const watching = readUntil(
		`${APP}/api/chat/stream?conversationId=${slowId}`,
		undefined,
		(seen) => seen.some((event) => event.type === 'done'),
		late
	);
	await new Promise((resolve) => setTimeout(resolve, 400));
	const whileRunning = await json(`${APP}/api/conversations/${slowId}`);
	const partial = whileRunning.body.messages.at(-1);
	check(
		'a reload attaches to the turn already in progress',
		late[0]?.type === 'snapshot' && late[0].running === true,
		JSON.stringify(late[0])
	);
	check(
		'the partial answer is readable while it is still generating',
		partial?.role === 'assistant' && partial.text.length > 0 && partial.text.length < 60,
		JSON.stringify(partial?.text)
	);

	await watching;
	check(
		'the late client sees the rest of the turn and its end',
		late.some((event) => event.type === 'text') &&
			late.some((event) => event.type === 'done' && event.finishReason === 'stop'),
		JSON.stringify(late.map((event) => event.type))
	);

	const finished = await json(`${APP}/api/conversations/${slowId}`);
	const answer = finished.body.messages.at(-1);
	check(
		'the model finished the answer after the first client hung up',
		answer?.role === 'assistant' &&
			answer.text === 'tick0 tick1 tick2 tick3 tick4 tick5 tick6 tick7 tick8 tick9 ',
		JSON.stringify(answer?.text)
	);
	check(
		'the finished answer is not marked interrupted',
		answer?.usage?.interrupted === undefined,
		JSON.stringify(answer?.usage)
	);

	// Stopping is the user's decision, and it is the only thing that ends a turn.
	const stopChat = await json(`${APP}/api/conversations`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providerId, model: 'mock-model' })
	});
	const stopId = stopChat.body.conversation?.id;
	await json(`${APP}/api/conversations/${stopId}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'slow stream and stop' })
	});
	await readUntil(`${APP}/api/chat`, { conversationId: stopId }, (seen) => seen.length >= 3);
	const stopped = await json(`${APP}/api/chat/stop`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ conversationId: stopId })
	});
	check('stop ends the running turn', stopped.body.stopped === true, JSON.stringify(stopped.body));
	// Give the abort a moment to be recorded, then check it was marked.
	await new Promise((resolve) => setTimeout(resolve, 500));
	const stoppedTurn = await json(`${APP}/api/conversations/${stopId}`);
	const stoppedAnswer = stoppedTurn.body.messages.at(-1);
	check(
		'a stopped answer is marked as interrupted',
		stoppedAnswer?.usage?.interrupted === true,
		JSON.stringify(stoppedAnswer?.usage)
	);

	// The two defects that step 1 wrote down, now repaired by steps 3 and 4.

	// The tool runs on the server, so a turn that asks for a tool finishes with
	// no page attached.
	const toolChat = await json(`${APP}/api/conversations`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providerId, model: 'mock-model' })
	});
	const toolId = toolChat.body.conversation?.id;
	await json(`${APP}/api/conversations/${toolId}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'Read the mock page again please' })
	});
	await readStream(`${APP}/api/chat`, { conversationId: toolId });
	await new Promise((resolve) => setTimeout(resolve, 800));
	const stuckTurn = await json(`${APP}/api/conversations/${toolId}`);
	const stuckRows = stuckTurn.body.messages ?? [];
	const stuckToolRows = stuckRows.filter((message) => message.role === 'tool').length;
	const stuckAnswers = stuckRows.filter(
		(message) => message.role === 'assistant' && message.text.length > 0
	).length;
	check(
		'a turn that asks for a tool finishes with no page attached',
		stuckToolRows >= 1 && stuckAnswers >= 1,
		`${stuckToolRows} tool rows, ${stuckAnswers} answers`
	);

	// The queue lives on the server, so a message typed during a turn waits there,
	// a reload keeps it, and it runs when the turn ends.
	const busyChat = await json(`${APP}/api/conversations`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providerId, model: 'mock-model' })
	});
	const busyId = busyChat.body.conversation?.id;
	await json(`${APP}/api/conversations/${busyId}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'slow stream please' })
	});
	const firstTurn = readStream(`${APP}/api/chat`, { conversationId: busyId });
	await new Promise((resolve) => setTimeout(resolve, 300));
	const queuedNow = await json(`${APP}/api/conversations/${busyId}/queue`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'and what comes next?' })
	});
	check(
		'a follow up joins the server queue',
		queuedNow.status === 201 && !!queuedNow.body.queued?.id,
		JSON.stringify(queuedNow.body)
	);
	const whileBusy = await json(`${APP}/api/conversations/${busyId}`);
	check(
		'the queue is visible to any window',
		(whileBusy.body.queued ?? []).length === 1,
		JSON.stringify(whileBusy.body.queued)
	);
	check(
		'a waiting message stays out of the history',
		!(whileBusy.body.messages ?? []).some((message) => message.text === 'and what comes next?'),
		JSON.stringify((whileBusy.body.messages ?? []).map((message) => message.text))
	);
	await firstTurn;
	const drained = await waitForMessages(
		busyId,
		(messages) => messages.filter((message) => message.role === 'assistant' && message.text).length === 2
	);
	check(
		'the queued message runs when the turn ends',
		drained.filter((message) => message.role === 'assistant' && message.text).length === 2,
		JSON.stringify(drained.map((message) => message.role))
	);
	const afterDrain = await json(`${APP}/api/conversations/${busyId}`);
	check(
		'the queue is empty after the drain',
		(afterDrain.body.queued ?? []).length === 0,
		JSON.stringify(afterDrain.body.queued)
	);

	// A chip can be removed before the turn it waits for ends.
	const dropChat = await json(`${APP}/api/conversations`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providerId, model: 'mock-model' })
	});
	const dropId = dropChat.body.conversation?.id;
	await json(`${APP}/api/conversations/${dropId}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'slow stream please' })
	});
	const dropTurn = readStream(`${APP}/api/chat`, { conversationId: dropId });
	await new Promise((resolve) => setTimeout(resolve, 300));
	const dropped = await json(`${APP}/api/conversations/${dropId}/queue`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'never sent' })
	});
	const removedQueued = await json(
		`${APP}/api/conversations/${dropId}/queue/${dropped.body.queued?.id}`,
		{ method: 'DELETE' }
	);
	check('a waiting message can be removed', removedQueued.status === 200, JSON.stringify(removedQueued.body));
	await dropTurn;
	const afterDrop = await waitForMessages(dropId, (messages) => messages.some((message) => message.role === 'assistant' && message.text));
	check(
		'a removed message never runs',
		!afterDrop.some((message) => message.text === 'never sent') && (await json(`${APP}/api/conversations/${dropId}`)).body.queued.length === 0,
		JSON.stringify(afterDrop.map((message) => message.text))
	);

	// Skills: a markdown file becomes instructions the model loads on demand.
	const skillFile =
		'---\nname: release-notes\ndescription: Use when the user asks for release notes.\n---\n\n' +
		'# Release notes\n\nCollect the merged pull requests.\n';
	const skillForm = new FormData();
	skillForm.append('file', new Blob([skillFile], { type: 'text/markdown' }), 'SKILL.md');
	const uploaded = await json(`${APP}/api/skills`, {
		method: 'POST',
		body: skillForm,
		headers: { origin: APP }
	});
	check(
		'a markdown file uploads as a skill',
		uploaded.status === 201 &&
			uploaded.body.skills?.[0]?.name === 'release-notes' &&
			uploaded.body.skills[0].description.startsWith('Use when'),
		JSON.stringify(uploaded.body).slice(0, 200)
	);
	const skillId = uploaded.body.skills?.[0]?.id;

	const listed = await json(`${APP}/api/skills`);
	check(
		'skills are listed',
		listed.body.skills?.some((skill) => skill.name === 'release-notes'),
		JSON.stringify(listed.body).slice(0, 200)
	);

	const fetched = await json(`${APP}/api/skills?name=release-notes`);
	check(
		'a skill reads back by name, which is what the tool does',
		fetched.status === 200 && fetched.body.skill.body.includes('Collect the merged pull requests'),
		JSON.stringify(fetched.body).slice(0, 200)
	);

	const edited = await json(`${APP}/api/skills/${skillId}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ body: '# Release notes\n\nEdited instructions.' })
	});
	check(
		'editing a skill stores the new text',
		edited.body.skill?.body.includes('Edited instructions'),
		JSON.stringify(edited.body).slice(0, 160)
	);

	// The prompt lists it, the tool loads it, and the body stays out of the prompt.
	const skillChat = await json(`${APP}/api/conversations`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providerId, model: 'mock-model' })
	});
	const skillConversation = skillChat.body.conversation?.id;
	await json(`${APP}/api/conversations/${skillConversation}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'write the release notes' })
	});
	await readUntil(
		`${APP}/api/chat`,
		{ conversationId: skillConversation },
		(seen) => seen.some((event) => event.type === 'tool_call' || event.type === 'done')
	);
	const withSkill = upstream.lastBody;
	const systemText = withSkill.messages.find((message) => message.role === 'system')?.content ?? '';
	check(
		'the system prompt lists the skill by name and description',
		systemText.includes('## Skills') && systemText.includes('release-notes: Use when'),
		systemText.slice(-200)
	);
	check(
		'the skill instructions stay out of the prompt',
		!systemText.includes('Edited instructions'),
		'body leaked into the system prompt'
	);
	check(
		'read_skill is offered to the model',
		Array.isArray(withSkill.tools) && withSkill.tools.some((tool) => tool.function.name === 'read_skill'),
		JSON.stringify(withSkill.tools?.map((tool) => tool.function.name))
	);

	await json(`${APP}/api/skills/${skillId}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ enabled: false })
	});
	const offChat = await json(`${APP}/api/conversations`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providerId, model: 'mock-model' })
	});
	await json(`${APP}/api/conversations/${offChat.body.conversation.id}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text: 'anything' })
	});
	await readUntil(
		`${APP}/api/chat`,
		{ conversationId: offChat.body.conversation.id },
		(seen) => seen.some((event) => event.type === 'tool_call' || event.type === 'done')
	);
	const withoutSkill = upstream.lastBody;
	check(
		'a disabled skill is not advertised',
		!JSON.stringify(withoutSkill.messages[0].content).includes('release-notes') &&
			!withoutSkill.tools?.some((tool) => tool.function.name === 'read_skill'),
		JSON.stringify(withoutSkill.tools?.map((tool) => tool.function.name))
	);

	await json(`${APP}/api/skills/${skillId}`, { method: 'DELETE' });
	const afterDelete = await json(`${APP}/api/skills`);
	check(
		'a skill can be deleted',
		!afterDelete.body.skills?.some((skill) => skill.id === skillId),
		JSON.stringify(afterDelete.body).slice(0, 160)
	);

	// Image upload path.
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+7ZTVAAAAAElFTkSuQmCC',
		'base64'
	);
	const form = new FormData();
	form.append('file', new Blob([png], { type: 'image/png' }), 'dot.png');
	// A browser always sends Origin on a multipart POST, and SvelteKit checks it.
	const upload = await json(`${APP}/api/images`, { method: 'POST', body: form, headers: { origin: APP } });
	check(
		'image upload sniffs the real type and size',
		upload.status === 201 && upload.body.image?.mime === 'image/png' && upload.body.image?.width === 1,
		JSON.stringify(upload.body)
	);
	const served = await fetch(`${APP}/api/images/${upload.body.image?.id}`);
	check('stored image is served back', served.ok && served.headers.get('content-type') === 'image/png');

	const rejected = new FormData();
	rejected.append('file', new Blob([Buffer.from('not an image')], { type: 'image/png' }), 'bad.png');
	const badUpload = await json(`${APP}/api/images`, { method: 'POST', body: rejected, headers: { origin: APP } });
	check('non image upload is rejected', badUpload.status === 400, JSON.stringify(badUpload.body));

	// Throughput statistics must be attached to the finished turn.
	const stats = first.find((event) => event.type === 'done')?.usage ?? {};
	check(
		'usage carries prefill and generation timing',
		typeof stats.ttftMs === 'number' && typeof stats.decodeMs === 'number' && stats.ttftMs >= 0,
		JSON.stringify(stats)
	);
	const storedStats = history.body.messages.at(-1).usage ?? {};
	check(
		'stored message keeps the timing for the stats line',
		typeof storedStats.ttftMs === 'number' && typeof storedStats.decodeMs === 'number',
		JSON.stringify(storedStats)
	);
	// The llama.cpp style timing block must win over the wall clock numbers.
	check(
		'reported timings override the measured ones',
		storedStats.reported === true &&
			storedStats.ppRate === 296.3 &&
			storedStats.tgRate === 42.3 &&
			storedStats.ttftMs === 40.5 &&
			storedStats.decodeMs === 118.2 &&
			storedStats.cachedPrompt === 30,
		JSON.stringify(storedStats)
	);

	// PDF attachments: text extraction plus page images for the vision path.
	const pdfForm = new FormData();
	pdfForm.append('file', new Blob([buildPdf(PDF_TEXT)], { type: 'application/pdf' }), 'report.pdf');
	const pdfUpload = await json(`${APP}/api/documents`, {
		method: 'POST',
		body: pdfForm,
		headers: { origin: APP }
	});
	check(
		'pdf upload extracts text and renders the page',
		pdfUpload.status === 201 &&
			pdfUpload.body.document?.pages === 1 &&
			pdfUpload.body.document.chars > 0 &&
			pdfUpload.body.images?.length === 1 &&
			pdfUpload.body.preview.includes(PDF_TEXT),
			JSON.stringify(pdfUpload.body).slice(0, 300)
	);

	const notPdf = new FormData();
	notPdf.append('file', new Blob([Buffer.from('%PDF-1.4 broken')], { type: 'application/pdf' }), 'broken.pdf');
	const badPdf = await json(`${APP}/api/documents`, { method: 'POST', body: notPdf, headers: { origin: APP } });
	check('broken pdf is rejected cleanly', badPdf.status >= 400, JSON.stringify(badPdf.body));

	const pdfMessage = await json(`${APP}/api/conversations/${conversationId}/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			text: 'What does the report say?',
			documents: [pdfUpload.body.document],
			images: pdfUpload.body.images
		})
	});
	check(
		'document reference is stored on the message',
		pdfMessage.status === 201 && pdfMessage.body.message.documents?.[0]?.pages === 1,
		JSON.stringify(pdfMessage.body).slice(0, 200)
	);

	const pdfTurn = await readStream(`${APP}/api/chat`, { conversationId });
	const pdfText = pdfTurn
		.filter((event) => event.type === 'text')
		.map((event) => event.text)
		.join('');
	check('vision turn answers', pdfText === 'MOCK VISION', JSON.stringify(pdfText));

	const sentParts = upstream.lastBody.messages.flatMap((message) =>
		Array.isArray(message.content) ? message.content : []
	);
	check(
		'pdf text is inlined for the model',
		sentParts.some(
			(part) => part.type === 'text' && part.text.includes('Extracted text of the attached document') && part.text.includes(PDF_TEXT)
		),
		JSON.stringify(sentParts.filter((part) => part.type === 'text')).slice(0, 300)
	);
	check(
		'page images are sent as data urls',
		sentParts.some(
			(part) => part.type === 'image_url' && part.image_url.url.startsWith('data:image/jpeg;base64,')
		),
		JSON.stringify(sentParts.map((part) => part.type))
	);
} catch (err) {
	console.error('FAIL harness error:', err);
	process.exitCode = 1;
} finally {
	appProcess.kill('SIGKILL');
	mock.close();
	rmSync(dataDir, { recursive: true, force: true });
	if (process.exitCode) console.error(appLog.slice(-2000));
	console.log(process.exitCode ? 'e2e failed' : `e2e passed (${passed} checks)`);
}
