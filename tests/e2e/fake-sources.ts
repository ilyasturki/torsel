import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What one path answers; `need` turns away a request that doesn't carry it. */
export type FakeAnswer = {
	status?: number;
	type?: string;
	body: string;
	// Base64, for a binary body such as a workbook.
	bytes?: string;
	headers?: Record<string, string>;
	need?: { header: string; value: string } | { query: string; value: string };
};

export type FakeHit = { path: string; authorization: string | null };

// Each spec writes under its own key, so specs running side by side never see each other's links.
const answers = new Map<string, Record<string, FakeAnswer>>();
const hits = new Map<string, FakeHit[]>();

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let body = '';
		request.on('data', (chunk) => {
			body += String(chunk);
		});
		request.on('end', () => resolve(body));
	});
}

function allowed(answer: FakeAnswer, request: IncomingMessage, url: URL): boolean {
	const need = answer.need;
	if (need === undefined) return true;
	if ('header' in need) return request.headers[need.header.toLowerCase()] === need.value;
	return url.searchParams.get(need.query) === need.value;
}

/** Links a source can read: `/<key>/<path>` answers what `POST /__set?key=<key>` set. */
export function startSources(): Promise<{ url: string; close(): void }> {
	const server = createServer((request, response) => {
		void (async () => {
			const url = new URL(request.url ?? '/', 'http://sources');
			const key = url.searchParams.get('key') ?? '';
			if (url.pathname === '/__set' && request.method === 'POST') {
				answers.set(key, {
					...answers.get(key),
					...(JSON.parse(await readBody(request)) as Record<string, FakeAnswer>)
				});
				response.end();
				return;
			}
			if (url.pathname === '/__hits') {
				response.writeHead(200, { 'content-type': 'application/json' });
				response.end(JSON.stringify(hits.get(key) ?? []));
				return;
			}
			const [, owner, ...rest] = url.pathname.split('/');
			const path = `/${rest.join('/')}`;
			const seen = hits.get(owner) ?? [];
			seen.push({ path, authorization: request.headers.authorization ?? null });
			hits.set(owner, seen);
			const answer = answers.get(owner)?.[path];
			if (answer === undefined) {
				response.writeHead(404);
				response.end();
				return;
			}
			if (!allowed(answer, request, url)) {
				response.writeHead(401);
				response.end();
				return;
			}
			response.writeHead(answer.status ?? 200, {
				'content-type': answer.type ?? 'text/csv',
				...answer.headers
			});
			response.end(answer.bytes === undefined ? answer.body : Buffer.from(answer.bytes, 'base64'));
		})();
	});
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			resolve({
				url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
				close: () => server.close()
			});
		});
	});
}
