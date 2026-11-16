import type { OAuthMetadata } from '@modelcontextprotocol/server';
import {
	getOAuthProtectedResourceMetadataUrl,
	oauthMetadataResponse
} from '@modelcontextprotocol/server';

import { oauthOrigin } from '../config.ts';

export const MCP_PATH = '/api/mcp';
export const AUTHORIZE_PATH = '/oauth/authorize';
export const TOKEN_PATH = '/api/oauth/token';
export const REGISTER_PATH = '/api/oauth/register';
export const REVOKE_PATH = '/api/oauth/revoke';

export const SCOPES = ['read', 'write'];

/** The audience of every token this server issues: what clients send as `resource`. */
export function mcpResource(origin: string): string {
	return `${origin}${MCP_PATH}`;
}

export function serverMetadata(origin: string): OAuthMetadata {
	return {
		issuer: origin,
		authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
		token_endpoint: `${origin}${TOKEN_PATH}`,
		registration_endpoint: `${origin}${REGISTER_PATH}`,
		revocation_endpoint: `${origin}${REVOKE_PATH}`,
		response_types_supported: ['code'],
		response_modes_supported: ['query'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		revocation_endpoint_auth_methods_supported: ['none'],
		scopes_supported: [...SCOPES, 'offline_access'],
		client_id_metadata_document_supported: true,
		authorization_response_iss_parameter_supported: true
	};
}

/** The two discovery documents, when OAuth is on and the request asks for one. */
export function discoveryResponse(request: Request, url: URL): Response | undefined {
	if (!url.pathname.startsWith('/.well-known/oauth-')) {
		return undefined;
	}
	const origin = oauthOrigin(url);
	if (origin === null) {
		return undefined;
	}
	return oauthMetadataResponse(request, {
		oauthMetadata: serverMetadata(origin),
		resourceServerUrl: new URL(mcpResource(origin)),
		scopesSupported: SCOPES,
		resourceName: 'Torsel'
	});
}

/** `WWW-Authenticate` for a 401 on the MCP endpoint: where to sign in, when OAuth is on. */
export function mcpChallenge(url: URL, invalidToken: boolean): string {
	const parts = ['Bearer realm="torsel"'];
	if (invalidToken) {
		parts.push('error="invalid_token"');
	}
	const origin = oauthOrigin(url);
	if (origin !== null) {
		const document = getOAuthProtectedResourceMetadataUrl(new URL(mcpResource(origin)));
		parts.push(`resource_metadata="${document}"`, `scope="${SCOPES.join(' ')}"`);
	}
	return parts.join(', ');
}
