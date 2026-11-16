import { afterEach, describe, expect, it, vi } from 'vitest';

import { challenge, discoveryResponse } from './metadata.ts';

const PRM = '/.well-known/oauth-protected-resource/api/mcp';
const AS = '/.well-known/oauth-authorization-server';

async function fetchDocument(path: string, host: string): Promise<Record<string, unknown> | null> {
	const url = new URL(path, host);
	const response = discoveryResponse(new Request(url), url);
	return response === undefined ? null : ((await response.json()) as Record<string, unknown>);
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('protected resource metadata (RFC 9728)', () => {
	it('names the MCP endpoint and this server as its authorization server, from ORIGIN', async () => {
		vi.stubEnv('ORIGIN', 'https://torsel.test');
		expect(await fetchDocument(PRM, 'https://spoofed.example')).toMatchObject({
			resource: 'https://torsel.test/api/mcp',
			authorization_servers: ['https://torsel.test'],
			scopes_supported: ['read', 'write']
		});
	});

	it('keeps offline_access out of the resource scopes', async () => {
		vi.stubEnv('ORIGIN', 'https://torsel.test');
		expect((await fetchDocument(PRM, 'https://torsel.test'))?.scopes_supported).not.toContain(
			'offline_access'
		);
	});
});

describe('authorization server metadata (RFC 8414)', () => {
	it('has the issuer clients compare, S256, both client registrations and iss', async () => {
		vi.stubEnv('ORIGIN', 'https://torsel.test');
		expect(await fetchDocument(AS, 'https://spoofed.example')).toMatchObject({
			issuer: 'https://torsel.test',
			authorization_endpoint: 'https://torsel.test/oauth/authorize',
			token_endpoint: 'https://torsel.test/api/oauth/token',
			registration_endpoint: 'https://torsel.test/api/oauth/register',
			response_types_supported: ['code'],
			grant_types_supported: ['authorization_code', 'refresh_token'],
			code_challenge_methods_supported: ['S256'],
			token_endpoint_auth_methods_supported: ['none'],
			client_id_metadata_document_supported: true,
			authorization_response_iss_parameter_supported: true
		});
	});
});

describe('OAuth', () => {
	it('is off without a pinned https or loopback origin', async () => {
		vi.stubEnv('ORIGIN', 'http://192.168.1.50:3000');
		expect(await fetchDocument(PRM, 'http://192.168.1.50:3000')).toBeNull();
		expect(await fetchDocument(AS, 'http://192.168.1.50:3000')).toBeNull();
		expect(challenge(new URL('http://192.168.1.50:3000/api/mcp'), false)).toBe(
			'Bearer realm="torsel"'
		);
	});

	it('is on for a loopback origin', async () => {
		vi.stubEnv('ORIGIN', 'http://127.0.0.1:4173');
		expect((await fetchDocument(AS, 'http://127.0.0.1:4173'))?.issuer).toBe(
			'http://127.0.0.1:4173'
		);
	});
});

describe('the MCP challenge', () => {
	it('points to the resource metadata and the scopes on a 401', () => {
		vi.stubEnv('ORIGIN', 'https://torsel.test');
		const url = new URL('https://spoofed.example/api/mcp');
		expect(challenge(url, false)).toBe(
			'Bearer realm="torsel", resource_metadata="https://torsel.test/.well-known/oauth-protected-resource/api/mcp", scope="read write"'
		);
		expect(challenge(url, true)).toBe(
			'Bearer realm="torsel", error="invalid_token", resource_metadata="https://torsel.test/.well-known/oauth-protected-resource/api/mcp", scope="read write"'
		);
	});
});
