import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { PRESETS, presetSource } from '../../core/presets.ts';
import type { PresetSource } from '../../core/presets.ts';
import { EVERY, MISSING } from '../../core/source.ts';
import { DATE_STYLES, FIELD_TYPES, RESULT_TYPES } from '../../core/model.ts';
import { sources as words } from '../../i18n/sources.ts';
import { errors } from '../../i18n/errors.ts';
import { sourceLimits } from '../config.ts';
import { AUTH_KINDS, PullFailed } from './fetch.ts';
import { SourceRefused } from './connect.ts';
import type { Limited } from './limits.ts';
import { overLimit } from './limits.ts';
import type { SourceProblem } from './run.ts';

export function limit(kind: Limited, userId: string): void {
	if (overLimit(kind, userId)) error(429, errors.tooMany);
}

export function problemText(problem: SourceProblem | SourceRefused['reason']): string {
	const text = words.problems;
	if (problem === 'cap') return text.cap(sourceLimits().rows);
	if (problem === 'count') return text.count(sourceLimits().sources);
	return text[problem];
}

const STATUS: Record<SourceRefused['reason'], number> = {
	url: 400,
	columns: 400,
	auth: 400,
	base: 404,
	gone: 404,
	key: 400,
	count: 409
};

/** What failed, said to the person; a failure upstream is theirs to fix, never a server error. */
export function failure(thrown: unknown): Response {
	if (thrown instanceof PullFailed) {
		return json({ problem: thrown.problem, message: problemText(thrown.problem) }, { status: 422 });
	}
	if (thrown instanceof SourceRefused) {
		return json(
			{ problem: thrown.reason, message: problemText(thrown.reason) },
			{ status: STATUS[thrown.reason] }
		);
	}
	throw thrown;
}

const AUTH = z
	.strictObject({ kind: z.enum(AUTH_KINDS), name: z.string().max(100).nullish() })
	.transform(({ kind, name }) => ({ kind, name: name ?? null }));

const NONE = { kind: 'none' as const, name: null };

const COLUMN = z.strictObject({
	path: z.string().min(1).max(500),
	name: z.string().max(200),
	type: z.enum(FIELD_TYPES),
	choices: z.array(z.string().max(200)).max(500).optional(),
	step: z.number().nullish(),
	decimals: z.number().int().min(0).max(10).nullish(),
	grouping: z.boolean().optional(),
	unit: z.string().max(20).nullish(),
	currency: z.string().max(10).nullish(),
	min: z.number().nullish(),
	max: z.number().nullish(),
	seconds: z.boolean().optional(),
	dateStyle: z.enum(DATE_STYLES).nullish(),
	result: z.enum(RESULT_TYPES).nullish()
});

const PREVIEW = z.strictObject({
	url: z.string().max(4000).optional(),
	preset: z.enum(PRESETS).optional(),
	value: z.string().max(4000).optional(),
	auth: AUTH.optional(),
	secret: z.string().max(4000).nullish(),
	rows: z.string().max(500).nullish()
});

const CREATE = z.strictObject({
	base: z.string().max(40).nullish(),
	name: z.string().max(200).nullish(),
	label: z.string().max(100).nullish(),
	url: z.string().min(1).max(4000),
	auth: AUTH.optional(),
	secret: z.string().max(4000).nullish(),
	rows: z.string().max(500).nullish(),
	key: z.string().max(500).nullish(),
	filter: z.string().max(500).nullish(),
	every: z.enum(EVERY),
	missing: z.enum(MISSING),
	columns: z.array(COLUMN).min(1).max(100)
});

const PATCH = z.strictObject({
	every: z.enum(EVERY).optional(),
	missing: z.enum(MISSING).optional(),
	secret: z.string().min(1).max(4000).optional()
});

function parsed<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
	const result = schema.safeParse(body);
	if (!result.success) error(400, result.error.issues[0]?.message ?? 'invalid body');
	return result.data;
}

export type PreviewBody = {
	url: string;
	auth: { kind: (typeof AUTH_KINDS)[number]; name: string | null };
	secret: string | null;
	rows: string | null;
	preset: PresetSource | null;
};

/** A link, or a preset and the one thing it asks for. */
export function previewBody(body: unknown): PreviewBody {
	const input = parsed(PREVIEW, body);
	const preset =
		input.preset === undefined ? null : presetSource(input.preset, input.value ?? '', words);
	if (input.preset !== undefined && preset === null) throw new SourceRefused('url');
	const url = preset?.url ?? input.url;
	if (url === undefined) throw new SourceRefused('url');
	const secret = input.secret ?? null;
	const auth =
		input.auth ??
		(preset?.bearer === true && secret !== null && secret !== ''
			? { kind: 'bearer' as const, name: null }
			: NONE);
	return { url, auth, secret, rows: input.rows ?? null, preset };
}

export function createBody(body: unknown) {
	const input = parsed(CREATE, body);
	return {
		base: input.base ?? null,
		name: input.name ?? null,
		label: input.label ?? null,
		url: input.url,
		auth: input.auth ?? NONE,
		secret: input.secret ?? null,
		rows: input.rows ?? null,
		key: input.key ?? null,
		filter: input.filter ?? null,
		every: input.every,
		missing: input.missing,
		columns: input.columns
	};
}

export function patchBody(body: unknown) {
	return parsed(PATCH, body);
}
