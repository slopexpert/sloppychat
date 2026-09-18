import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCall } from '$lib/shared/types';

/**
 * The turn loop belongs to the server: the model asks for a tool, the server
 * runs the tool, and the answer arrives with no page attached. A tool in the
 * mode ask first holds the turn until the user answers.
 *
 * The provider is mocked, so the test drives the loop itself. The store reads
 * the database path when the module loads, so the data directory must be set
 * before the first server import.
 */

process.env.SLOPPYCHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'sloppychat-turn-'));

interface Reply {
	content: string;
	toolCalls?: { id: string; name: string; argsText: string }[];
}

/** The answers of the provider, in order, and the number of calls. */
let replies: Reply[] = [];
let calls = 0;
/** Lets a test hold a stream open, so a message can arrive while a turn runs. */
let pauseNext = false;
let releaseStream: (() => void) | undefined;

vi.mock('$lib/server/openai', () => ({
	streamChat: vi.fn(async () => {
		if (pauseNext) {
			pauseNext = false;
			await new Promise<void>((resolve) => {
				releaseStream = resolve;
			});
		}
		const reply = replies[calls] ?? { content: 'ANSWER' };
		calls++;
		return {
			content: reply.content,
			reasoning: '',
			toolCalls: reply.toolCalls ?? [],
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
			finishReason: reply.toolCalls?.length ? 'tool_calls' : 'stop'
		};
	}),
	toUpstreamMessages: vi.fn(() => [{ role: 'user', content: 'hello' }])
}));

const store = await import('$lib/server/store');
const hub = await import('$lib/server/hub');
const approvals = await import('$lib/server/approvals');

/** Waits until the turn of a conversation is idle. */
async function settle(conversationId: string): Promise<void> {
	for (let step = 0; step < 300 && hub.isTurnRunning(conversationId); step++) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	// One more turn of the event loop, so the last rows are visible.
	await new Promise((resolve) => setTimeout(resolve, 60));
}

function startConversation(): string {
	const provider = store.createProvider({ name: 'Mock', baseUrl: 'http://127.0.0.1:1/v1' });
	const conversation = store.createConversation({ providerId: provider.id, model: 'mock-model' });
	store.appendMessage({ conversationId: conversation.id, role: 'user', text: 'read the skill' });
	return conversation.id;
}

/** Sets one tool mode, which the settings keep for the whole test file. */
function setMode(id: string, mode: 'off' | 'ask' | 'on'): void {
	const settings = store.getSettings();
	store.saveSettings({ tools: { ...settings.tools, modes: { ...settings.tools.modes, [id]: mode } } });
}

const skillCall = { id: 'call_1', name: 'read_skill', argsText: '{"name":"release-notes"}' };
/** The same call as a stored row keeps it, with the arguments parsed. */
const storedCall: ToolCall = { id: 'call_1', name: 'read_skill', args: { name: 'release-notes' } };

beforeEach(() => {
	replies = [];
	calls = 0;
	pauseNext = false;
	releaseStream = undefined;
	const settings = store.getSettings();
	store.saveSettings({ tools: { ...settings.tools, modes: {}, maxRounds: 6 } });
	if (!store.getSkillByName('release-notes')) {
		store.saveSkill({
			name: 'release-notes',
			description: 'Use when the user asks for release notes.',
			body: '# Release notes\n\nCollect the merged pull requests.'
		});
	}
});

describe('a turn that asks for a tool', () => {
	it('runs the tool on the server and answers in the same turn', async () => {
		replies = [{ content: '', toolCalls: [skillCall] }, { content: 'ANSWER' }];
		const conversationId = startConversation();

		hub.startTurn({ conversationId });
		await settle(conversationId);

		const messages = store.listMessages(conversationId);
		expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
		expect(messages[2].text).toContain('Collect the merged pull requests');
		expect(messages[2].isError).toBe(false);
		expect(messages.at(-1)?.text).toBe('ANSWER');
		expect(calls, 'the provider is asked once per round').toBe(2);
	});

	it('holds the turn in the mode ask first, and goes on after an allow', async () => {
		setMode('read_skill', 'ask');
		replies = [{ content: '', toolCalls: [skillCall] }, { content: 'ANSWER' }];
		const conversationId = startConversation();

		hub.startTurn({ conversationId });
		await new Promise((resolve) => setTimeout(resolve, 100));

		// The tool has not run, and the request is there for any window to answer.
		expect(hub.isTurnRunning(conversationId)).toBe(true);
		expect(store.listMessages(conversationId).map((message) => message.role)).toEqual([
			'user',
			'assistant'
		]);
		expect(approvals.pendingApproval(conversationId)?.id).toBe('call_1');

		expect(approvals.resolveApproval(conversationId, 'call_1', 'allow')).toBe(true);
		await settle(conversationId);

		const messages = store.listMessages(conversationId);
		expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
		expect(messages[2].isError).toBe(false);
	});

	it('applies a mode change during the wait, so Always allow holds', async () => {
		setMode('read_skill', 'ask');
		replies = [
			{ content: '', toolCalls: [skillCall] },
			{ content: '', toolCalls: [{ ...skillCall, id: 'call_2' }] },
			{ content: 'ANSWER' }
		];
		const conversationId = startConversation();

		hub.startTurn({ conversationId });
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(approvals.pendingApproval(conversationId)?.id).toBe('call_1');

		// What the approve route does when the user picks Always allow: the mode
		// changes while the turn waits, and the turn must see it at once.
		const settings = store.getSettings();
		store.saveSettings({
			tools: { ...settings.tools, modes: { ...settings.tools.modes, read_skill: 'on' } }
		});
		approvals.resolveApproval(conversationId, 'call_1', 'allow');
		await settle(conversationId);

		// The second request never asks, because the mode is on now.
		expect(approvals.pendingApproval(conversationId)).toBeUndefined();
		const messages = store.listMessages(conversationId);
		expect(messages.map((message) => message.role)).toEqual([
			'user',
			'assistant',
			'tool',
			'assistant',
			'tool',
			'assistant'
		]);
		expect(messages.at(-1)?.text).toBe('ANSWER');
	});

	it('writes an error row when the user denies, and the model still answers', async () => {
		setMode('read_skill', 'ask');
		replies = [{ content: '', toolCalls: [skillCall] }, { content: 'ANSWER' }];
		const conversationId = startConversation();

		hub.startTurn({ conversationId });
		await new Promise((resolve) => setTimeout(resolve, 100));
		approvals.resolveApproval(conversationId, 'call_1', 'deny');
		await settle(conversationId);

		const messages = store.listMessages(conversationId);
		expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
		expect(messages[2].isError).toBe(true);
		expect(messages[2].text).toContain('denied');
		expect(messages.at(-1)?.text).toBe('ANSWER');
	});

	it('answers an unknown request only when the tool waits', async () => {
		// A tool the catalog does not hold stays unknown, and it never waits.
		expect(approvals.resolveApproval('nowhere', 'call_1', 'allow')).toBe(false);
	});

	it('refuses a tool that is off, and the model still answers', async () => {
		setMode('read_skill', 'off');
		replies = [{ content: '', toolCalls: [skillCall] }, { content: 'ANSWER' }];
		const conversationId = startConversation();

		hub.startTurn({ conversationId });
		await settle(conversationId);

		const messages = store.listMessages(conversationId);
		expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
		expect(messages[2].isError).toBe(true);
		expect(messages[2].text).toContain('turned this tool off');
	});

	it('stops at the round limit instead of asking for tools forever', async () => {
		const settings = store.getSettings();
		store.saveSettings({ tools: { ...settings.tools, maxRounds: 1 } });
		replies = [
			{ content: '', toolCalls: [skillCall] },
			{ content: '', toolCalls: [{ ...skillCall, id: 'call_2' }] }
		];
		const conversationId = startConversation();

		hub.startTurn({ conversationId });
		await settle(conversationId);

		// One round ran, the second request came too late, and nothing waits.
		const messages = store.listMessages(conversationId);
		expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
		expect(messages.at(-1)?.toolCalls?.[0]?.id).toBe('call_2');
		expect(calls).toBe(2);
	});

	it('closes the tool calls that a restart left unanswered', async () => {
		replies = [{ content: 'ANSWER' }];
		const provider = store.createProvider({ name: 'Mock', baseUrl: 'http://127.0.0.1:1/v1' });
		const conversation = store.createConversation({ providerId: provider.id, model: 'mock-model' });
		store.appendMessage({ conversationId: conversation.id, role: 'user', text: 'read the skill' });
		store.appendMessage({
			conversationId: conversation.id,
			role: 'assistant',
			toolCalls: [storedCall]
		});

		hub.startTurn({ conversationId: conversation.id });
		await settle(conversation.id);

		const messages = store.listMessages(conversation.id);
		expect(messages.map((message) => message.role)).toEqual([
			'user',
			'assistant',
			'tool',
			'assistant'
		]);
		expect(messages[2].isError).toBe(true);
		expect(messages[2].text).toContain('stopped before this tool ran');
	});
});

/** Waits for a condition that another part of the turn sets. */
async function waitFor(ready: () => boolean): Promise<void> {
	for (let step = 0; step < 200 && !ready(); step++) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(ready(), 'the condition holds').toBe(true);
}

describe('the follow-up queue', () => {
	it('holds a message until the turn in flight ends, then runs it', async () => {
		replies = [{ content: 'FIRST' }, { content: 'SECOND' }];
		const conversationId = startConversation();
		pauseNext = true;

		hub.startTurn({ conversationId });
		await waitFor(() => !!releaseStream);
		const queued = store.queueMessage({ conversationId, text: 'and then?' });

		// The waiting message is not part of the history yet.
		expect(store.listMessages(conversationId).map((message) => message.role)).toEqual([
			'user',
			'assistant'
		]);
		expect(store.listQueued(conversationId).map((item) => item.id)).toEqual([queued.id]);

		releaseStream?.();
		await settle(conversationId);

		const messages = store.listMessages(conversationId);
		expect(messages.map((message) => message.role)).toEqual([
			'user',
			'assistant',
			'user',
			'assistant'
		]);
		expect(messages.at(-1)?.text).toBe('SECOND');
		expect(store.listQueued(conversationId)).toEqual([]);
	});

	it('runs the queue in order, one turn per message', async () => {
		replies = [{ content: 'FIRST' }, { content: 'SECOND' }, { content: 'THIRD' }];
		const conversationId = startConversation();
		pauseNext = true;

		hub.startTurn({ conversationId });
		await waitFor(() => !!releaseStream);
		store.queueMessage({ conversationId, text: 'second question' });
		store.queueMessage({ conversationId, text: 'third question' });

		releaseStream?.();
		await settle(conversationId);

		const texts = store.listMessages(conversationId).map((message) => message.text);
		expect(texts).toEqual([
			'read the skill',
			'FIRST',
			'second question',
			'SECOND',
			'third question',
			'THIRD'
		]);
		expect(store.listQueued(conversationId)).toEqual([]);
	});

	it('drops the queue when the user stops the turn', async () => {
		replies = [{ content: 'FIRST' }];
		const conversationId = startConversation();
		pauseNext = true;

		hub.startTurn({ conversationId });
		await waitFor(() => !!releaseStream);
		store.queueMessage({ conversationId, text: 'never sent' });

		expect(hub.stopTurn(conversationId)).toBe(true);
		// Stop is the user's choice, so the waiting messages go with the turn.
		expect(store.listQueued(conversationId)).toEqual([]);

		releaseStream?.();
		await settle(conversationId);
		expect(store.listMessages(conversationId).map((message) => message.role)).toEqual([
			'user',
			'assistant'
		]);
	});
});
