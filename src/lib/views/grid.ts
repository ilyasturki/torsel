import type { LocaleFormats } from '#lib/client/format.ts';
import { browserFormats, formatValue } from '#lib/client/format.ts';
import type { RowUpdate } from '#lib/core/actions.ts';
import { updateRecord, updateRow, writeRows } from '#lib/core/actions.ts';
import { parseCells, writeCells } from '#lib/core/csv.ts';
import type { FormulaHits, Reading } from '#lib/core/conditions.ts';
import type { Total } from '#lib/core/conditions.ts';
import { conditionTest, reading, totalOf, totalsFor } from '#lib/core/conditions.ts';
import type {
	Change,
	Choice,
	FieldDef,
	FilterConfig,
	GridConfig,
	Rec,
	Value,
	ViewDef
} from '#lib/core/model.ts';
import { hasChoices, sortsOf } from '#lib/core/model.ts';
import type { SqlRow } from '#lib/core/sql.ts';
import { CHOICES_JOIN, currencyOf, formatDuration, ratingScale } from '#lib/core/values.ts';
import type { Workspace } from '#lib/core/workspace.ts';
import { nextChoice } from '#lib/ui/colors.ts';

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

export function screenReading(ws: Workspace): Reading {
	return reading((field, value) => cellText(ws, field, value as Value | undefined));
}

const noHits: FormulaHits = () => new Map();

export function filteredRows(
	ws: Workspace,
	tableId: string,
	config: FilterConfig,
	computed: Computed,
	hits: FormulaHits = noHits
): Rec[] {
	const rows = ws.rows(tableId);
	const filters = config.filters ?? [];
	if (filters.length === 0) return rows;
	const fields = new Map(ws.fields(tableId).map((field) => [field.id, field]));
	const test = conditionTest(
		fields,
		filters,
		(row, field) => cellValue(row, field, computed),
		screenReading(ws),
		hits
	);
	return rows.filter((row) => test(row));
}

/** The rows a grid shows: oldest first so a new row lands at the end, unless the view sorts. */
export function gridRows(
	ws: Workspace,
	tableId: string,
	config: GridConfig & FilterConfig,
	computed: Computed,
	hits: FormulaHits = noHits
): Rec[] {
	const rows = filteredRows(ws, tableId, config, computed, hits);

	const keys = sortsOf(config).flatMap((key) => {
		const field = ws.field(key.field);
		return field === undefined ? [] : [{ field, direction: key.dir === 'asc' ? 1 : -1 }];
	});
	if (keys.length === 0) {
		return rows;
	}

	const keyed = rows.map((row) => ({
		row,
		values: keys.map(({ field }) => {
			const value = cellValue(row, field, computed);
			const byText = field.type === 'link' || Array.isArray(value);
			return byText ? cellText(ws, field, value) : value;
		})
	}));
	keyed.sort((a, b) => {
		for (const [at, { direction }] of keys.entries()) {
			const order = compareCells(a.values[at], b.values[at], direction);
			if (order !== 0) return order;
		}
		return 0;
	});
	return keyed.map(({ row }) => row);
}

/** Blanks last whichever the direction. */
function compareCells(a: Value | undefined, b: Value | undefined, direction: number): number {
	if (isBlank(a) || isBlank(b)) {
		return Number(isBlank(a)) - Number(isBlank(b));
	}
	const order =
		typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
	return order * direction;
}

export function parseTsv(text: string): string[][] {
	return parseCells(text, '\t');
}

export function toTsv(cells: string[][]): string {
	return writeCells(cells, '\t');
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"]/gu, (char) => `&#${char.charCodeAt(0)};`);
}

/** The flavour a paste into a document or an email reads as a table. */
export function toHtml(cells: string[][]): string {
	const tag = (name: string, inner: string): string => `<${name}>${inner}</${name}>`;
	const lineBreak = `<${'br'}>`;
	return tag(
		'table',
		cells
			.map((line) =>
				tag(
					'tr',
					line.map((text) => tag('td', escapeHtml(text).replaceAll('\n', lineBreak))).join('')
				)
			)
			.join('')
	);
}

/** A share checked reads as a percent; every other total as its column does. */
export function columnTotals(
	rows: readonly Rec[],
	fields: readonly FieldDef[],
	totals: Record<string, Total>,
	computed: Computed
): Map<string, string> {
	const out = new Map<string, string>();
	for (const field of fields) {
		const total = totals[field.id];
		if (total === undefined || !totalsFor(field).includes(total)) continue;
		const figure = totalOf(
			total,
			rows.map((row) => cellValue(row, field, computed))
		);
		if (figure === null) {
			out.set(field.id, '');
		} else if (total === 'count') {
			out.set(field.id, formatValue({ type: 'number' }, figure as number));
		} else if (total === 'checked') {
			out.set(field.id, formatValue({ type: 'percent', decimals: 0 }, (figure as number) * 100));
		} else {
			const look: FieldDef =
				field.type === 'formula' && field.result === null ? { ...field, type: 'number' } : field;
			out.set(field.id, formatValue(look, figure));
		}
	}
	return out;
}

export type Summary = { sum: number; average: number; count: number; field: FieldDef | null };

/** The numbers of a selection, summed; `field` is the one field they all come from, for its format. */
export function summarize(rows: Rec[], fields: FieldDef[], computed: Computed): Summary | null {
	let sum = 0;
	let count = 0;
	const from = new Set<FieldDef>();
	for (const row of rows) {
		for (const field of fields) {
			const value = cellValue(row, field, computed);
			if (typeof value === 'number' && Number.isFinite(value)) {
				sum += value;
				count += 1;
				from.add(field);
			}
		}
	}
	return count === 0
		? null
		: { sum, average: sum / count, count, field: from.size === 1 ? [...from][0] : null };
}

/** A cell as a spreadsheet reads it: every digit, an ISO date, TRUE or FALSE, a link's title. */
export function copyText(
	ws: Workspace,
	field: FieldDef,
	value: Value | undefined,
	formats: LocaleFormats = browserFormats
): string {
	if (isBlank(value)) {
		return '';
	}
	return field.type === 'link' ? ws.rowTitle(String(value)) : formats.copyValue(field, value);
}

/** Numbers keep a dot for decimals whatever the locale, so the file reads back anywhere. */
export function viewCells(
	ws: Workspace,
	tableId: string,
	view: ViewDef,
	computed: Computed,
	hits: FormulaHits = noHits
): string[][] {
	const config = view.type === 'grid' ? view.config : {};
	const hidden = new Set(config.hidden ?? []);
	const fields = ws.fields(tableId).filter((field) => !hidden.has(field.id));
	const rows = gridRows(ws, tableId, config, computed, hits);
	return [
		fields.map((field) => field.name),
		...rows.map((row) =>
			fields.map((field) => {
				const value = cellValue(row, field, computed);
				return typeof value === 'number' ? fileNumber(field, value) : copyText(ws, field, value);
			})
		)
	];
}

/** A number as a file holds it: the sign or code its type reads back by, never the locale's. */
function fileNumber(field: FieldDef, value: number): string {
	switch (field.type) {
		case 'currency':
			return `${value} ${currencyOf(field)}`;
		case 'percent':
			return `${value}%`;
		case 'duration':
			return formatDuration(value, field.seconds || value % 60 !== 0);
		default:
			return String(value);
	}
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

/** Reads typed or pasted text into a field's value; undefined when it is not one. */
export function cellReader(
	ws: Workspace,
	formats: LocaleFormats = browserFormats
): (field: FieldDef, raw: string) => Value | undefined {
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
		if (field.type !== 'link') {
			return formats.readValue(field, raw);
		}
		if (raw.trim() === '') {
			return null;
		}
		return field.target === null ? undefined : linkId(field.target, raw);
	};
}

function sameValue(a: Value | undefined, b: Value | undefined): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export type Paste = {
	changes: Change[];
	added: number;
	skipped: number;
	// Values left out because the cell, or a row past the end, is not this device's to write.
	kept: number;
	/** The currency of a column a value in another currency was refused from. */
	foreign: string | null;
	rows: number;
	cols: number;
};

export function fillSelection(matrix: string[][], rows: number, cols: number): string[][] {
	return matrix.length === 1 && matrix[0].length === 1 && rows * cols > 1
		? Array.from({ length: rows }, () => Array.from({ length: cols }, () => matrix[0][0]))
		: matrix;
}

export type GridAccess = { locked: ReadonlySet<string>; adds: boolean };

const OPEN: GridAccess = { locked: new Set(), adds: true };

/** The changes a paste makes from a top-left cell; rows past the end are added where rows can be. */
export function pasteChanges(
	ws: Workspace,
	tableId: string,
	fields: FieldDef[],
	rows: Rec[],
	at: { row: number; col: number },
	matrix: string[][],
	access: GridAccess = OPEN
): Paste {
	const read = cellReader(ws);
	const choices = new Map<string, Choice[]>();
	const updates: RowUpdate[] = [];
	const inserts: Record<string, Value>[] = [];
	let skipped = 0;
	let kept = 0;
	let foreign: string | null = null;

	matrix.forEach((line, offset) => {
		const row: Rec | undefined = rows[at.row + offset];
		const values: Record<string, Value> = {};

		line.forEach((raw, index) => {
			const field: FieldDef | undefined = fields[at.col + index];
			if (
				field !== undefined &&
				(access.locked.has(field.id) || (row === undefined && !access.adds))
			) {
				kept += 1;
				return;
			}
			if (field?.type === 'currency' && browserFormats.otherCurrency(raw, currencyOf(field))) {
				foreign ??= currencyOf(field);
				skipped += 1;
				return;
			}
			let value = field === undefined ? undefined : read(field, raw);
			if (field === undefined || value === undefined) {
				skipped += raw.trim() === '' ? 0 : 1;
				return;
			}
			if (hasChoices(field.type) && value !== null) {
				const names = (Array.isArray(value) ? value : [value]).map((name) => {
					const known = choices.get(field.id) ?? field.choices;
					const match = known.find(
						(choice) => choice.name.toLowerCase() === String(name).toLowerCase()
					);
					if (match === undefined) {
						choices.set(field.id, [...known, nextChoice(known, String(name))]);
					}
					return match?.name ?? String(name);
				});
				value = field.type === 'choices' ? [...new Set(names)] : names[0];
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
		kept,
		foreign,
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
// A small star and the pixel after it.
const STAR = 15;
const HEADER_MARKS = 18;
const FORMULA_MARK = 12;
const FLOOR: Record<FieldDef['type'], { empty: number; filled: number }> = {
	text: { empty: 180, filled: 96 },
	longtext: { empty: 220, filled: 120 },
	choice: { empty: 160, filled: 96 },
	choices: { empty: 180, filled: 120 },
	link: { empty: 160, filled: 96 },
	url: { empty: 180, filled: 96 },
	email: { empty: 180, filled: 96 },
	phone: { empty: 140, filled: 96 },
	date: { empty: 112, filled: 96 },
	datetime: { empty: 160, filled: 120 },
	number: { empty: 96, filled: 72 },
	currency: { empty: 112, filled: 80 },
	percent: { empty: 96, filled: 72 },
	duration: { empty: 96, filled: 72 },
	rating: { empty: 0, filled: 0 },
	formula: { empty: 96, filled: 72 },
	check: { empty: 64, filled: 64 },
	image: { empty: 112, filled: 112 }
};
const FIT_CEILING = 320;

export function fitWidth(
	field: FieldDef,
	texts: string[],
	measure: { body: (text: string) => number; header: (text: string) => number }
): number {
	const marks = (text: string): number =>
		field.type === 'choices'
			? text.split(CHOICES_JOIN).length * CHIP_MARK
			: hasChoices(field.type)
				? CHIP_MARK
				: 0;
	const widest = Math.max(
		0,
		...texts.map((text) => (text === '' ? 0 : measure.body(text) + marks(text)))
	);
	const body =
		field.type === 'rating'
			? ratingScale(field).max * STAR + CELL_PADDING
			: widest === 0
				? FLOOR[field.type].empty
				: widest + CELL_PADDING;
	const header =
		measure.header(field.name) +
		CELL_PADDING +
		HEADER_MARKS +
		(field.type === 'formula' ? FORMULA_MARK : 0);
	return Math.ceil(Math.min(FIT_CEILING, Math.max(FLOOR[field.type].filled, body, header)));
}
