/**
 * Font handling for the appearance setting. The stacks themselves live in
 * src/app.css; this only turns what the user typed into a CSS font family list.
 */

/** System stacks live in CSS, so the fallback chain is defined in one place. */
export const SYSTEM_FONT_VAR = 'var(--ui-font-system)';

/**
 * Turns a typed font name into a font family value. A single name is quoted so
 * names with spaces work; a value the user already wrote as a list is kept, but
 * the system stack is still appended as the fallback.
 */
export function fontStack(input: string | undefined): string {
	const value = (input ?? '').trim().replace(/;$/, '');
	if (!value) return SYSTEM_FONT_VAR;
	const custom = value.includes(',') || value.includes('"') || value.includes("'")
		? value
		: `"${value.replace(/"/g, '')}"`;
	return `${custom}, ${SYSTEM_FONT_VAR}`;
}

/** Normalises a stored font choice, since older settings used preset names. */
export function fontChoice(value: string | undefined): 'system' | 'custom' {
	return value === 'custom' ? 'custom' : 'system';
}
