export type Schema = {
	$ref?: string;
	type?: string | string[];
	enum?: unknown[];
	anyOf?: Schema[];
	items?: Schema;
	properties?: Record<string, Schema>;
	required?: string[];
	additionalProperties?: Schema | boolean;
	description?: string;
};

export type Parameter = {
	name: string;
	in: 'path' | 'query';
	required: boolean;
	description?: string;
	schema: Schema;
};

type Media = { content: { 'application/json': { schema: Schema } } };

export type Operation = {
	operationId: string;
	summary: string;
	description?: string;
	parameters?: Parameter[];
	requestBody?: Media;
	responses: Record<string, Media & { description: string }>;
	security: Record<string, string[]>[];
};

export type ApiDocument = {
	servers: { url: string }[];
	paths: Record<string, Record<string, Operation>>;
	components: { schemas: Record<string, Schema> };
};

export type Entry = { method: string; path: string; operation: Operation };

export function entries(doc: ApiDocument): Entry[] {
	return Object.entries(doc.paths).flatMap(([path, methods]) =>
		Object.entries(methods).map(([method, operation]) => ({
			method: method.toUpperCase(),
			path,
			operation
		}))
	);
}

/** What a JSON Schema holds, written as a TypeScript type for a reader. */
export function shape(schema: Schema, depth = 0): string {
	if (schema.$ref !== undefined) {
		return schema.$ref.slice(schema.$ref.lastIndexOf('/') + 1);
	}
	if (schema.enum !== undefined) {
		return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
	}
	if (schema.anyOf !== undefined) {
		return schema.anyOf.map((part) => shape(part, depth)).join(' | ');
	}
	if (Array.isArray(schema.type)) {
		return schema.type.map((type) => shape({ ...schema, type }, depth)).join(' | ');
	}
	if (schema.type === 'array') {
		const item = schema.items === undefined ? 'unknown' : shape(schema.items, depth);
		return item.includes(' | ') && !item.startsWith('{') ? `(${item})[]` : `${item}[]`;
	}
	if (schema.type === 'integer') {
		return 'number';
	}
	if (schema.type !== 'object') {
		return schema.type ?? 'unknown';
	}
	const pad = '  '.repeat(depth + 1);
	const lines = Object.entries(schema.properties ?? {}).map(
		([name, inner]) =>
			`${pad}${name}${schema.required?.includes(name) ? '' : '?'}: ${shape(inner, depth + 1)}`
	);
	if (typeof schema.additionalProperties === 'object') {
		lines.push(`${pad}[name: string]: ${shape(schema.additionalProperties, depth + 1)}`);
	}
	return lines.length === 0 ? '{}' : `{\n${lines.join('\n')}\n${'  '.repeat(depth)}}`;
}
