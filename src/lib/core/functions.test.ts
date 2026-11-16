import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import names from '#lib/i18n/names.ts';

import { SqlPool } from '../server/sql/pool.ts';
import { createBase, createTable, defaultViews } from './actions.ts';
import { Hlc } from './clock.ts';
import { openEngine } from './engine.ts';
import { AGGREGATE_NAMES, FUNCTIONS, meets } from './functions.ts';
import type { Change, Rec } from './model.ts';
import type { SqlValue } from './sql.ts';
import { Workspace } from './workspace.ts';

type Case = [sql: string, expected: SqlValue];

const pad = (n: number): string => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const SCALARS: Record<string, Case[]> = {
	IF: [["IF(1 > 0, 'yes', 'no')", 'yes']],
	IFS: [
		["IFS(0, 'a', 1, 'b')", 'b'],
		["IFS(0, 'a', 0, 'b')", null],
		["IFS('2', 'text two counts')", 'text two counts']
	],
	IFERROR: [
		["IFERROR(1 / 0, 'none')", 'none'],
		['IFERROR(5, 0)', 5],
		['IFERROR(NULL)', null]
	],
	SWITCH: [
		["SWITCH('b', 'a', 1, 'b', 2)", 2],
		["SWITCH('z', 'a', 1, 'other')", 'other'],
		["SWITCH(2, '2', 'number as text')", 'number as text'],
		["SWITCH('z', 'a', 1)", null]
	],
	ISBLANK: [
		['ISBLANK(NULL)', 1],
		["ISBLANK('')", 1],
		['ISBLANK(0)', 0]
	],
	ISNUMBER: [
		['ISNUMBER(2.5)', 1],
		["ISNUMBER('2.5')", 0],
		['ISNUMBER(NULL)', 0]
	],
	ISTEXT: [
		["ISTEXT('a')", 1],
		['ISTEXT(1)', 0]
	],
	INT: [
		['INT(2.7)', 2],
		['INT(-2.1)', -3],
		["INT('3.9')", 3],
		['INT(NULL)', 0]
	],
	ROUNDUP: [
		['ROUNDUP(2.1)', 3],
		['ROUNDUP(-2.1)', -3],
		['ROUNDUP(1.231, 2)', 1.24],
		['ROUNDUP(1234, -2)', 1300]
	],
	ROUNDDOWN: [
		['ROUNDDOWN(2.9)', 2],
		['ROUNDDOWN(-2.9)', -2],
		['ROUNDDOWN(1.239, 2)', 1.23],
		['ROUNDDOWN(1.005, 2)', 1]
	],
	RANDBETWEEN: [
		['RANDBETWEEN(4, 4)', 4],
		['RANDBETWEEN(5, 4)', null]
	],
	LEFT: [
		["LEFT('Bench press', 5)", 'Bench'],
		["LEFT('Bench')", 'B'],
		['LEFT(1234, 2)', '12'],
		['LEFT(NULL, 2)', ''],
		["LEFT('abc', -1)", null],
		["LEFT('😀ab', 1)", '😀']
	],
	RIGHT: [
		["RIGHT('Bench press', 5)", 'press'],
		["RIGHT('abc')", 'c'],
		["RIGHT('abc', 0)", ''],
		["RIGHT('abc', 9)", 'abc']
	],
	MID: [
		["MID('Bench press', 7, 3)", 'pre'],
		["MID('abc', 0, 1)", null],
		["MID('abc', 5, 1)", '']
	],
	LEN: [
		["LEN('Squat')", 5],
		['LEN(NULL)', 0],
		['LEN(12.5)', 4],
		["LEN('é😀')", 2]
	],
	CONCATENATE: [
		["CONCATENATE('a', 1, NULL, 'b')", 'a1b'],
		["CONCATENATE(REPT('a', 600000), REPT('b', 600000))", null],
		["CONCATENATE('only')", 'only']
	],
	TEXTJOIN: [
		["TEXTJOIN(', ', 1, 'a', '', NULL, 'b')", 'a, b'],
		["TEXTJOIN('-', 0, 'a', '', 'b')", 'a--b']
	],
	PROPER: [
		["PROPER('bench PRESS')", 'Bench Press'],
		["PROPER('o''neil-smith')", "O'Neil-Smith"],
		["PROPER('élan vital')", 'Élan Vital']
	],
	SUBSTITUTE: [
		["SUBSTITUTE('a-b-c', '-', '+')", 'a+b+c'],
		["SUBSTITUTE('a-b-c', '-', '+', 2)", 'a-b+c'],
		["SUBSTITUTE('a-b-c', '-', '+', 5)", 'a-b-c'],
		["SUBSTITUTE('abc', '', 'x')", 'abc']
	],
	FIND: [
		["FIND('b', 'abcb')", 2],
		["FIND('b', 'abcb', 3)", 4],
		["FIND('B', 'abc')", null]
	],
	SEARCH: [
		["SEARCH('B', 'abc')", 2],
		["SEARCH('z', 'abc')", null]
	],
	REPT: [
		["REPT('ab', 3)", 'ababab'],
		["REPT('a', 0)", ''],
		["REPT('ab', 999999999)", null]
	],
	VALUE: [
		["VALUE(' 12.5 ')", 12.5],
		["VALUE('twelve')", null],
		['VALUE(3)', 3]
	],
	EXACT: [
		["EXACT('a', 'a')", 1],
		["EXACT('a', 'A')", 0],
		["EXACT(1, '1')", 1]
	],
	REGEXMATCH: [
		["REGEXMATCH('PR 120kg', '\\d+kg')", 1],
		["REGEXMATCH('abc', '^b')", 0],
		["REGEXMATCH('abc', '(')", null]
	],
	REGEXEXTRACT: [
		["REGEXEXTRACT('PR 120kg', '(\\d+)kg')", '120'],
		["REGEXEXTRACT('PR 120kg', '\\d+')", '120'],
		["REGEXEXTRACT('abc', '\\d')", null]
	],
	REGEXREPLACE: [
		["REGEXREPLACE('a1b22', '\\d+', '#')", 'a#b#'],
		["REGEXREPLACE('2026-11-16', '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1')", '16/11/2026']
	],
	TODAY: [['TODAY()', today]],
	YEAR: [
		["YEAR('2026-11-16')", 2026],
		["YEAR('not a date')", null],
		["YEAR('2026-02-30')", null]
	],
	MONTH: [
		["MONTH('2026-11-16T08:30')", 11],
		['MONTH(NULL)', null]
	],
	DAY: [["DAY('2026-11-16')", 16]],
	HOUR: [
		["HOUR('2026-11-16T08:30')", 8],
		["HOUR('2026-11-16')", 0]
	],
	MINUTE: [["MINUTE('2026-11-16 08:30:15')", 30]],
	WEEKDAY: [
		["WEEKDAY('2026-11-16')", 2],
		["WEEKDAY('2026-11-15', 2)", 7],
		["WEEKDAY('2026-11-16', 3)", 0],
		["WEEKDAY('2026-11-16', 9)", null]
	],
	WEEKNUM: [
		["WEEKNUM('2026-01-01')", 1],
		["WEEKNUM('2026-01-04')", 2],
		["WEEKNUM('2026-01-04', 2)", 1],
		["WEEKNUM('2026-12-31')", 53]
	],
	ISOWEEKNUM: [
		["ISOWEEKNUM('2026-01-01')", 1],
		["ISOWEEKNUM('2027-01-01')", 53],
		["ISOWEEKNUM('2026-11-16')", 47]
	],
	DAYS: [
		["DAYS('2026-11-16', '2026-11-01')", 15],
		["DAYS('2026-11-01T23:00', '2026-11-16')", -15]
	],
	DATEDIF: [
		["DATEDIF('2024-02-29', '2026-11-16', 'Y')", 2],
		["DATEDIF('2024-02-29', '2026-11-16', 'M')", 32],
		["DATEDIF('2026-01-31', '2026-03-01', 'D')", 29],
		["DATEDIF('2026-01-31', '2026-03-01', 'MD')", 1],
		["DATEDIF('2025-12-20', '2026-11-16', 'YM')", 10],
		["DATEDIF('2025-12-20', '2026-11-16', 'YD')", 331],
		["DATEDIF('2026-11-16', '2026-11-01', 'D')", null],
		["DATEDIF('2026-11-01', '2026-11-16', 'Q')", null]
	],
	EDATE: [
		["EDATE('2026-01-31', 1)", '2026-02-28'],
		["EDATE('2026-03-15', -3)", '2025-12-15']
	],
	EOMONTH: [
		["EOMONTH('2024-02-10', 0)", '2024-02-29'],
		["EOMONTH('2026-11-16', -11)", '2025-12-31']
	],
	NETWORKDAYS: [
		["NETWORKDAYS('2026-11-16', '2026-11-22')", 5],
		["NETWORKDAYS('2026-11-14', '2026-11-15')", 0],
		["NETWORKDAYS('2026-11-30', '2026-11-16')", -11],
		["NETWORKDAYS('2026-01-01', '2026-12-31')", 261]
	]
};

const ROWS = "(values (1, 'Food'), (5, 'Rent'), (NULL, 'food'), (12, 'Fuel'), ('x', ''))";

const AGGREGATES: Record<string, Case[]> = {
	AVERAGE: [
		[`select AVERAGE(column1) from ${ROWS}`, 6],
		['select AVERAGE(column1) from (select 1 as column1 where 0)', null],
		['AVERAGE(2, 4)', 3]
	],
	COUNTA: [[`select COUNTA(column2) from ${ROWS}`, 4]],
	COUNTUNIQUE: [[`select COUNTUNIQUE(column2) from ${ROWS}`, 4]],
	COUNTIF: [
		[`select COUNTIF(column2, 'food') from ${ROWS}`, 2],
		[`select COUNTIF(column2, 'F*') from ${ROWS}`, 3],
		[`select COUNTIF(column1, '>=5') from ${ROWS}`, 2],
		[`select COUNTIF(column2, '<>') from ${ROWS}`, 4],
		[`select COUNTIF(column2, '') from ${ROWS}`, 1]
	],
	SUMIF: [
		[`select SUMIF(column1, '>1') from ${ROWS}`, 17],
		[`select SUMIF(column2, 'F*', column1) from ${ROWS}`, 13]
	],
	AVERAGEIF: [[`select AVERAGEIF(column2, '<>Rent', column1) from ${ROWS}`, 6.5]]
};

function statement(sql: string): string {
	return sql.startsWith('select ') ? sql : `select ${sql}`;
}

function workspace(): { records: Rec[]; base: string } {
	const ws = new Workspace();
	const hlc = new Hlc('test');
	const apply = ({ changes }: { changes: Change[] }): void => {
		for (const change of changes) ws.stamp(change, hlc.tick());
	};
	const made = createBase(ws, 'Base');
	apply(made);
	apply(
		createTable(ws, made.id, 'Table', [{ name: 'Name', type: 'text' }], () =>
			defaultViews(names.en)
		)
	);
	return { records: [...ws.records.values()], base: made.id };
}

const pool = new SqlPool(1);
afterAll(() => pool.close());

type Side = { name: string; value(sql: string): Promise<SqlValue> };

const sides: Side[] = [
	{
		name: 'client',
		async value(sql) {
			const engine = await openEngine();
			try {
				return Object.values(engine.all(statement(sql))[0])[0];
			} finally {
				engine.close();
			}
		}
	},
	{
		name: 'server',
		async value(sql) {
			const { records, base } = workspace();
			const page = await pool.run(records, base, { kind: 'query', sql: statement(sql), offset: 0 });
			return page.rows[0][0];
		}
	}
];

describe.each(sides)('Sheets functions on the $name', (side) => {
	for (const [name, cases] of Object.entries({ ...SCALARS, ...AGGREGATES })) {
		it.each(cases)(`${name}: %s`, async (sql, expected) => {
			const value = await side.value(sql);
			if (typeof expected === 'number') expect(value).toBeCloseTo(expected, 10);
			else expect(value).toBe(expected);
		});
	}

	it('NOW: the date and minute', async () => {
		const value = await side.value('NOW()');
		expect(value).toMatch(new RegExp(`^${today}T\\d{2}:\\d{2}$`, 'u'));
	});

	it('RAND: a number from 0 up to 1, new on every row', async () => {
		const value = await side.value(
			'select count(distinct RAND()) from (values (1), (2), (3), (4))'
		);
		expect(value).toBe(4);
	});

	it('AVERAGE and COUNTIF run as window functions', async () => {
		const value = await side.value(
			`select group_concat(a, ' ') from (select AVERAGE(column1) over (rows 1 preceding) || '/' || COUNTIF(column2, 'F*') over () as a from (values (1, 'Food'), (3, 'Fuel'), (8, 'Rent')))`
		);
		expect(value).toBe('1/2 2/2 5.5/2');
	});
});

describe('the function list', () => {
	let builtIn: Set<string>;

	beforeAll(async () => {
		const { default: init } = await import('@sqlite.org/sqlite-wasm');
		const sqlite3 = await init();
		const db = new sqlite3.oo1.DB(':memory:');
		const rows = db.exec({
			sql: 'select name from pragma_function_list',
			rowMode: 'array',
			returnValue: 'resultRows'
		}) as string[][];
		builtIn = new Set(rows.map(([name]) => name.toUpperCase()));
		db.close();
	});

	it('shadows no function SQLite already has', () => {
		const ours = [...Object.keys(SCALARS), ...Object.keys(AGGREGATES)].filter(
			(name) => !['IF'].includes(name)
		);
		expect(ours.filter((name) => builtIn.has(name))).toEqual([]);
	});

	it('lists every function it tests, and tests every function it adds', () => {
		const listed = FUNCTIONS.map((fn) => fn.name);
		for (const name of [...Object.keys(SCALARS), ...Object.keys(AGGREGATES), 'NOW', 'RAND']) {
			expect(listed).toContain(name);
		}
		const added = listed.filter((name) => !builtIn.has(name));
		const tested = new Set([...Object.keys(SCALARS), ...Object.keys(AGGREGATES), 'NOW', 'RAND']);
		expect(added.filter((name) => !tested.has(name))).toEqual([]);
	});

	it('names every aggregate a rollup may use', () => {
		for (const name of Object.keys(AGGREGATES)) expect(AGGREGATE_NAMES.has(name)).toBe(true);
	});
});

describe('Sheets criteria', () => {
	it.each([
		[5, 5, true],
		['5', 5, true],
		[5, '>4', true],
		[5, '<=4', false],
		[null, '<>', false],
		['', '=', true],
		['Food', 'f?od', true],
		['F*', '~F~*', true],
		['Fuel', '~F~*', false],
		['b', '>a', true],
		['abc', '<>abc', false],
		['x', '>=1', false],
		['x', '<>1', true]
	] as const)('%j meets %j: %s', (value, criterion, expected) => {
		expect(meets(value, criterion)).toBe(expected);
	});
});
