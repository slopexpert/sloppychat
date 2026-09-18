/**
 * Context window sizes.
 *
 * The provider's own `context_length` always wins. Plenty of OpenAI compatible
 * servers do not report one, so a small table of well known model families fills
 * the gap. Values from the table are marked as assumed everywhere they are shown,
 * because a wrong guess must not look like a measurement.
 */

interface KnownWindow {
	pattern: RegExp;
	window: number;
}

const KNOWN: KnownWindow[] = [
	{ pattern: /^gpt-4\.1/i, window: 1_047_576 },
	{ pattern: /^gpt-4o|^chatgpt-4o/i, window: 128_000 },
	{ pattern: /^gpt-4-turbo|^gpt-4-0125|^gpt-4-1106|^gpt-4-vision/i, window: 128_000 },
	{ pattern: /^gpt-4-32k/i, window: 32_768 },
	{ pattern: /^gpt-4/i, window: 8_192 },
	{ pattern: /^gpt-3\.5-turbo-16k/i, window: 16_385 },
	{ pattern: /^gpt-3\.5/i, window: 4_096 },
	{ pattern: /^o[134](-|$)|^o[134]-mini/i, window: 200_000 },
	{ pattern: /^claude/i, window: 200_000 },
	{ pattern: /^gemini-1\.5|^gemini-2|^gemini-exp/i, window: 1_000_000 },
	{ pattern: /^deepseek/i, window: 65_536 },
	{ pattern: /^qwen/i, window: 32_768 },
	{ pattern: /^llama-?3|^llama-?4/i, window: 128_000 },
	{ pattern: /^mistral|^mixtral|^magistral/i, window: 32_768 },
	{ pattern: /^command-r/i, window: 128_000 },
	{ pattern: /^phi-?[34]/i, window: 128_000 },
	{ pattern: /^gemma/i, window: 8_192 }
];

export interface ContextWindow {
	window?: number;
	/** True when the number came from the table rather than the provider. */
	assumed: boolean;
}

/** The window to show for a model, preferring what the provider reported. */
export function contextWindowFor(modelId: string | undefined, reported?: number): ContextWindow {
	if (reported && reported > 0) return { window: reported, assumed: false };
	const id = (modelId ?? '').split('/').pop() ?? '';
	for (const entry of KNOWN) {
		if (entry.pattern.test(id)) return { window: entry.window, assumed: true };
	}
	return { assumed: false };
}
