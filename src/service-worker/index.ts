import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { self } from '$app/service-worker';

const CACHE = `shell-${version}`;
const SHELL = '/app';
const PRECACHED = new Set([...immutable, ...assets].map((asset) => `/${asset.path}`));

// A weak signal hangs instead of failing, and logging a set can't wait on it.
const NETWORK_PATIENCE_MS = 3000;

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll([new Request(SHELL, { cache: 'reload' }), ...PRECACHED]);
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const stale = (await caches.keys()).filter((key) => key !== CACHE);
			await Promise.all(stale.map((key) => caches.delete(key)));
			await self.clients.claim();
		})()
	);
});

// `/app` has no server rendering, so its HTML is the same at every address under it.
async function openShell(request: Request): Promise<Response> {
	const network = fetch(request);
	const shell = await caches.match(SHELL, { cacheName: CACHE });
	if (shell === undefined) {
		return network;
	}
	const patience = new Promise<Response>((settle) => {
		setTimeout(() => settle(shell), NETWORK_PATIENCE_MS);
	});
	try {
		const response = await Promise.race([network, patience]);
		return response.status >= 500 ? shell : response;
	} catch {
		return shell;
	}
}

async function fromPrecache(request: Request): Promise<Response> {
	return (await caches.match(request, { cacheName: CACHE })) ?? fetch(request);
}

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.mode === 'navigate') {
		event.respondWith(openShell(request));
		return;
	}
	const url = new URL(request.url);
	if (request.method === 'GET' && url.origin === self.location.origin) {
		if (PRECACHED.has(url.pathname)) {
			event.respondWith(fromPrecache(request));
		}
	}
});
