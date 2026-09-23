import { app } from './state.svelte';

/** How long a pending settings patch waits before it is written. */
const DRAFT_MS = 400;

type Patch = Parameters<typeof app.saveSettings>[0];

/**
 * The settings that are cheap to edit are written on a short delay, so typing in a
 * number does not send a request per key. One draft serves the whole panel, because
 * only one field is ever being edited, and it has to outlive the tab that started
 * the wait so a close can still write the edit.
 */
class SettingsDraft {
	#timer: ReturnType<typeof setTimeout> | undefined;
	#patch: Patch | undefined;

	save(patch: Patch): void {
		clearTimeout(this.#timer);
		this.#patch = patch;
		this.#timer = setTimeout(() => {
			const pending = this.#patch;
			this.#patch = undefined;
			if (pending) void app.saveSettings(pending);
		}, DRAFT_MS);
	}

	/**
	 * The last edit may still wait on the delay, so leaving the panel writes it
	 * instead of dropping it. A failed write says so, because `saveSettings` toasts.
	 */
	flush(): void {
		clearTimeout(this.#timer);
		const pending = this.#patch;
		this.#patch = undefined;
		if (pending) void app.saveSettings(pending);
	}
}

const draft = new SettingsDraft();

/** Bound here, so a tab can call `save(patch)` without holding the object. */
export const save = (patch: Patch): void => draft.save(patch);

/** Writes an edit that still waits on the delay, which the panel does when it closes. */
export const flush = (): void => draft.flush();
