// @ts-nocheck -- a service worker has its own global scope
/**
 * The service worker. It keeps the shell so the app opens quickly and can say
 * something useful when the server is away.
 *
 * It never caches the API. The event stream, the turns and the queue must always
 * reach the server, and a cached answer would be a lie.
 *
 * Bump VERSION to publish a new shell. The caches of older versions go when this
 * worker takes over, and the page shows a notice when a new worker is ready.
 */

const VERSION = 'v1';
const SHELL = `sloppychat-shell-${VERSION}`;

/** The files of the shell. Nothing here comes from the API. */
const SHELL_FILES = [
	'/',
	'/offline.html',
	'/manifest.webmanifest',
	'/favicon.svg',
	'/icon-192.png',
	'/icon-512.png',
	'/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(SHELL)
			.then((cache) => cache.addAll(SHELL_FILES))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
	// The API is never cached, and nothing about it is ever served from here.
	if (url.pathname.startsWith('/api/')) return;

	// A page: the network first, so a new version arrives, and the cached page or
	// the offline page when the server does not answer.
	if (event.request.mode === 'navigate') {
		event.respondWith(
			fetch(event.request)
				.then((response) => {
					const copy = response.clone();
					void caches.open(SHELL).then((cache) => cache.put(event.request, copy));
					return response;
				})
				.catch(() => caches.match(event.request).then((hit) => hit || caches.match('/offline.html')))
		);
		return;
	}

	// The built assets carry a hash in their name, so a cached copy is always the
	// right copy for that name.
	if (url.pathname.startsWith('/_app/immutable/')) {
		event.respondWith(
			caches.match(event.request).then(
				(hit) =>
					hit ||
					fetch(event.request).then((response) => {
						if (response.ok) {
							const copy = response.clone();
							void caches.open(SHELL).then((cache) => cache.put(event.request, copy));
						}
						return response;
					})
			)
		);
	}
});
