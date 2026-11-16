import { z } from 'zod';

import { IMAGE_TYPES, imagesOf } from '../../core/images.ts';
import type { FieldDef, Rec, Value } from '../../core/model.ts';
import type { SqlValue } from '../../core/sql.ts';
import type { Workspace } from '../../core/workspace.ts';
import { createdAt } from '../../core/workspace.ts';
import { serially } from '../db/serial.ts';
import { SqlRefusal, sqlPool } from '../sql/pool.ts';

export const IMAGE = z
	.strictObject({
		id: z.string().describe("the image's sha-256; write it back to keep the image"),
		type: z.enum(IMAGE_TYPES),
		w: z.number().int().describe('width in pixels'),
		h: z.number().int().describe('height in pixels'),
		size: z.number().int().describe('bytes'),
		name: z.string().optional().describe('the file name it was added with'),
		src: z.string().optional().describe('the link it was fetched from')
	})
	.meta({ id: 'Image' });

export const CELL_OUT = z
	.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()), z.array(IMAGE)])
	.describe(
		'as written: text; a number (an amount, percent points, a score for a rating, seconds for a duration); a YYYY-MM-DD date or YYYY-MM-DDTHH:MM datetime; a boolean for a check; the choice text; an array of choice texts; the id of the linked row; an array of Image for an image field; a formula as SQLite computes it; null when empty'
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

function cell(field: FieldDef, value: Value | undefined): Row['fields'][string] {
	if (value === undefined || value === null) {
		return null;
	}
	if (field.type === 'image') {
		const refs = imagesOf(value);
		return refs.length === 0 ? null : refs;
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
	rows: Rec[],
	sqlTurn: string
): Promise<Map<string, Map<string, SqlValue>>> {
	const computed = fields.filter((field) => field.type === 'formula');
	const out = new Map<string, Map<string, SqlValue>>();
	const base = ws.table(table)?.base;
	if (computed.length === 0 || rows.length === 0 || base === undefined) {
		return out;
	}
	const ids = computed.map((field) => field.id);
	try {
		const cells = await serially(sqlTurn, () =>
			sqlPool.run(ws.baseRecords(base), base, {
				kind: 'formula-cells',
				table,
				fields: ids,
				rows: rows.map((row) => row.id)
			})
		);
		for (const [row, values] of cells) {
			out.set(row, new Map(ids.map((id, index) => [id, values[index]])));
		}
	} catch (error) {
		if (!(error instanceof SqlRefusal)) throw error;
	}
	return out;
}

export async function shapeRows(
	ws: Workspace,
	table: string,
	rows: Rec[],
	sqlTurn: string,
	picked: FieldDef[] = ws.fields(table),
	keys: Keys = 'name'
): Promise<Row[]> {
	const computed = await formulas(ws, table, picked, rows, sqlTurn);
	return rows.map((row) => {
		const fields: Row['fields'] = {};
		for (const field of picked) {
			fields[keys === 'id' ? field.id : field.name] =
				field.type === 'formula'
					? (computed.get(row.id)?.get(field.id) ?? null)
					: cell(field, row.data[field.id]);
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
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
	} catch {
		return null;
	}
	return Array.isArray(parsed) &&
		parsed.length === 2 &&
		typeof parsed[0] === 'number' &&
		typeof parsed[1] === 'string'
		? { at: parsed[0], id: parsed[1] }
		: null;
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
