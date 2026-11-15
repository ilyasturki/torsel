import { describe, expect, it } from 'vitest';

import type { FieldSpec } from './actions.ts';
import { createBase, createTable, insertRows } from './actions.ts';
import { Hlc } from './clock.ts';
import { guessColumns, importTable, parseCsv } from './csv.ts';
import { openEngine } from './engine.ts';
import type { Change, FieldFormat, FieldType, Value } from './model.ts';
import { FIELD_TYPES } from './model.ts';
import type { Retype } from './retype.ts';
import { retypeField } from './retype.ts';
import { materializeBase, readQuery } from './sql.ts';
import {
	coerce,
	detectType,
	formatDuration,
	hrefOf,
	parseAmount,
	parseDuration,
	parseRating,
	ratingScale,
	typeOfValues
} from './values.ts';
import { Workspace } from './workspace.ts';

function setup() {
	const ws = new Workspace();
	const hlc = new Hlc('a');
	const apply = (changes: Change[]): Change[] =>
		changes.map((change) => ws.stamp(change, hlc.tick()).inverse);
	const base = createBase(ws, 'Home');
	apply(base.changes);
	return { ws, apply, baseId: base.id };
}

/** A one-field table holding `values`, retyped to `to`: what each value became and how many went. */
function retyped(from: FieldSpec, values: Value[], to: Retype) {
	const { ws, apply, baseId } = setup();
	const table = createTable(ws, baseId, 'T', [from]);
	apply(table.changes);
	const [field] = table.fieldIds;
	const rows = insertRows(
		ws,
		table.id,
		values.map((value) => ({ [field]: value }))
	);
	apply(rows.changes);
	const { changes, lost } = retypeField(ws, field, to);
	apply(changes);
	return {
		values: rows.ids.map((id) => ws.live(id)?.data[field] ?? null),
		lost,
		field: ws.field(field)
	};
}

describe('coerce', () => {
	const cases: [FieldFormat, unknown, Value][] = [
		[{ type: 'text' }, ' a ', ' a '],
		[{ type: 'longtext' }, 'one\ntwo', 'one\ntwo'],
		[{ type: 'number' }, '2,5', 2.5],
		[{ type: 'number', unit: 'kg' }, '80 kg', 80],
		[{ type: 'currency' }, '€1,234.50', 1234.5],
		[{ type: 'currency' }, '12,50 €', 12.5],
		[{ type: 'currency' }, 'USD 9', 9],
		[{ type: 'currency' }, '12', 12],
		[{ type: 'percent' }, '25%', 25],
		[{ type: 'percent' }, '12,5 %', 12.5],
		[{ type: 'percent' }, 0.5, 0.5],
		[{ type: 'rating' }, '4', 4],
		[{ type: 'rating' }, '★★★', 3],
		[{ type: 'rating' }, '6', null],
		[{ type: 'rating', min: 0, max: 10, step: 0.5 }, '7,5/10', 7.5],
		[{ type: 'rating', max: 10 }, '7.5', null],
		[{ type: 'rating', min: 0 }, 0, 0],
		[{ type: 'rating' }, 0, null],
		[{ type: 'duration' }, '1:30', 5400],
		[{ type: 'duration', seconds: true }, '1:30', 90],
		[{ type: 'duration' }, '0:25:30', 1530],
		[{ type: 'duration' }, '1h 30m', 5400],
		[{ type: 'duration' }, '1h30', 5400],
		[{ type: 'duration' }, '90s', 90],
		[{ type: 'duration' }, '45', 2700],
		[{ type: 'duration', seconds: true }, '45', 45],
		[{ type: 'duration' }, 120, 120],
		[{ type: 'duration' }, '1:75', null],
		[{ type: 'date' }, '2024-03-01T20:30', '2024-03-01'],
		[{ type: 'datetime' }, '2024-03-01T20:30', '2024-03-01T20:30'],
		[{ type: 'datetime' }, '2024-03-01', '2024-03-01'],
		[{ type: 'choice' }, ' Squat ', 'Squat'],
		[{ type: 'choices' }, 'Drama, Action; Drama', ['Drama', 'Action']],
		[{ type: 'choices' }, [' Drama ', '', 'Drama'], ['Drama']],
		[{ type: 'choices' }, ' , ', null],
		[{ type: 'check' }, 'yes', true],
		[{ type: 'url' }, 'example.com/a?b=1', 'example.com/a?b=1'],
		[{ type: 'url' }, 'https://torsel.app', 'https://torsel.app'],
		[{ type: 'url' }, 'not a link', null],
		[{ type: 'email' }, ' ana@example.com ', 'ana@example.com'],
		[{ type: 'email' }, 'ana@', null],
		[{ type: 'phone' }, '+33 6 12 34 56 78', '+33 6 12 34 56 78'],
		[{ type: 'phone' }, 'call me', null],
		[{ type: 'formula' }, 3, null]
	];

	it.each(cases)('%o reads %o as %o', (field, raw, expected) => {
		expect(coerce(field, raw)).toEqual(expected);
	});

	it('covers every type', () => {
		const covered = new Set(cases.map(([field]) => field.type));
		expect(FIELD_TYPES.filter((type) => !covered.has(type))).toEqual(['link']);
	});
});

describe('parsers', () => {
	it('writes and reads back a duration', () => {
		for (const seconds of [0, 59, 60, 90, 3599, 3600, 5430, 86400, -90]) {
			expect(parseDuration(formatDuration(seconds, true))).toBe(seconds);
		}
		for (const seconds of [0, 60, 5400, 86340, -600]) {
			expect(parseDuration(formatDuration(seconds))).toBe(seconds);
		}
		expect(formatDuration(5430, true)).toBe('1:30:30');
		expect(formatDuration(5430)).toBe('1:31');
	});

	it('keeps a rating on its scale', () => {
		expect(ratingScale({})).toEqual({ min: 1, max: 5, step: 1 });
		expect(ratingScale({ min: 0, max: 40, step: 0.5 })).toEqual({ min: 0, max: 10, step: 0.5 });
		expect(parseRating('4 / 5')).toBe(4);
		expect(parseAmount('HK$ 12')).toBe(12);
	});

	it('leads a contact somewhere', () => {
		expect(hrefOf('url', 'example.com')).toBe('https://example.com');
		expect(hrefOf('url', 'http://x.io')).toBe('http://x.io');
		expect(hrefOf('email', 'a@b.co')).toBe('mailto:a@b.co');
		expect(hrefOf('phone', '+33 (6) 12-34')).toBe('tel:+3361234');
	});
});

describe('detection', () => {
	const cases: [string[], ReturnType<typeof detectType>][] = [
		[['2024', '12,5'], { type: 'number' }],
		[['25%', '3.5 %'], { type: 'percent' }],
		[['€12', '€3.50'], { type: 'currency', currency: 'EUR' }],
		[['$12', '€3'], { type: 'currency', currency: null }],
		[['12 EUR', '4,20 EUR'], { type: 'currency', currency: 'EUR' }],
		[['1:30', '0:45'], { type: 'duration', seconds: false }],
		[['1:30:00', '0:45'], { type: 'duration', seconds: true }],
		[['2024-03-01', '2024-03-02'], { type: 'date' }],
		[['2024-03-01', '2024-03-02 20:30'], { type: 'datetime' }],
		[['true', 'no'], { type: 'check' }],
		[['ana@example.com'], { type: 'email' }],
		[['https://a.io', 'www.b.com/x'], { type: 'url' }],
		[['+33 6 12 34 56 78', '06 11 22 33 44'], { type: 'phone' }],
		[['0612'], { type: 'number' }],
		[['Squat'], null]
	];

	it.each(cases)('%o reads as %o', (texts, expected) => {
		expect(detectType(texts)).toEqual(expected);
	});

	it('types fresh values', () => {
		expect(typeOfValues([true])).toEqual({ type: 'check' });
		expect(typeOfValues([3, '4'])).toEqual({ type: 'number' });
		expect(typeOfValues(['20%'])).toEqual({ type: 'percent' });
		expect(typeOfValues(['Squat'])).toEqual({ type: 'text' });
	});

	it('guesses each column of a file', () => {
		const csv = [
			'Title,Year,Price,Share,Runtime,Seen,Genres,Site,Contact,Phone,Notes,Mood',
			'Dune,2021,€12.50,40%,2:35,2024-03-01 20:30,"Sci-fi, Drama",https://dune.film,a@b.co,+33 6 12 34 56 78,"Long\nnote",Good',
			'Heat,1995,€9,35%,2:50,2024-03-02 21:00,"Crime, Drama",https://heat.film,c@d.co,+33 6 00 00 00 00,Short,Good',
			'Up,2009,€7.99,50%,1:36,2024-03-03 18:15,"Animation, Drama, Sci-fi",https://up.film,e@f.co,06 11 22 33 44,Fun,Bad',
			'Jaws,1975,€5,20%,2:04,2024-03-04 22:00,Drama,https://jaws.film,g@h.co,+1 555 010 2030,Sharp,Good'
		].join('\n');
		const columns = guessColumns(parseCsv(csv));
		const types: [string, FieldType][] = columns.map((column) => [column.name, column.type]);
		expect(types).toEqual([
			['Title', 'text'],
			['Year', 'number'],
			['Price', 'currency'],
			['Share', 'percent'],
			['Runtime', 'duration'],
			['Seen', 'datetime'],
			['Genres', 'choices'],
			['Site', 'url'],
			['Contact', 'email'],
			['Phone', 'phone'],
			['Notes', 'longtext'],
			['Mood', 'choice']
		]);
		expect(columns[2].currency).toBe('EUR');
		expect(columns[6].choices).toEqual(['Animation', 'Crime', 'Drama', 'Sci-fi']);
	});

	it('keeps notes with a comma as text', () => {
		const csv = ['note', ...[3, 4, 5, 6, 7].map((seat) => `"seat ${seat}, low"`), '', ''].join(
			'\n'
		);
		expect(guessColumns(parseCsv(csv))[0].type).toBe('text');
	});

	it('imports each type as its stored form, and SQL reads it', async () => {
		const { ws, apply, baseId } = setup();
		const csv = [
			'Title,Price,Runtime,Genres',
			'Dune,€12.50,2:35,"Sci-fi, Drama"',
			'Heat,€9,2:50,"Crime, Drama"',
			'Arrival,€8,1:56,"Drama, Sci-fi"'
		].join('\n');
		const made = importTable(ws, baseId, 'Movies', parseCsv(csv));
		apply(made.changes);
		const fields = ws.fields(made.id);
		const [price, runtime, genres] = fields.slice(1).map((field) => field.id);
		const dune = ws.rows(made.id)[0];
		expect([dune.data[price], dune.data[runtime], dune.data[genres]]).toEqual([
			12.5,
			9300,
			['Sci-fi', 'Drama']
		]);

		const engine = await openEngine();
		materializeBase(engine, ws, baseId, true);
		expect(
			readQuery(engine, 'select "Price" * 2 as p, "Runtime" / 60 as m from "Movies" order by p').rows
		).toEqual([
			{ p: 16, m: 116 },
			{ p: 18, m: 170 },
			{ p: 25, m: 155 }
		]);
		expect(
			readQuery(
				engine,
				`select count(*) as n from "Movies", json_each("Movies"."Genres") where json_each.value = 'Drama'`
			).rows
		).toEqual([{ n: 3 }]);
	});
});

describe('retype', () => {
	it('carries numbers between number types, a duration in its smallest unit', () => {
		expect(retyped({ name: 'N', type: 'number' }, [12.5, 4], { type: 'currency' }).values).toEqual([
			12.5, 4
		]);
		expect(retyped({ name: 'N', type: 'number' }, [25], { type: 'percent' }).values).toEqual([25]);
		expect(retyped({ name: 'P', type: 'percent' }, [25], { type: 'number' }).values).toEqual([25]);
		expect(retyped({ name: 'N', type: 'number' }, [90], { type: 'duration' }).values).toEqual([
			5400
		]);
		expect(
			retyped({ name: 'N', type: 'number' }, [90], { type: 'duration', seconds: true }).values
		).toEqual([90]);
		expect(retyped({ name: 'D', type: 'duration' }, [5400], { type: 'number' }).values).toEqual([
			90
		]);
		expect(
			retyped({ name: 'D', type: 'duration' }, [5400], { type: 'duration', seconds: true }).values
		).toEqual([5400]);
	});

	it('clears a rating off its scale and counts it', () => {
		const result = retyped({ name: 'Score', type: 'number' }, [7.5, 8, 12], {
			type: 'rating',
			min: 0,
			max: 10,
			step: 0.5
		});
		expect(result.values).toEqual([7.5, 8, null]);
		expect(result.lost).toBe(1);
		expect(result.field?.max).toBe(10);
		const back = retyped({ name: 'Score', type: 'rating', max: 10 }, [7, 8], { type: 'number' });
		expect(back.values).toEqual([7, 8]);
		expect(back.field?.max).toBeNull();
	});

	it('reads text into each type, and each type back as text', () => {
		const texts = ['Drama, Action', 'ana@example.com', 'not a mail'];
		const choices = retyped({ name: 'T', type: 'text' }, texts.slice(0, 1), { type: 'choices' });
		expect(choices.values).toEqual([['Drama', 'Action']]);
		expect(choices.field?.choices.map((choice) => choice.name)).toEqual(['Drama', 'Action']);
		const mail = retyped({ name: 'T', type: 'text' }, texts.slice(1), { type: 'email' });
		expect(mail).toMatchObject({ values: ['ana@example.com', null], lost: 1 });

		const back: [FieldSpec, Value, string][] = [
			[{ name: 'C', type: 'choices' }, ['Drama', 'Action'], 'Drama, Action'],
			[{ name: 'P', type: 'percent' }, 25, '25%'],
			[{ name: 'D', type: 'duration' }, 5400, '1:30'],
			[{ name: 'D', type: 'duration' }, 5430, '1:30:30'],
			[{ name: 'M', type: 'currency' }, 12.5, '12.5'],
			[{ name: 'L', type: 'longtext' }, 'a\nb', 'a\nb'],
			[{ name: 'U', type: 'url' }, 'a.io', 'a.io']
		];
		for (const [from, value, text] of back) {
			expect(retyped(from, [value], { type: 'text' }).values).toEqual([text]);
		}
	});

	it('round-trips every pair it can, both ways', () => {
		const samples: [FieldSpec, Value][] = [
			[{ name: 'number', type: 'number' }, 9],
			[{ name: 'currency', type: 'currency' }, 9],
			[{ name: 'percent', type: 'percent' }, 9],
			[{ name: 'duration', type: 'duration' }, 540],
			[{ name: 'rating', type: 'rating', max: 10 }, 9]
		];
		for (const [from, value] of samples) {
			for (const [to] of samples) {
				const there = retyped(from, [value], to);
				expect(there.lost).toBe(0);
				expect(retyped(to, there.values, from).values).toEqual([value]);
			}
		}
	});

	it('moves between one and several choices, and between a day and a time', () => {
		expect(retyped({ name: 'C', type: 'choice' }, ['Drama'], { type: 'choices' }).values).toEqual([
			['Drama']
		]);
		expect(
			retyped({ name: 'C', type: 'choices' }, [['Drama', 'Action']], { type: 'choice' }).values
		).toEqual(['Drama, Action']);
		expect(
			retyped({ name: 'D', type: 'date' }, ['2024-03-01'], { type: 'datetime' }).values
		).toEqual(['2024-03-01']);
		expect(
			retyped({ name: 'D', type: 'datetime' }, ['2024-03-01T20:30'], { type: 'date' }).values
		).toEqual(['2024-03-01']);
	});
});
