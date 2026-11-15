import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Gym } from './tools.fixture.test.ts';
import { gym } from './tools.fixture.test.ts';
import { TOOLS } from './toolkit.ts';

type Schema = {
	type?: string | string[];
	anyOf?: Schema[];
	enum?: unknown[];
	const?: unknown;
	properties?: Record<string, Schema>;
	required?: string[];
	additionalProperties?: Schema | boolean;
	items?: Schema;
	minItems?: number;
	maxItems?: number;
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: number;
	pattern?: string;
};

// A fixed seed: the same inputs on every run, so a failure reproduces.
function random(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

const SHEETS = {
	f_csv: {
		kind: 'table' as const,
		name: 'Log.csv',
		rows: [
			['When', 'Kg'],
			['2026-11-15', '81,4']
		]
	}
};

const SQL = [
	'select * from "Sets"',
	'select "Exercise", max("Weight") from "Sets" group by 1',
	"select 'a;b' as x",
	'select',
	'drop table "Sets"',
	'with recursive c(x) as (select 1 union all select x + 1 from c where x < 900) select x from c',
	'select * from "Nope"'
];

const CELLS = [
	'80',
	'2026-11-15',
	'2026-11-15T07:30',
	'Bench',
	'Left',
	'yes',
	'last tuesday',
	'',
	'1:30:00',
	'12,5',
	'1 234',
	'€ 12',
	'25%',
	'Ünïcödé 🏋️'
];

function pools(g: Gym): Record<string, unknown[]> {
	const ids = [g.row, g.row, g.bench, g.sets, g.exercises, g.grid, g.weight, g.base, 'r_nope'];
	const names = ['Gym', 'Sets', 'Exercises', 'Weight', 'Reps', 'Date', 'Grid', 'Entry', 'Nope'];
	return {
		base: ['Gym', 'Gym', 'Gym', ' gym ', g.base, 'Nope'],
		table: ['Sets', 'Sets', 'Exercises', g.sets, 'Nope'],
		field: ['Weight', 'Reps', 'Date', 'Exercise', 'Side', 'Done', 'Note', g.weight, 'Nope'],
		view: ['Grid', 'Entry', g.grid, 'Nope'],
		rows: [g.row],
		target: ['Exercises', 'Sets', 'Nope'],
		file: ['f_csv', 'f_none'],
		id: ids,
		ids,
		sql: SQL,
		formula: ['"Weight" * 2', 'nope(', '"Reps" + 1', '1 / 0', '"Volume"'],
		currency: ['EUR', 'EUR', 'usd'],
		keys: ['Weight', 'Reps', 'Date', 'Exercise', 'Side', 'Done', 'Note', 'Weight', 'Nope'],
		strings: [...names, ...CELLS, 'x'.repeat(300)]
	};
}

function pick<T>(next: () => number, items: readonly T[]): T {
	return items[Math.floor(next() * items.length)];
}

function generate(
	schema: Schema,
	key: string,
	next: () => number,
	pool: Record<string, unknown[]>
): unknown {
	if (schema.anyOf !== undefined) return generate(pick(next, schema.anyOf), key, next, pool);
	if (schema.enum !== undefined) return pick(next, schema.enum);
	if (schema.const !== undefined) return schema.const;
	const type = Array.isArray(schema.type) ? pick(next, schema.type) : schema.type;

	switch (type) {
		case 'object': {
			const out: Record<string, unknown> = {};
			for (const [name, property] of Object.entries(schema.properties ?? {})) {
				if (schema.required?.includes(name) || next() < 0.25) {
					out[name] = generate(property, name, next, pool);
				}
			}
			if (typeof schema.additionalProperties === 'object') {
				for (let count = Math.floor(next() * 4); count > 0; count -= 1) {
					out[String(pick(next, pool.keys))] = generate(
						schema.additionalProperties,
						'cell',
						next,
						pool
					);
				}
			}
			return out;
		}
		case 'array': {
			const least = schema.minItems ?? 0;
			const length = Math.min(schema.maxItems ?? least + 3, least + Math.floor(next() * 4));
			const item = schema.items ?? {};
			return Array.from({ length }, () => generate(item, key === 'ids' ? 'id' : key, next, pool));
		}
		case 'string':
			return key === 'cell' ? pick(next, CELLS) : pick(next, pool[key] ?? pool.strings);
		case 'number':
		case 'integer': {
			const low = schema.minimum ?? schema.exclusiveMinimum ?? -5;
			const high = schema.maximum ?? 1000;
			const value =
				next() < 0.7
					? low + next() * (Math.min(high, low + 100) - low)
					: pick(next, [low, high, 0, 1, 2.5, -1, 1e12]);
			return type === 'integer' ? Math.round(value) : value;
		}
		case 'boolean':
			return next() < 0.5;
		case 'null':
			return null;
		default:
			return pick(next, [null, 1, 'x', [], {}]);
	}
}

/** Breaks a valid-looking input the ways a client can: a key dropped, unknown or of the wrong type. */
function mutate(input: Record<string, unknown>, next: () => number): Record<string, unknown> {
	const out = { ...input };
	const keys = Object.keys(out);
	const roll = next();
	if (roll < 0.3 && keys.length > 0) {
		delete out[pick(next, keys)];
	} else if (roll < 0.5) {
		out[pick(next, ['sorts', 'Base', 'limit', '__proto__x'])] = 1;
	} else if (keys.length > 0) {
		out[pick(next, keys)] = pick(next, [null, 42, 'x', [], {}, true, [[1]], { a: { b: 1 } }]);
	}
	return out;
}

const RUNS = 40;

describe('fuzzed tool input', () => {
	it.each(TOOLS.map((tool) => [tool.name, tool] as const))(
		'%s answers every input in its own shapes',
		async (_, tool) => {
			const schema = z.toJSONSchema(tool.input) as Schema;
			const next = random([...tool.name].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7));
			let g = await gym(SHEETS);

			for (let run = 0; run < RUNS; run += 1) {
				if (run % 10 === 0) g = await gym(SHEETS);
				const shaped = generate(schema, '', next, pools(g)) as Record<string, unknown>;
				const input = next() < 0.25 ? mutate(shaped, next) : shaped;

				const outcome = await g.outcome(tool.name, input);

				const seen = `${tool.name} ${JSON.stringify(input)}`;
				if (outcome.ok) {
					expect(tool.output.safeParse(outcome.result).error, seen).toBeUndefined();
				} else {
					expect(outcome.error, seen).toMatch(/\S/u);
					expect(outcome.error, seen).not.toMatch(/failed on the server/u);
				}
			}
		}
	);

	it('never stores a given value as empty', async () => {
		const next = random(2026);
		const g = await gym();
		const schema = z.toJSONSchema(
			TOOLS.find((tool) => tool.name === 'add_rows')?.input ?? z.object({})
		) as Schema;
		const pool = pools(g);
		const cell = (schema.properties?.rows?.items?.additionalProperties ?? {}) as Schema;

		for (let run = 0; run < 200; run += 1) {
			const name = pick(next, ['Weight', 'Reps', 'Date', 'Side', 'Done', 'Note', 'Exercise']);
			const value = generate(cell, 'cell', next, pool);
			const outcome = await g.outcome('add_rows', {
				base: 'Gym',
				table: 'Sets',
				rows: [{ [name]: value }]
			});
			if (
				!outcome.ok ||
				value === null ||
				value === '' ||
				(Array.isArray(value) && value.length === 0)
			) {
				continue;
			}
			const [id] = outcome.result.added as string[];
			const field = g.ctx.ws.fields(g.sets).find((candidate) => candidate.name === name);
			expect(
				g.ctx.ws.live(id)?.data[field?.id ?? ''],
				`${name} ${JSON.stringify(value)}`
			).not.toBeNull();
		}
	});
});
