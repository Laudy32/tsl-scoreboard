// Offline support: serve from the network when possible, fall back to cache.
// Network-first means a new deploy shows up on the next load with no version bump.
const CACHE = 'tsl-scoreboard';
const FILES = [
	'./',
	'index.html',
	'css/style.css',
	'js/app.js',
	'js/state.js',
	'manifest.webmanifest',
	'assets/emblem-256.png',
	'assets/fonts/big-shoulders.woff2',
	'assets/fonts/barlow-sc-500.woff2',
	'assets/fonts/barlow-sc-700.woff2',
	'assets/saber-icon.png',
	'assets/saber-icon-192.png',
];

self.addEventListener('install', e => {
	e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
	e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
	if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
	e.respondWith(
		fetch(e.request)
			.then(res => {
				const copy = res.clone();
				caches.open(CACHE).then(c => c.put(e.request, copy));
				return res;
			})
			.catch(() => caches.match(e.request, { ignoreSearch: true }))
	);
});
