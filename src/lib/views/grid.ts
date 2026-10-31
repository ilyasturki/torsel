import { formatValue, plainNumber } from '#lib/client/format.ts';
import type { RowUpdate } from '#lib/core/actions.ts';
import { updateRecord, updateRow, writeRows } from '#lib/core/actions.ts';
import { parseCells } from '#lib/core/csv.ts';
import type { Change, Choice, FieldDef, GridConfig, Rec, Value } from '#lib/core/model.ts';
import type { SqlRow } from '#lib/core/sql.ts';
import { parseCheck, parseDate, parseNumber } from '#lib/core/values.ts';
import type { Workspace } from '#lib/core/workspace.ts';
import { DATA_COLORS } from '#lib/ui/colors.ts';

export type Computed = Map<string, SqlRow>;

export function cellValue(row: Rec, field: FieldDef, computed: Computed): Value | undefined {
	return field.type === 'formula' ? (computed.get(row.id)?.[field.id] ?? null) : row.data[field.id];
}

function isBlank(value: Value | undefined): boolean {
	return value === null || value === undefined || value === '';
}

/** What a cell reads as: what a filter searches and a column is fitted to. */
export function cellText(ws: Workspace, field: FieldDef, value: Value | undefined): string {
	if (isBlank(value)) {
		return '';
	}
	return field.type === 'link' ? ws.rowTitle(String(value)) : formatValue(field, value);
}

const collator = new Intl.Collator(undefined, { numeric: true });

/** The rows a grid shows: oldest first so a new row lands at the end, unless the view sorts. */
export function gridRows(
	ws: Workspace,
	tableId: string,
	config: GridConfig,
	computed: Computed
): Rec[] {
	let rows = ws.rows(tableId);

	const filter = config.filter;
	const filtered = filter ? ws.field(filter.field) : undefined;
	if (filter && filtered && filter.text !== '') {
		const needle = filter.text.toLowerCase();
		rows = rows.filter((row) =>
			cellText(ws, filtered, cellValue(row, filtered, computed))
				.toLowerCase()
				.includes(needle)
		);
	}

	const sort = config.sort;
	const sorted = sort ? ws.field(sort.field) : undefined;
	if (!sort || !sorted) {
		return rows;
	}

	const direction = sort.dir === 'asc' ? 1 : -1;
	const keyed = rows.map((row) => {
		const value = cellValue(row, sorted, computed);
		return { row, value: sorted.type === 'link' ? cellText(ws, sorted, value) : value };
	});
	keyed.sort((a, b) => {
		if (isBlank(a.value) || isBlank(b.value)) {
			return Number(isBlank(a.value)) - Number(isBlank(b.value));
		}
		const order =
			typeof a.value === 'number' && typeof b.value === 'number'
				? a.value - b.value
				: collator.compare(String(a.value), String(b.value));
		return order * direction;
	});
	return keyed.map(({ row }) => row);
}

export function parseTsv(text: string): string[][] {
	return parseCells(text, '\t');
}

export function toTsv(cells: string[][]): string {
	return cells
		.map((line) =>
			line
				.map((cell) => (/[\t\r\n"]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell))
				.join('\t')
		)
		.join('\n');
}

/** A cell as a spreadsheet reads it: every digit, an ISO date, TRUE or FALSE, a link's title. */
export function copyText(ws: Workspace, field: FieldDef, value: Value | undefined): string {
	if (isBlank(value)) {
		return '';
	}
	if (field.type === 'link') {
		return ws.rowTitle(String(value));
	}
	if (typeof value === 'number') {
		return plainNumber(value);
	}
	if (typeof value === 'boolean') {
		return value ? 'TRUE' : 'FALSE';
	}
	return typeof value === 'string' ? value : JSON.stringify(value);
}

export type LinkOption = { id: string; label: string };

export function linkOptions(ws: Workspace, tableId: string | null): LinkOption[] {
	if (tableId === null) {
		return [];
	}
	const primary = ws.primaryField(tableId)?.id ?? '';
	return ws
		.rows(tableId)
		.map((row) => ({ id: row.id, label: String(row.data[primary] ?? '') || row.id }))
		.sort((a, b) => collator.compare(a.label, b.label));
}

const SHORT_DATE = /^\d{1,2}[/.-]\d{1,2}$/u;

/** Reads typed or pasted text into a field's value; undefined when it is not one. */
export function cellReader(ws: Workspace): (field: FieldDef, raw: string) => Value | undefined {
	const links = new Map<string, Map<string, string>>();

	function linkId(tableId: string, raw: string): string | undefined {
		let titles = links.get(tableId);
		if (titles === undefined) {
			titles = new Map();
			for (const option of linkOptions(ws, tableId)) {
				const title = option.label.trim().toLowerCase();
				titles.set(title, titles.get(title) ?? option.id);
				titles.set(option.id, option.id);
			}
			links.set(tableId, titles);
		}
		return titles.get(raw.trim().toLowerCase());
	}

	return (field, raw) => {
		const text = raw.trim();
		if (field.type === 'formula') {
			return undefined;
		}
		if (text === '') {
			return null;
		}
		switch (field.type) {
			case 'number':
				return parseNumber(text) ?? undefined;
			case 'date':
				return (
					parseDate(SHORT_DATE.test(text) ? `${text}/${new Date().getFullYear()}` : text) ??
					undefined
				);
			case 'check':
				return parseCheck(text) ?? undefined;
			case 'choice':
				return (
					field.choices.find((choice) => choice.name.toLowerCase() === text.toLowerCase())?.name ??
					text
				);
			case 'link':
				return field.target === null ? undefined : linkId(field.target, text);
			case 'text':
				return raw;
		}
	};
}

export function nextChoice(choices: Choice[], name: string): Choice {
	return { name, color: DATA_COLORS[(choices.length % 7) + 1] };
}

function sameValue(a: Value | undefined, b: Value | undefined): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export type Paste = {
	changes: Change[];
	added: number;
	skipped: number;
	rows: number;
	cols: number;
};

export function fillSelection(matrix: string[][], rows: number, cols: number): string[][] {
	return matrix.length === 1 && matrix[0].length === 1 && rows * cols > 1
		? Array.from({ length: rows }, () => Array.from({ length: cols }, () => matrix[0][0]))
		: matrix;
}

/** The changes a paste makes from a top-left cell; rows past the end are added. */
export function pasteChanges(
	ws: Workspace,
	tableId: string,
	fields: FieldDef[],
	rows: Rec[],
	at: { row: number; col: number },
	matrix: string[][]
): Paste {
	const read = cellReader(ws);
	const choices = new Map<string, Choice[]>();
	const updates: RowUpdate[] = [];
	const inserts: Record<string, Value>[] = [];
	let skipped = 0;

	matrix.forEach((line, offset) => {
		const row: Rec | undefined = rows[at.row + offset];
		const values: Record<string, Value> = {};

		line.forEach((raw, index) => {
			const field: FieldDef | undefined = fields[at.col + index];
			let value = field === undefined ? undefined : read(field, raw);
			if (field === undefined || value === undefined) {
				skipped += raw.trim() === '' ? 0 : 1;
				return;
			}
			if (field.type === 'choice' && typeof value === 'string') {
				const known = choices.get(field.id) ?? field.choices;
				const name = value.toLowerCase();
				const match = known.find((choice) => choice.name.toLowerCase() === name);
				value = match?.name ?? value;
				if (match === undefined) {
					choices.set(field.id, [...known, nextChoice(known, value)]);
				}
			}
			if (row === undefined ? value !== null : !sameValue(row.data[field.id], value)) {
				values[field.id] = value;
			}
		});

		if (Object.keys(values).length > 0) {
			if (row === undefined) {
				inserts.push(values);
			} else {
				updates.push({ id: row.id, values });
			}
		}
	});

	const fieldChanges = [...choices].flatMap(([id, list]) =>
		updateRecord(ws, id, {
			choices: list.map((choice) => ({ name: choice.name, color: choice.color }))
		})
	);
	const written = writeRows(ws, tableId, updates, inserts);

	return {
		changes: [...fieldChanges, ...written.changes],
		added: written.ids.length,
		skipped,
		rows: matrix.length,
		cols: Math.min(
			Math.max(0, ...matrix.map((line) => line.length)),
			Math.max(0, fields.length - at.col)
		)
	};
}

export function clearChanges(ws: Workspace, fields: FieldDef[], rows: Rec[]): Change[] {
	return rows.flatMap((row) => {
		const values: Record<string, Value> = {};
		for (const field of fields) {
			if (field.type !== 'formula' && !isBlank(row.data[field.id])) {
				values[field.id] = null;
			}
		}
		return Object.keys(values).length > 0 ? updateRow(ws, row.id, values) : [];
	});
}

const SAMPLE = 200;

/** Spread over the table rather than its head, which often holds short early rows. */
export function sampleRows(rows: Rec[]): Rec[] {
	if (rows.length <= SAMPLE) {
		return rows;
	}
	const stride = rows.length / SAMPLE;
	return Array.from({ length: SAMPLE }, (_, index) => rows[Math.floor(index * stride)]);
}

const CELL_PADDING = 26;
const CHIP_MARK = 16;
const HEADER_MARKS = 18;
const FORMULA_MARK = 12;
const FLOOR: Record<FieldDef['type'], { empty: number; filled: number }> = {
	text: { empty: 180, filled: 96 },
	choice: { empty: 160, filled: 96 },
	link: { empty: 160, filled: 96 },
	date: { empty: 112, filled: 96 },
	number: { empty: 96, filled: 72 },
	formula: { empty: 96, filled: 72 },
	check: { empty: 64, filled: 64 }
};
const FIT_CEILING = 320;

export function fitWidth(
	field: FieldDef,
	texts: string[],
	measure: { body: (text: string) => number; header: (text: string) => number }
): number {
	const widest = Math.max(0, ...texts.map((text) => (text === '' ? 0 : measure.body(text))));
	const body =
		widest === 0
			? FLOOR[field.type].empty
			: widest + CELL_PADDING + (field.type === 'choice' ? CHIP_MARK : 0);
	const header =
		measure.header(field.name) +
		CELL_PADDING +
		HEADER_MARKS +
		(field.type === 'formula' ? FORMULA_MARK : 0);
	return Math.ceil(Math.min(FIT_CEILING, Math.max(FLOOR[field.type].filled, body, header)));
}
