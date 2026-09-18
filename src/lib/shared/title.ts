/** The browser tab title: the open chat first, then the app name. */
export function pageTitle(chat?: string | null): string {
	const name = (chat ?? '').trim();
	return name ? `${name} / sloppychat` : 'sloppychat';
}
