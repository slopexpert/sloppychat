<script lang="ts">
	import { door } from '$lib/client/door.svelte';

	let token = $state('');

	/** Offers the token on the current path, then lets the reload resume the work. */
	async function open(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!token || door.busy) return;
		await door.submit(token);
	}
</script>

{#if door.needsToken}
	<div class="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
		<form class="card pointer-events-auto w-full max-w-sm border border-line p-3 shadow-lg" onsubmit={open}>
			<strong class="text-sm">Token required</strong>
			<p class="text-xs text-muted">This browser no longer holds a token the server accepts.</p>
			{#if door.wrong}
				<p class="text-xs text-danger">The token did not match.</p>
			{/if}
			<div class="mt-1 flex gap-2">
				<!-- svelte-ignore a11y_autofocus -- the panel is the only thing left to do on the page -->
				<input
					class="field min-w-0 flex-1 text-sm"
					type="password"
					placeholder="token"
					autocomplete="current-password"
					autofocus
					bind:value={token}
					disabled={door.busy}
				/>
				<button class="btn btn-accent text-sm" type="submit" disabled={door.busy || !token}>
					{door.busy ? 'Checking' : 'Open'}
				</button>
			</div>
		</form>
	</div>
{/if}
