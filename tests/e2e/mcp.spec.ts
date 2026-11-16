import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import type { APIRequestContext } from '@playwright/test';

import { expect, mint, rpc, test } from './harness.ts';

test.skip(({ isMobile }) => isMobile, 'the protocol is the same whatever the screen');

async function health(request: APIRequestContext): Promise<number> {
	const started = performance.now();
	expect((await request.get('/api/health')).ok()).toBe(true);
	return performance.now() - started;
}

test('a runaway query leaves every other request answering at idle speed', async ({
	context,
	account
}) => {
	void account;
	const token = await mint(context.request);
	await rpc(context.request, token, 'create_base', { name: 'Gym' });
	const idle = Math.max(
		await health(context.request),
		await health(context.request),
		await health(context.request)
	);

	const runaway = rpc(context.request, token, 'query', {
		base: 'Gym',
		sql: 'with recursive c(x) as (select 1 union all select x + 1 from c) select count(*) from c'
	});
	await new Promise((resolve) => setTimeout(resolve, 200));
	const during = await health(context.request);

	expect(await runaway).toMatchObject({
		isError: true,
		content: [{ text: expect.stringMatching(/^the query ran past 500 ms/u) }]
	});
	expect(during, `idle took ${Math.round(idle)} ms`).toBeLessThan(idle + 150);
});

/** Forwards to the server with the token, which the conformance suite has no option to send. */
async function proxy(base: string, token: string): Promise<{ url: string; server: Server }> {
	const server = createServer(async (incoming, outgoing) => {
		const chunks: Buffer[] = [];
		for await (const chunk of incoming) chunks.push(chunk as Buffer);
		const headers = new Headers();
		for (const [key, value] of Object.entries(incoming.headers)) {
			if (typeof value === 'string' && key !== 'host' && key !== 'content-length') {
				headers.set(key, value);
			}
		}
		headers.set('authorization', `Bearer ${token}`);
		const answer = await fetch(new URL(incoming.url ?? '/', base), {
			method: incoming.method,
			headers,
			body: ['GET', 'HEAD'].includes(incoming.method ?? 'GET') ? undefined : Buffer.concat(chunks)
		});
		outgoing.writeHead(answer.status, Object.fromEntries(answer.headers));
		if (answer.body !== null) {
			for await (const chunk of answer.body) outgoing.write(chunk);
		}
		outgoing.end();
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

async function run(
	command: string,
	args: string[],
	env: Record<string, string> = {}
): Promise<{ code: number | null; output: string }> {
	const child = spawn(join(import.meta.dirname, 'node_modules/.bin', command), args, {
		env: { ...process.env, ...env }
	});
	let output = '';
	child.stdout.on('data', (chunk) => (output += String(chunk)));
	child.stderr.on('data', (chunk) => (output += String(chunk)));
	const [code] = (await once(child, 'exit')) as [number | null];
	return { code, output };
}

for (const revision of ['2026-07-28', '2025-11-25']) {
	test(`passes the ${revision} conformance requirements, each exception listed`, async ({
		context,
		account,
		baseURL
	}) => {
		void account;
		test.setTimeout(180_000);
		const { url, server } = await proxy(baseURL ?? '', await mint(context.request));
		try {
			const { code, output } = await run('conformance', [
				'server',
				'--url',
				`${url}/api/mcp`,
				'--requirements',
				revision,
				'--expected-failures',
				join(import.meta.dirname, `mcp-baseline-${revision}.yml`),
				'--output-dir',
				test.info().outputPath('conformance')
			]);
			expect(code, output.slice(-4000)).toBe(0);
		} finally {
			server.close();
		}
	});
}

test('lists tools Inspector finds portable to every client', async ({
	context,
	account,
	baseURL
}) => {
	void account;
	const home = test.info().outputPath('home');
	mkdirSync(home, { recursive: true });
	const token = await mint(context.request);

	for (const era of ['modern', 'auto']) {
		const { code, output } = await run(
			'inspector',
			[
				'--cli',
				'--transport',
				'http',
				'--header',
				`Authorization: Bearer ${token}`,
				'--method',
				'tools/list',
				'--strict',
				'--protocol-era',
				era,
				`${baseURL}/api/mcp`
			],
			{ HOME: home }
		);
		expect(code, output.slice(-4000)).toBe(0);
		expect(output, era).toContain('"name": "update_view"');
		expect(output, era).not.toMatch(/warnings? across|errors? across/u);
	}
});
