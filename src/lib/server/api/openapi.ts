import { z } from 'zod';

import { API_PATH, AUTHORIZE_PATH, SCOPES, TOKEN_PATH, apiResource } from '../oauth/metadata.ts';
import { ERROR } from './errors.ts';
import type { Operation } from './v1.ts';
import { OPERATIONS, PARAMS } from './v1.ts';

type Json = Record<string, unknown>;

const SCHEMAS = '#/components/schemas/';

const INTRO = `Torsel holds a person's data as bases of typed tables. This API reads and changes them as the assistant and MCP do, with the same validation and the same answers.

Authenticate with \`Authorization: Bearer <token>\`: a token created in Settings, Agents, or an OAuth access token whose resource is this API. A read token reaches the GET operations and query; a read and write token reaches all of them.

Bases, tables and fields are named by name or by id. Row values are keyed by field name; a value reads and writes as the field's type says (see Row). Every error answers {"error": {"code", "message"}}; the message says what to change. A token makes at most a few requests per second: past that, 429 with Retry-After.`;

const ERRORS: Record<number, string> = {
	400: 'the query string or body does not fit this operation',
	401: 'no token, or one this API does not take',
	403: 'the token reads only',
	404: 'no such base, table, field or row',
	422: 'the toolkit refused the call; nothing was written',
	429: 'too many requests from this token; wait as Retry-After says'
};

/** A zod schema as OpenAPI 3.1 JSON Schema, its named parts moved to the shared components. */
function schemaOf(schema: z.ZodType, io: 'input' | 'output', components: Json): Json {
	const { $defs, ...rest } = z.toJSONSchema(schema, {
		target: 'draft-2020-12',
		io,
		unrepresentable: 'any'
	}) as Json & { $defs?: Json };
	delete rest.$schema;
	const relink = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(relink);
		if (value === null || typeof value !== 'object') return value;
		return Object.fromEntries(
			Object.entries(value).map(([key, inner]) => [
				key,
				key === '$ref' && typeof inner === 'string'
					? inner.replace('#/$defs/', SCHEMAS)
					: relink(inner)
			])
		);
	};
	for (const [name, def] of Object.entries($defs ?? {})) {
		components[name] = relink(def);
	}
	return relink(rest) as Json;
}

function pathParams(path: string): string[] {
	return [...path.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]);
}

function errorStatuses(op: Operation): number[] {
	const statuses = [401, 429];
	if (pathParams(op.path).length > 0 || op.id === 'listChanges') statuses.push(404);
	if (op.query !== undefined || op.body !== undefined) statuses.push(400);
	if (op.access === 'write') statuses.push(403, 422);
	if (op.id === 'query' || op.id === 'getBase' || op.id === 'listBases') statuses.push(422);
	return [...new Set(statuses)].sort();
}

function operationOf(op: Operation, components: Json, oauth: boolean): Json {
	const parameters: Json[] = pathParams(op.path).map((name) => ({
		name,
		in: 'path',
		required: true,
		description: PARAMS[name],
		schema: { type: 'string' }
	}));
	for (const [name, field] of Object.entries(op.query?.shape ?? {})) {
		const schema = schemaOf(field as z.ZodType, 'input', components);
		const { description, ...rest } = schema;
		parameters.push({
			name,
			in: 'query',
			required: !(field as z.ZodType).safeParse(undefined).success,
			...(description === undefined ? {} : { description }),
			schema: rest,
			...(rest.type === 'array' ? { style: 'form', explode: true } : {})
		});
	}

	const responses: Json = {
		[op.status]: {
			description: op.summary,
			content: { 'application/json': { schema: schemaOf(op.response, 'output', components) } }
		}
	};
	for (const status of errorStatuses(op)) {
		responses[status] = {
			description: ERRORS[status],
			content: { 'application/json': { schema: schemaOf(ERROR, 'output', components) } }
		};
	}

	return {
		operationId: op.id,
		summary: op.summary,
		...(op.description === undefined ? {} : { description: op.description }),
		...(parameters.length === 0 ? {} : { parameters }),
		...(op.body === undefined
			? {}
			: {
					requestBody: {
						required: true,
						content: {
							'application/json': { schema: schemaOf(op.body, 'input', components) }
						}
					}
				}),
		responses,
		security: [{ token: [] }, ...(oauth ? [{ oauth: [op.access] }] : [])]
	};
}

/** The OpenAPI 3.1 document of `/api/v1`, made from the same schemas the operations validate with. */
export function openApiDocument(origin: string, oauthOrigin: string | null, version: string): Json {
	const components: Json = {};
	const paths: Record<string, Json> = {};
	for (const op of OPERATIONS) {
		paths[op.path] ??= {};
		paths[op.path][op.method.toLowerCase()] = operationOf(op, components, oauthOrigin !== null);
	}

	const securitySchemes: Json = {
		token: {
			type: 'http',
			scheme: 'bearer',
			description: 'A token created in Torsel, Settings, Agents'
		}
	};
	if (oauthOrigin !== null) {
		securitySchemes.oauth = {
			type: 'oauth2',
			description: `OAuth 2.1 with PKCE (S256); send resource=${apiResource(oauthOrigin)}`,
			flows: {
				authorizationCode: {
					authorizationUrl: `${oauthOrigin}${AUTHORIZE_PATH}`,
					tokenUrl: `${oauthOrigin}${TOKEN_PATH}`,
					refreshUrl: `${oauthOrigin}${TOKEN_PATH}`,
					scopes: Object.fromEntries(
						SCOPES.map((scope) => [
							scope,
							scope === 'read' ? 'read bases, rows and changes' : 'add, change and delete rows'
						])
					)
				}
			}
		};
	}

	return {
		openapi: '3.1.1',
		info: { title: 'Torsel', version, description: INTRO },
		servers: [{ url: `${origin}${API_PATH}` }],
		paths,
		components: { schemas: components, securitySchemes }
	};
}
