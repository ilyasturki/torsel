import { z } from 'zod';

import type { FieldDef, Rec, Value } from '../../core/model.ts';
import type { SqlValue } from '../../core/sql.ts';
import type { Workspace } from '../../core/workspace.ts';
import { createdAt } from '../../core/workspace.ts';
import { SqlRefusal, sqlPool } from '../sql/pool.ts';

export const CELL_OUT = z
	.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])
	.describe(
		'as written: text; a number (an amount, percent points, seconds for a duration); a YYYY-MM-DD date or YYYY-MM-DDTHH:MM datetime; a boolean for a check; the choice text; an array of choice texts; the id of the linked row; a formula as SQLite computes it; null when empty'
	);

export const ROW = z
	.strictObject({
		id: z.string(),
		createdAt: z.string().describe('ISO 8601'),
		fields: z.record(z.string(), CELL_OUT).describe('every field of the table, by name (or id)')
	})
	.meta({ id: 'Row' });

export type Row = z.infer<typeof ROW>;

export type Keys = 'name' | 'id';

function cell(value: Value | undefined): Row['fields'][string] {
	if (value === undefined || value === null) {
		return null;
	}
	if (Array.isArray(value)) {
		return value.filter((item) => typeof item === 'string');
	}
	return typeof value === 'object' ? null : value;
}

/** The computed formula values of these rows, by row id then field id; empty when the worker refuses. */
async function formulas(
	ws: Workspace,
	table: string,
	fields: FieldDef[],
	rows: Rec[]
): Promise<Map<string, Map<string, SqlValue>>> {
	const computed = fields.filter((field) => field.type === 'formula');
	const out = new Map<string, Map<string, SqlValue>>();
	const base = ws.table(table)?.base;
	if (computed.length === 0 || rows.length === 0 || base === undefined) {
		return out;
	}
	const ids = computed.map((field) => field.id);
	try {
		const cells = await sqlPool.run(ws.baseRecords(base), base, {
			kind: 'formula-cells',
			table,
			fields: ids,
			rows: rows.map((row) => row.id)
		});
		for (const [row, values] of cells) {
			out.set(row, new Map(ids.map((id, index) => [id, values[index]])));
		}
	} catch (error) {
		if (!(error instanceof SqlRefusal)) throw error;
	}
	return out;
}

/** Rows as the API shows them: the fields picked, by name or id, formulas computed. */
export async function shapeRows(
	ws: Workspace,
	table: string,
	rows: Rec[],
	picked: FieldDef[] = ws.fields(table),
	keys: Keys = 'name'
): Promise<Row[]> {
	const computed = await formulas(ws, table, picked, rows);
	return rows.map((row) => {
		const fields: Row['fields'] = {};
		for (const field of picked) {
			fields[keys === 'id' ? field.id : field.name] =
				field.type === 'formula'
					? (computed.get(row.id)?.get(field.id) ?? null)
					: cell(row.data[field.id]);
		}
		return { id: row.id, createdAt: new Date(createdAt(row)).toISOString(), fields };
	});
}

type Position = { at: number; id: string };

export function rowCursor(row: Rec): string {
	return Buffer.from(JSON.stringify([createdAt(row), row.id])).toString('base64url');
}

/** Where a page cursor points, or null when it is not one this API gave. */
export function readRowCursor(cursor: string): Position | null {
	try {
		const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
		if (
			Array.isArray(parsed) &&
			parsed.length === 2 &&
			typeof parsed[0] === 'number' &&
			typeof parsed[1] === 'string'
		) {
			return { at: parsed[0], id: parsed[1] };
		}
	} catch {
		// Falls through to the refusal.
	}
	return null;
}

/** The rows after `position`, in the order `Workspace.rows` keeps: creation time, then id. */
export function after(rows: Rec[], position: Position | null): Rec[] {
	if (position === null) {
		return rows;
	}
	return rows.filter((row) => {
		const at = createdAt(row);
		return at > position.at || (at === position.at && row.id.localeCompare(position.id) > 0);
	});
}
