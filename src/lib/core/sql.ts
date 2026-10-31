import { FormulaError, toSql } from './formula.ts';
import type { FieldDef, Rec, Value } from './model.ts';
import { CREATED } from './model.ts';
import type { Workspace } from './workspace.ts';

export type SqlValue = string | number | null;

export type SqlRow = Record<string, SqlValue>;

export interface Engine {
	exec(sql: string, bind?: SqlValue[]): void;
	all(sql: string, bind?: SqlValue[]): SqlRow[];
}

export function quote(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

function affinity(field: FieldDef): string {
	if (field.type === 'number') {
		return 'REAL';
	}
	return field.type === 'check' ? 'INTEGER' : 'TEXT';
}

export function storageValue(field: FieldDef, value: Value | undefined): SqlValue {
	if (value === undefined || value === null) {
		return null;
	}
	if (field.type === 'check') {
		return value === true ? 1 : 0;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'string') {
		return value;
	}
	return typeof value === 'boolean' ? (value ? 1 : 0) : JSON.stringify(value);
}

function stored(fields: FieldDef[]): FieldDef[] {
	return fields.filter((field) => field.type !== 'formula');
}

/** Each formula of a table as SQL over its columns, formulas referring to formulas inlined. */
export function formulaColumns(ws: Workspace, tableId: string): Map<string, string> {
	const fields = ws.fields(tableId);
	const byId = new Map(fields.map((field) => [field.id, field]));
	const done = new Map<string, string>();
	const visiting = new Set<string>();

	function expand(field: FieldDef): string {
		const known = done.get(field.id);
		if (known !== undefined) {
			return known;
		}
		if (visiting.has(field.id)) {
			throw new FormulaError(`"${field.name}" depends on itself`);
		}

		visiting.add(field.id);
		const sql = toSql(field.expr ?? 'NULL', (id) => {
			const ref = byId.get(id);
			if (ref === undefined) {
				return 'NULL';
			}
			return ref.type === 'formula' ? `(${expand(ref)})` : `t.${ref.id}`;
		});
		visiting.delete(field.id);

		done.set(field.id, sql);
		return sql;
	}

	const out = new Map<string, string>();
	for (const field of fields) {
		if (field.type === 'formula') {
			try {
				out.set(field.id, expand(field));
			} catch {
				out.set(field.id, 'NULL');
			}
		}
	}

	return out;
}

export function insertRowsSql(
	engine: Engine,
	tableId: string,
	fields: FieldDef[],
	rows: Rec[]
): void {
	if (rows.length === 0) {
		return;
	}

	const columns = ['id', CREATED, ...stored(fields).map((field) => field.id)];
	const sql = `insert or replace into ${tableId} (${columns.map(quote).join(', ')}) values (${columns.map(() => '?').join(', ')})`;

	for (const row of rows) {
		const at = row.data[CREATED];
		engine.exec(sql, [
			row.id,
			typeof at === 'number' ? at : 0,
			...stored(fields).map((field) => storageValue(field, row.data[field.id]))
		]);
	}
}

export type FormulaProblems = Map<string, string>;

function viewSql(tableId: string, formulas: Map<string, string>): string {
	const computed = [...formulas].map(([id, sql]) => `(${sql}) as ${id}`);
	return `create view v_${tableId} as select ${['t.*', ...computed].join(', ')} from ${tableId} t`;
}

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^.*?SQLITE_\w+: sqlite3 result code \d+: /u, '');
}

/** Rebuilds one table and its `v_` view; a formula SQLite refuses evaluates to NULL. */
export function materializeTable(engine: Engine, ws: Workspace, tableId: string): FormulaProblems {
	const fields = ws.fields(tableId);
	const problems: FormulaProblems = new Map();

	engine.exec(`drop view if exists v_${tableId}`);
	engine.exec(`drop table if exists ${tableId}`);

	const columns = stored(fields).map((field) => `${field.id} ${affinity(field)}`);
	engine.exec(
		`create table ${tableId} (id TEXT PRIMARY KEY, ${quote(CREATED)} REAL${columns.map((column) => `, ${column}`).join('')})`
	);

	engine.exec('begin');
	try {
		insertRowsSql(engine, tableId, fields, ws.rows(tableId));
		engine.exec('commit');
	} catch (error) {
		engine.exec('rollback');
		throw error;
	}

	const formulas = formulaColumns(ws, tableId);

	try {
		engine.exec(viewSql(tableId, formulas));
	} catch {
		for (const [id, sql] of formulas) {
			try {
				engine.exec(`select (${sql}) from ${tableId} t limit 0`);
			} catch (error) {
				problems.set(id, errorText(error));
				formulas.set(id, 'NULL');
			}
		}
		engine.exec(viewSql(tableId, formulas));
	}

	return problems;
}

function formulaSql(ws: Workspace, tableId: string, stored: string): string {
	const formulas = formulaColumns(ws, tableId);
	return toSql(stored, (id) => {
		const field = ws.field(id);
		return field?.type === 'formula' ? `(${formulas.get(id) ?? 'NULL'})` : `t.${id}`;
	});
}

/** What a formula not yet on the table would give each row; empty if SQLite refuses it. */
export function formulaValues(
	engine: Engine,
	ws: Workspace,
	tableId: string,
	stored: string
): Map<string, SqlValue> {
	try {
		const sql = formulaSql(ws, tableId, stored);
		const rows = engine.all(`select t.id as id, (${sql}) as v from ${tableId} t`);
		return new Map(rows.map((row) => [String(row.id), row.v]));
	} catch {
		return new Map();
	}
}

/** Why SQLite refuses a stored formula on this table, or null; the table must be materialized. */
export function formulaProblem(
	engine: Engine,
	ws: Workspace,
	tableId: string,
	stored: string
): string | null {
	const sql = formulaSql(ws, tableId, stored);

	try {
		engine.all(`select (${sql}) as v from ${tableId} t limit 1`);
		return null;
	} catch (error) {
		return errorText(error);
	}
}

function primaryColumn(ws: Workspace, tableId: string): string {
	return ws.primaryField(tableId)?.id ?? 'id';
}

/**
 * Views named as the person reads them — `"Sets"."Weight"` — over the `v_` views, for SQL
 * written by an assistant. A link reads as the linked row's first text field.
 */
export function createNamedViews(engine: Engine, ws: Workspace, baseId: string): void {
	const used = new Set<string>();

	for (const table of ws.tables(baseId)) {
		let name = table.name;
		for (let n = 2; used.has(name.toLowerCase()); n += 1) {
			name = `${table.name} (${n})`;
		}
		used.add(name.toLowerCase());

		const taken = new Set(['_id']);
		const columns = ['v.id as "_id"', `v.${quote(CREATED)} as "_created"`];

		for (const field of ws.fields(table.id)) {
			let label = field.name;
			for (let n = 2; taken.has(label.toLowerCase()); n += 1) {
				label = `${field.name} (${n})`;
			}
			taken.add(label.toLowerCase());

			const target =
				field.type === 'link' && field.target !== null ? ws.table(field.target) : undefined;
			const value =
				target === undefined
					? `v.${field.id}`
					: `(select x.${primaryColumn(ws, target.id)} from v_${target.id} x where x.id = v.${field.id})`;

			columns.push(`${value} as ${quote(label)}`);
		}

		engine.exec(`drop view if exists ${quote(name)}`);
		engine.exec(`create view ${quote(name)} as select ${columns.join(', ')} from v_${table.id} v`);
	}
}

export function materializeBase(
	engine: Engine,
	ws: Workspace,
	baseId: string,
	named = false
): Map<string, FormulaProblems> {
	const out = new Map<string, FormulaProblems>();

	for (const table of ws.tables(baseId)) {
		out.set(table.id, materializeTable(engine, ws, table.id));
	}

	if (named) {
		createNamedViews(engine, ws, baseId);
	}

	return out;
}

export class QueryError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'QueryError';
	}
}

/** One read-only statement, capped; the engine must already be in `query_only` mode. */
export function readQuery(engine: Engine, sql: string, limit = 200): SqlRow[] {
	const statement = sql.trim().replace(/;\s*$/u, '');

	if (statement.includes(';')) {
		throw new QueryError('one query at a time');
	}

	try {
		return engine.all(`select * from (${statement}) limit ${limit}`);
	} catch (error) {
		throw new QueryError(errorText(error));
	}
}
