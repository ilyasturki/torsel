import { createHash, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/client';
import { Client, StreamableHTTPClientTransport, auth } from '@modelcontextprotocol/client';
import type { APIRequestContext, Page } from '@playwright/test';

import { expect, newAccount, newAddress, passwordSignIn, test } from './harness.ts';

// The client's loopback callback: nothing listens there, the page's route answers it. Chromium refuses low ports such as 9.
const CALLBACK = 'http://127.0.0.1:41917/callback';
const BACK = 'http://127.0.0.1:41917/**';

type Tokens = { access_token: string; refresh_token: string; scope: string; expires_in: number };

function pkce(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString('base64url');
	return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function register(request: APIRequestContext, name = 'Stub agent'): Promise<string> {
	const registered = await request.post('/api/oauth/register', {
		data: { client_name: name, redirect_uris: ['http://127.0.0.1/callback'] }
	});
	expect(registered.status()).toBe(201);
	return ((await registered.json()) as { client_id: string }).client_id;
}

function authorizeUrl(
	baseURL: string,
	clientId: string,
	challenge: string,
	overrides: Record<string, string> = {}
): string {
	const url = new URL('/oauth/authorize', baseURL);
	url.search = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: CALLBACK,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		state: 'e2e-state',
		scope: 'read write',
		resource: `${baseURL}/api/mcp`,
		...overrides
	}).toString();
	return url.href;
}

/** Opens the authorization URL and answers the consent; returns where the client got sent. */
async function consent(
	page: Page,
	url: string,
	answer: { allow: boolean; readOnly?: boolean } = { allow: true }
): Promise<URL> {
	await page.route(BACK, (route) => route.fulfill({ contentType: 'text/plain', body: 'back' }));
	await page.goto(url);
	if (answer.readOnly === true) {
		await page.getByLabel('Read only').check();
	}
	await page.getByRole('button', { name: answer.allow ? 'Allow' : 'Deny' }).click();
	await page.waitForURL(BACK);
	return new URL(page.url());
}

async function trade(
	request: APIRequestContext,
	form: Record<string, string>
): Promise<{ status: number; body: Record<string, string> & Partial<Tokens> }> {
	const answer = await request.post('/api/oauth/token', { form });
	return { status: answer.status(), body: (await answer.json()) as Record<string, string> };
}

async function tools(request: APIRequestContext, bearer: string): Promise<number | string[]> {
	const answer = await request.post('/api/mcp', {
		headers: { authorization: `Bearer ${bearer}`, accept: 'application/json, text/event-stream' },
		data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
	});
	if (answer.status() !== 200) return answer.status();
	const body = await answer.text();
	const json = body.startsWith('{') ? body : (/^data: (.*)$/mu.exec(body)?.[1] ?? '');
	const { result } = JSON.parse(json) as { result: { tools: { name: string }[] } };
	return result.tools.map(({ name }) => name);
}

async function connect(
	page: Page,
	request: APIRequestContext,
	baseURL: string,
	readOnly = false
): Promise<{ clientId: string; tokens: Tokens }> {
	const clientId = await register(request);
	const { verifier, challenge } = pkce();
	const back = await consent(page, authorizeUrl(baseURL, clientId, challenge), {
		allow: true,
		readOnly
	});
	const { status, body } = await trade(request, {
		grant_type: 'authorization_code',
		code: back.searchParams.get('code') ?? '',
		client_id: clientId,
		redirect_uri: CALLBACK,
		code_verifier: verifier,
		resource: `${baseURL}/api/mcp`
	});
	expect(status).toBe(200);
	return { clientId, tokens: body as Tokens };
}

test('an agent connects by signing in, with no token to copy', async ({
	page,
	context,
	request: anonymous,
	account,
	baseURL
}) => {
	void account;
	const base = baseURL ?? '';
	const { request } = context;

	const challenge = await anonymous.post('/api/mcp', {
		headers: { 'content-type': 'application/json' },
		data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
	});
	expect(challenge.status()).toBe(401);
	const documentUrl = `${base}/.well-known/oauth-protected-resource/api/mcp`;
	expect(challenge.headers()['www-authenticate']).toBe(
		`Bearer realm="torsel", resource_metadata="${documentUrl}", scope="read write"`
	);
	const resource = (await (await request.get(documentUrl)).json()) as Record<string, unknown>;
	expect(resource).toMatchObject({ resource: `${base}/api/mcp`, authorization_servers: [base] });
	const server = (await (
		await request.get('/.well-known/oauth-authorization-server')
	).json()) as Record<string, unknown>;
	expect(server).toMatchObject({
		issuer: base,
		code_challenge_methods_supported: ['S256'],
		client_id_metadata_document_supported: true
	});

	const clientId = await register(request);
	const { verifier, challenge: hashed } = pkce();
	await page.route(BACK, (route) => route.fulfill({ contentType: 'text/plain', body: 'back' }));
	await page.goto(authorizeUrl(base, clientId, hashed));
	await expect(
		page.getByRole('heading', { name: 'Stub agent wants to read and change your bases' })
	).toBeVisible();
	await expect(page.getByText('127.0.0.1', { exact: true })).toBeVisible();
	await expect(page.getByText(/^Allow it only if/u)).toBeVisible();
	await page.getByRole('button', { name: 'Allow' }).click();
	await page.waitForURL(BACK);
	const back = new URL(page.url());
	expect(back.searchParams.get('state')).toBe('e2e-state');
	expect(back.searchParams.get('iss')).toBe(base);

	const { status, body } = await trade(request, {
		grant_type: 'authorization_code',
		code: back.searchParams.get('code') ?? '',
		client_id: clientId,
		redirect_uri: CALLBACK,
		code_verifier: verifier,
		resource: `${base}/api/mcp`
	});
	expect(status).toBe(200);
	expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read write' });
	expect(await tools(request, body.access_token ?? '')).toContain('add_rows');

	await page.goto('/app/settings');
	const connected = page.locator('section', {
		has: page.getByRole('heading', { name: 'Connected apps' })
	});
	await expect(connected.getByText('Stub agent')).toBeVisible();
	await expect(connected.getByText(/^read and write, last used /u)).toBeVisible();
	await connected.getByRole('button', { name: 'Revoke' }).click();
	await expect(connected).toBeHidden();
	expect(await tools(request, body.access_token ?? '')).toBe(401);
});

test('the read only switch narrows what the agent gets', async ({
	page,
	context,
	account,
	baseURL
}) => {
	void account;
	const { tokens } = await connect(page, context.request, baseURL ?? '', true);
	expect(tokens.scope).toBe('read');
	const listed = await tools(context.request, tokens.access_token);
	expect(listed).toContain('query');
	expect(listed).not.toContain('add_rows');
});

test('declining sends the agent away empty-handed', async ({ page, context, account, baseURL }) => {
	void account;
	const clientId = await register(context.request);
	const back = await consent(page, authorizeUrl(baseURL ?? '', clientId, pkce().challenge), {
		allow: false
	});
	expect(back.searchParams.get('error')).toBe('access_denied');
	expect(back.searchParams.get('code')).toBeNull();
});

test('a signed-out person signs in, then lands on the consent', async ({
	page,
	context,
	baseURL
}) => {
	const someone = newAccount();
	const clientId = await register(context.request);
	await page.goto(authorizeUrl(baseURL ?? '', clientId, pkce().challenge));
	await expect(page).toHaveURL(/\/app\/login\?to=/u);
	await passwordSignIn(page, someone);
	await expect(
		page.getByRole('heading', { name: 'Stub agent wants to read and change your bases' })
	).toBeVisible();
	await expect(page.getByText(someone.email)).toBeVisible();
});

test('an unknown return address stops here, before reaching anyone', async ({
	page,
	context,
	account,
	baseURL
}) => {
	void account;
	const clientId = await register(context.request);
	let leaked = false;
	await page.route('https://evil.example/**', (route) => {
		leaked = true;
		return route.abort();
	});
	await page.goto(
		authorizeUrl(baseURL ?? '', clientId, pkce().challenge, {
			redirect_uri: 'https://evil.example/callback'
		})
	);
	await expect(
		page.getByRole('heading', { name: 'This app asked to return somewhere it didn’t declare' })
	).toBeVisible();
	await expect(page.getByRole('link', { name: 'Open Torsel' })).toBeVisible();
	expect(leaked).toBe(false);
});

test.describe('the protocol', () => {
	test.skip(({ isMobile }) => isMobile, 'the protocol is the same whatever the screen');

	test('a refresh token rotates, and a replay revokes the whole connection', async ({
		page,
		context,
		account,
		baseURL
	}) => {
		void account;
		const { request } = context;
		const { clientId, tokens } = await connect(page, request, baseURL ?? '');

		const rotated = await trade(request, {
			grant_type: 'refresh_token',
			refresh_token: tokens.refresh_token,
			client_id: clientId
		});
		expect(rotated.status).toBe(200);
		expect(rotated.body.refresh_token).not.toBe(tokens.refresh_token);
		const fresh = rotated.body.access_token ?? '';
		expect(await tools(request, fresh)).toContain('add_rows');

		const replay = await trade(request, {
			grant_type: 'refresh_token',
			refresh_token: tokens.refresh_token,
			client_id: clientId
		});
		expect(replay).toEqual({
			status: 400,
			body: { error: 'invalid_grant', error_description: 'the refresh token was already used' }
		});
		expect(await tools(request, fresh)).toBe(401);
		const next = await trade(request, {
			grant_type: 'refresh_token',
			refresh_token: rotated.body.refresh_token ?? '',
			client_id: clientId
		});
		expect(next.body.error).toBe('invalid_grant');
	});

	test('a code needs its PKCE verifier, and works once', async ({
		page,
		context,
		account,
		baseURL
	}) => {
		void account;
		const { request } = context;
		const base = baseURL ?? '';
		const clientId = await register(request);
		const { verifier, challenge } = pkce();
		const back = await consent(page, authorizeUrl(base, clientId, challenge));
		const form = {
			grant_type: 'authorization_code',
			code: back.searchParams.get('code') ?? '',
			client_id: clientId,
			redirect_uri: CALLBACK
		};
		expect((await trade(request, { ...form, code_verifier: pkce().verifier })).body.error).toBe(
			'invalid_grant'
		);
		expect((await trade(request, { ...form, code_verifier: verifier })).body.error).toBe(
			'invalid_grant'
		);
	});

	test('a token for another resource is refused at both ends', async ({
		page,
		context,
		account,
		baseURL
	}) => {
		void account;
		const { request } = context;
		const base = baseURL ?? '';
		const clientId = await register(request);

		const elsewhere = await consentlessRedirect(
			request,
			authorizeUrl(base, clientId, pkce().challenge, { resource: 'https://elsewhere.example/mcp' })
		);
		expect(elsewhere.searchParams.get('error')).toBe('invalid_target');
		expect(elsewhere.searchParams.get('iss')).toBe(base);

		const { verifier, challenge } = pkce();
		const back = await consent(page, authorizeUrl(base, clientId, challenge));
		const answer = await trade(request, {
			grant_type: 'authorization_code',
			code: back.searchParams.get('code') ?? '',
			client_id: clientId,
			redirect_uri: CALLBACK,
			code_verifier: verifier,
			resource: 'https://elsewhere.example/mcp'
		});
		expect(answer.body.error).toBe('invalid_target');
	});

	test('the consent can only be given from this server’s own page', async ({
		page,
		context,
		request: anonymous,
		account,
		baseURL
	}) => {
		const clientId = await register(context.request);
		await page.goto(authorizeUrl(baseURL ?? '', clientId, pkce().challenge));
		await expect(page.getByRole('button', { name: 'Allow' })).toBeVisible();
		const id = new URL(page.url()).searchParams.get('request') ?? '';

		const device = await anonymous.post('/api/auth/login', {
			data: { ...account, client: 'device', label: 'Phone' }
		});
		const { token } = (await device.json()) as { token: string };
		const fromDevice = await anonymous.get(`/api/oauth/requests/${id}`, {
			headers: { authorization: `Bearer ${token}` }
		});
		expect(fromDevice.status()).toBe(403);

		const cookie = (await context.cookies())
			.map(({ name, value }) => `${name}=${value}`)
			.join('; ');
		// Plain fetch: Playwright's request context sets its own Origin and content type.
		const answer = (origin: string, type: string) =>
			fetch(`${baseURL}/api/oauth/requests/${id}`, {
				method: 'POST',
				headers: { cookie, origin, 'content-type': type, 'x-forwarded-for': newAddress() },
				body: JSON.stringify({ allow: true, access: 'write' })
			});
		const forged = await answer('https://evil.example', 'application/json');
		expect(forged.status).toBe(403);
		const asText = await answer(baseURL ?? '', 'text/plain');
		expect(asText.status).toBe(415);
		const own = await answer(baseURL ?? '', 'application/json');
		expect(own.status).toBe(200);
	});

	test('a client known by its metadata document connects without registering', async ({
		page,
		context,
		account,
		baseURL
	}) => {
		void account;
		const base = baseURL ?? '';
		const fixture = await serveDocument((url) => ({
			client_id: url,
			client_name: 'Document agent',
			redirect_uris: ['http://127.0.0.1/callback'],
			token_endpoint_auth_method: 'none'
		}));
		try {
			const { verifier, challenge } = pkce();
			await page.route(BACK, (route) => route.fulfill({ contentType: 'text/plain', body: 'back' }));
			await page.goto(authorizeUrl(base, fixture.url, challenge));
			await expect(
				page.getByRole('heading', { name: 'Document agent wants to read and change your bases' })
			).toBeVisible();
			await expect(page.getByText(new URL(fixture.url).host, { exact: true })).toBeVisible();
			await page.getByRole('button', { name: 'Allow' }).click();
			await page.waitForURL(BACK);
			const answer = await trade(context.request, {
				grant_type: 'authorization_code',
				code: new URL(page.url()).searchParams.get('code') ?? '',
				client_id: fixture.url,
				redirect_uri: CALLBACK,
				code_verifier: verifier
			});
			expect(answer.status).toBe(200);
			expect(await tools(context.request, answer.body.access_token ?? '')).toContain('add_rows');
		} finally {
			fixture.server.close();
		}
	});

	test('the official MCP client signs in on its own', async ({
		page,
		context,
		account,
		baseURL
	}) => {
		void account;
		const base = baseURL ?? '';
		const address = newAddress();
		const fetchFrom: typeof fetch = (input, init) => {
			const headers = new Headers(init?.headers);
			headers.set('x-forwarded-for', address);
			return fetch(input, { ...init, headers });
		};
		const store: {
			client?: Awaited<ReturnType<OAuthClientProvider['clientInformation']>>;
			tokens?: Awaited<ReturnType<OAuthClientProvider['tokens']>>;
			verifier?: string;
			visit?: URL;
			discovery?: OAuthDiscoveryState;
		} = {};
		const provider: OAuthClientProvider = {
			redirectUrl: CALLBACK,
			clientMetadata: {
				client_name: 'SDK agent',
				redirect_uris: [CALLBACK],
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				token_endpoint_auth_method: 'none'
			},
			clientInformation: () => store.client,
			saveClientInformation: (information) => {
				store.client = information;
			},
			tokens: () => store.tokens,
			saveTokens: (tokens) => {
				store.tokens = tokens;
			},
			redirectToAuthorization: (url) => {
				store.visit = url;
			},
			saveCodeVerifier: (verifier) => {
				store.verifier = verifier;
			},
			codeVerifier: () => store.verifier ?? '',
			saveDiscoveryState: (state) => {
				store.discovery = state;
			},
			discoveryState: () => store.discovery
		};
		const serverUrl = `${base}/api/mcp`;

		expect(await auth(provider, { serverUrl, fetchFn: fetchFrom })).toBe('REDIRECT');
		const back = await consent(page, store.visit?.href ?? '');
		expect(
			await auth(provider, {
				serverUrl,
				fetchFn: fetchFrom,
				authorizationCode: back.searchParams.get('code') ?? '',
				iss: back.searchParams.get('iss') ?? undefined
			})
		).toBe('AUTHORIZED');

		const client = new Client({ name: 'sdk-agent', version: '1.0.0' });
		await client.connect(
			new StreamableHTTPClientTransport(new URL(serverUrl), {
				authProvider: provider,
				fetch: fetchFrom
			})
		);
		const { tools: listed } = await client.listTools();
		expect(listed.map(({ name }) => name)).toContain('add_rows');
		await client.close();

		const first = store.tokens;
		store.tokens = { ...first, access_token: 'ts_expired' } as typeof first;
		expect(await auth(provider, { serverUrl, fetchFn: fetchFrom })).toBe('AUTHORIZED');
		expect(store.tokens?.refresh_token).not.toBe(first?.refresh_token);
		expect(await tools(context.request, store.tokens?.access_token ?? '')).toContain('add_rows');
	});
});

test.describe('in French', () => {
	test.use({ locale: 'fr-FR' });

	test('the consent speaks the reader’s language', async ({ page, context, account, baseURL }) => {
		void account;
		const clientId = await register(context.request);
		await page.goto(authorizeUrl(baseURL ?? '', clientId, pkce().challenge));
		await expect(
			page.getByRole('heading', { name: 'Stub agent veut lire et modifier tes bases' })
		).toBeVisible();
		await expect(page.getByText('Retour vers')).toBeVisible();
		await expect(page.getByLabel('Lecture seule')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Autoriser' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Refuser' })).toBeVisible();
	});
});

/** Where the authorization endpoint sends the browser, read without one: Chromium hands no redirect to a page's route. */
async function consentlessRedirect(request: APIRequestContext, url: string): Promise<URL> {
	const answer = await request.get(url, { maxRedirects: 0 });
	expect(answer.status()).toBe(303);
	return new URL(answer.headers().location ?? '');
}

async function serveDocument(
	describe: (url: string) => Record<string, unknown>
): Promise<{ url: string; server: Server }> {
	let url = '';
	const server = createServer((_, response) => {
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(JSON.stringify(describe(url)));
	});
	await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/client.json`;
	return { url, server };
}
