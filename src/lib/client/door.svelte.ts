/**
 * The door as the browser sees it. A 401 from our own API means the token changed
 * or the cookie expired, so the app asks for it in place instead of filling the
 * screen with failed requests.
 */
class Door {
	/** True while the app is waiting for a token it can use. */
	needsToken = $state(false);

	/** True when the last token offered was refused. */
	wrong = $state(false);

	/** True while a token is on its way to the server. */
	busy = $state(false);

	/** Reads one response status. True when the token is the reason it failed. */
	deny(status: number): boolean {
		if (status !== 401) return false;
		this.needsToken = true;
		return true;
	}

	/**
	 * Offers a token on the current path, which is the route the door already
	 * answers: it sets the cookie and redirects to the clean address. The page then
	 * reloads, so every request that failed before runs again with the cookie.
	 */
	async submit(token: string): Promise<boolean> {
		this.busy = true;
		try {
			const res = await fetch(`${location.pathname}?token=${encodeURIComponent(token)}`);
			if (!res.ok) {
				this.wrong = true;
				return false;
			}
			this.needsToken = false;
			this.wrong = false;
			location.reload();
			return true;
		} finally {
			this.busy = false;
		}
	}
}

export const door = new Door();
