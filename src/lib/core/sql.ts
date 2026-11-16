import type { Rollup } from './formula.ts';
import { BARE_AGGREGATE, FormulaError, rollupsOf } from './formula.ts';
import type { FieldDef, Rec, Value } from './model.ts';
import { CREATED, isNumeric } from './model.ts';
import type { Workspace } from './workspace.ts';

export type SqlValue = string | number | null;

export type SqlRow = Record<string, SqlValue>;

export interface Engine {
	exec(sql: string, bind?: SqlValue[]): void;
	all(sql: string, bind?: SqlValue[]): SqlRow[];
	/** Steps through the rows until `take` returns false; the statement's column names. */
	each(sql: string, take: (row: SqlValue[]) => boolean): string[];
}

export function quote(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

function affinity(field: FieldDef): string {
	if (isNumeric(field.type)) {
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

const PAIR = /\{\{([a-z]_[0-9a-z]+)\}\}(?:\.\{\{([a-z]_[0-9a-z]+)\}\})?/gu;

function alias(depth: number): string {
	return depth === 0 ? 't' : `x${depth}`;
}

/** Stored formulas as SQL: a lookup or a rollup becomes a subquery one alias deeper, formulas referring to formulas are inlined. */
class Compiler {
	public readonly tables = new Set<string>();

	private readonly memo = new Map<string, string>();

	private readonly visiting = new Set<string>();

	public constructor(private readonly ws: Workspace) {}

	public column(field: FieldDef, depth: number): string {
		if (field.type !== 'formula') {
			return `${alias(depth)}.${field.id}`;
		}
		const key = `${field.id}@${depth}`;
		const known = this.memo.get(key);
		if (known !== undefined) {
			return known;
		}
		if (this.visiting.has(field.id)) {
			throw new FormulaError('self-reference', field.name);
		}
		this.visiting.add(field.id);
		try {
			const sql = `(${this.expr(field.table, field.expr ?? 'NULL', depth)})`;
			this.memo.set(key, sql);
			return sql;
		} finally {
			this.visiting.delete(field.id);
		}
	}

	public expr(tableId: string, stored: string, depth: number): string {
		const found = rollupsOf(stored, (id) => this.ws.table(id) !== undefined);
		if ('missing' in found) {
			return 'NULL';
		}
		let out = '';
		let at = 0;
		for (const rollup of found) {
			out += this.tokens(tableId, stored.slice(at, rollup.from), depth);
			out += this.rollup(tableId, stored, rollup, depth);
			at = rollup.close + 1;
		}
		return out + this.tokens(tableId, stored.slice(at), depth);
	}

	private rollup(tableId: string, stored: string, rollup: Rollup, depth: number): string {
		const links = this.ws
			.fields(rollup.table)
			.filter((field) => field.type === 'link' && field.target === tableId);
		if (links.length !== 1) {
			return 'NULL';
		}
		this.tables.add(rollup.table);
		const inner = alias(depth + 1);
		const args = this.tokens(tableId, stored.slice(rollup.open + 1, rollup.close), depth, {
			table: rollup.table,
			depth: depth + 1
		});
		return `(select ${rollup.fn}(${args}) from ${rollup.table} ${inner} where ${inner}.${links[0].id} = ${alias(depth)}.id)`;
	}

	private tokens(
		tableId: string,
		text: string,
		depth: number,
		child?: { table: string; depth: number }
	): string {
		return text.replace(PAIR, (_, first: string, second: string | undefined) => {
			if (child !== undefined && first === child.table) {
				if (second === undefined) return `${alias(child.depth)}.id`;
				const field = this.ws.field(second);
				return field?.table === child.table ? this.column(field, child.depth) : 'NULL';
			}
			const field = this.ws.field(first);
			if (field === undefined || field.table !== tableId) return 'NULL';
			if (second === undefined) return this.column(field, depth);

			const target = this.ws.field(second);
			if (field.type !== 'link' || field.target === null || target?.table !== field.target) {
				return 'NULL';
			}
			this.tables.add(field.target);
			const inner = alias(depth + 1);
			return `(select ${this.column(target, depth + 1)} from ${field.target} ${inner} where ${inner}.id = ${alias(depth)}.${field.id})`;
		});
	}
}

/** Each formula of a table as SQL over its columns, and the other tables they read. */
export function formulaColumns(
	ws: Workspace,
	tableId: string
): { columns: Map<string, string>; tables: Set<string> } {
	const compiler = new Compiler(ws);
	const columns = new Map<string, string>();
	for (const field of ws.fields(tableId)) {
		if (field.type === 'formula') {
			try {
				columns.set(field.id, compiler.column(field, 0).slice(1, -1));
			} catch {
				columns.set(field.id, 'NULL');
			}
		}
	}
	compiler.tables.delete(tableId);
	return { columns, tables: compiler.tables };
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

// An aggregate yields its one row even over no rows; a row formula or a window yields none.
function isBareAggregate(engine: Engine, tableId: string, sql: string): boolean {
	return engine.all(`select (${sql}) as v from ${tableId} t where 0`).length > 0;
}

function viewSql(tableId: string, formulas: Map<string, string>): string {
	const computed = [...formulas].map(([id, sql]) => `(${sql}) as ${id}`);
	return `create view v_${tableId} as select ${['t.*', ...computed].join(', ')} from ${tableId} t`;
}

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^.*?SQLITE_\w+: sqlite3 result code \d+: /u, '');
}

const loaded = new WeakMap<Engine, Map<string, { ws: Workspace; revision: number }>>();

/** Copies a table's rows into the engine, unless this workspace's copy at this revision is already there. */
function loadTable(engine: Engine, ws: Workspace, tableId: string): void {
	let tables = loaded.get(engine);
	if (tables === undefined) {
		tables = new Map();
		loaded.set(engine, tables);
	}
	const revision = ws.revision(tableId);
	const known = tables.get(tableId);
	if (known?.ws === ws && known.revision === revision) {
		return;
	}

	const fields = ws.fields(tableId);
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
	for (const field of fields) {
		if (field.type === 'link') {
			engine.exec(`create index ${tableId}_${field.id} on ${tableId} (${field.id})`);
		}
	}
	tables.set(tableId, { ws, revision });
}

/** The tables a table's formulas read besides its own: its SQL copy is stale once one of them moves. */
export function formulaTables(ws: Workspace, tableId: string): Set<string> {
	return formulaColumns(ws, tableId).tables;
}

/** Rebuilds one table, the tables its formulas read, and its `v_` view; a formula SQLite refuses evaluates to NULL. */
export function materializeTable(engine: Engine, ws: Workspace, tableId: string): FormulaProblems {
	const problems: FormulaProblems = new Map();

	engine.exec(`drop view if exists v_${tableId}`);
	const { columns: formulas, tables } = formulaColumns(ws, tableId);
	for (const id of [tableId, ...tables]) {
		loadTable(engine, ws, id);
	}

	for (const [id, sql] of formulas) {
		try {
			if (isBareAggregate(engine, tableId, sql)) {
				problems.set(id, BARE_AGGREGATE);
				formulas.set(id, 'NULL');
			}
		} catch {
			// The view's own build below names what SQLite refuses.
		}
	}

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

/** A stored formula as SQL over `t`, with every table it reads loaded. */
function formulaSql(engine: Engine, ws: Workspace, tableId: string, stored: string): string {
	const compiler = new Compiler(ws);
	const sql = compiler.expr(tableId, stored, 0);
	for (const id of [tableId, ...compiler.tables]) {
		loadTable(engine, ws, id);
	}
	return sql;
}

/** What a formula not yet on the table would give each row; empty if SQLite refuses it, a `QueryError` if a bounded engine interrupts it. */
export function formulaValues(
	engine: Engine,
	ws: Workspace,
	tableId: string,
	stored: string
): Map<string, SqlValue> {
	try {
		const sql = formulaSql(engine, ws, tableId, stored);
		const rows = engine.all(`select t.id as id, (${sql}) as v from ${tableId} t`);
		return new Map(rows.map((row) => [String(row.id), row.v]));
	} catch (error) {
		if (errorText(error) === 'interrupted') {
			throw new QueryError('interrupted');
		}
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
	try {
		const sql = formulaSql(engine, ws, tableId, stored);
		engine.all(`select (${sql}) as v from ${tableId} t limit 1`);
		return isBareAggregate(engine, tableId, sql) ? BARE_AGGREGATE : null;
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

export type QueryPage = {
	columns: string[];
	rows: SqlValue[][];
	/** The offset of the next page, or null on the last one. */
	next: number | null;
	/** How many text cells were cut to `cell` characters. */
	cut: number;
};

export type QueryLimits = { offset?: number; rows?: number; bytes?: number; cell?: number };

// Literals, quoted names and comments blanked, so a `;` left over separates statements.
const UNQUOTED =
	/'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/gu;

// sqlite-wasm hands back a blob as a Uint8Array, an integer past 2^53 as a bigint, an overflow as Infinity.
function plainCell(value: unknown): SqlValue {
	if (value instanceof Uint8Array) {
		return `x'${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}'`;
	}
	if (typeof value === 'bigint') {
		return String(value);
	}
	if (typeof value === 'number' && !Number.isFinite(value)) {
		return null;
	}
	return value as SqlValue;
}

/** One read-only statement, one page capped in rows, in JSON bytes and per text cell; the engine must already be in `query_only` mode. */
export function readQuery(
	engine: Engine,
	sql: string,
	{ offset = 0, rows: most = 200, bytes = 48_000, cell = 2_000 }: QueryLimits = {}
): QueryPage {
	const statement = sql.trim().replace(/;\s*$/u, '');

	if (statement.replace(UNQUOTED, ' ').includes(';')) {
		throw new QueryError('one statement at a time');
	}

	const rows: SqlValue[][] = [];
	let size = 2;
	let cut = 0;
	let more = false;

	let columns: string[];
	try {
		// The newline ends a trailing `--` comment before it can swallow the limit.
		columns = engine.each(
			`select * from (${statement}\n) limit ${most + 1} offset ${offset}`,
			(row) => {
				let shortened = 0;
				const values = row.map((raw) => {
					const value = plainCell(raw);
					if (typeof value === 'string' && value.length > cell) {
						shortened += 1;
						return `${value.slice(0, cell)}…`;
					}
					return value;
				});
				size += JSON.stringify(values).length + 1;
				if (rows.length === most || (size > bytes && rows.length > 0)) {
					more = true;
					return false;
				}
				cut += shortened;
				rows.push(values);
				return true;
			}
		);
	} catch (error) {
		throw new QueryError(errorText(error));
	}

	return { columns, rows, next: more ? offset + rows.length : null, cut };
}
