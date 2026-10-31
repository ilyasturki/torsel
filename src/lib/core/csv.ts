import type { FieldSpec } from './actions.ts';
import { BLANK_FIELD, addField, createTable, deleteRecords } from './actions.ts';
import { newId } from './ids.ts';
import type { Change, Choice, FieldDef, FieldType, Value } from './model.ts';
import { CREATED } from './model.ts';
import { coerce, parseCheck, parseDate, parseNumber } from './values.ts';
import type { Workspace } from './workspace.ts';

export function detectDelimiter(text: string): string {
	const firstLine = text.slice(0, text.search(/\r?\n|$/u));
	const counts = [',', ';', '\t'].map((delimiter) => ({
		delimiter,
		count: firstLine.split(delimiter).length - 1
	}));
	counts.sort((a, b) => b.count - a.count);

	return counts[0].count > 0 ? counts[0].delimiter : ',';
}

/** Every line kept, blank ones included: a paste lines its rows up by position. */
export function parseCells(input: string, delimiter: string): string[][] {
	const text = input.replace(/^﻿/u, '');
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;

	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];

		if (quoted) {
			if (char === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i += 1;
				} else {
					quoted = false;
				}
			} else {
				cell += char;
			}
		} else if (char === '"' && cell === '') {
			quoted = true;
		} else if (char === delimiter) {
			row.push(cell);
			cell = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && text[i + 1] === '\n') {
				i += 1;
			}
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else {
			cell += char;
		}
	}

	if (cell !== '' || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}

	return rows;
}

export function parseCsv(input: string, delimiter: string = detectDelimiter(input)): string[][] {
	return parseCells(input, delimiter).filter((cells) => cells.some((value) => value.trim() !== ''));
}

/** Rows with a header first: cells pasted with none get numbered columns, data never being names. */
export function withHeader(rows: string[][]): string[][] {
	const [first] = rows;
	const named =
		first === undefined ||
		!first.some((cell) => parseNumber(cell) !== null || parseDate(cell) !== null);

	return named ? rows : [first.map((_, index) => `Column ${index + 1}`), ...rows];
}

export type ColumnGuess = { name: string; type: FieldType; choices: string[] };

const MAX_CHOICES = 100;

function guessType(values: string[]): { type: FieldType; choices: string[] } {
	const filled = values.map((value) => value.trim()).filter((value) => value !== '');

	if (filled.length === 0) {
		return { type: 'text', choices: [] };
	}
	if (filled.every((value) => parseNumber(value) !== null)) {
		return { type: 'number', choices: [] };
	}
	if (filled.every((value) => parseDate(value) !== null)) {
		return { type: 'date', choices: [] };
	}
	if (filled.every((value) => parseCheck(value) !== null)) {
		return { type: 'check', choices: [] };
	}

	const distinct = [...new Set(filled)];
	const repeats = distinct.length <= Math.max(3, filled.length / 2);
	const short = distinct.every((value) => value.length <= 60);

	if (distinct.length <= MAX_CHOICES && repeats && short) {
		return { type: 'choice', choices: distinct.sort((a, b) => a.localeCompare(b)) };
	}

	return { type: 'text', choices: [] };
}

export function guessColumns(rows: string[][]): ColumnGuess[] {
	const [header = [], ...body] = rows;
	const used = new Set<string>();

	return header.map((raw, index) => {
		const base = raw.trim() === '' ? `Column ${index + 1}` : raw.trim();
		let name = base;
		for (let n = 2; used.has(name.toLowerCase()); n += 1) {
			name = `${base} (${n})`;
		}
		used.add(name.toLowerCase());

		return { name, ...guessType(body.map((cells) => cells[index] ?? '')) };
	});
}

export function fieldSpecs(columns: ColumnGuess[]): FieldSpec[] {
	return columns.map((column) => ({
		name: column.name,
		type: column.type,
		choices: column.choices.map((name) => ({ name, color: null }))
	}));
}

function distinctValues(body: string[][], at: number): string[] {
	return [...new Set(body.map((cells) => (cells[at] ?? '').trim()))]
		.filter((value) => value !== '')
		.sort((a, b) => a.localeCompare(b));
}

function chosenColumns(columns: ColumnGuess[], body: string[][]): ColumnGuess[] {
	return columns.map((column, at) => ({
		...column,
		choices: column.type === 'choice' ? distinctValues(body, at) : []
	}));
}

/** Rows in the order they happened when a date column says so; rows of one day keep file order. */
function chronological(body: string[][], columns: ColumnGuess[]): string[][] {
	const at = columns.findIndex((column) => column.type === 'date');
	if (at < 0) {
		return body;
	}

	return body
		.map((cells) => ({ cells, day: parseDate(cells[at] ?? '') ?? '' }))
		.sort((a, b) => a.day.localeCompare(b.day))
		.map(({ cells }) => cells);
}

// Below this, one repeated value may just be a short file.
const SETTLED_AFTER = 10;

/** A column that never varies asks nothing of the person logging the next row. */
function settled(body: string[][], at: number): boolean {
	const distinct = new Set(body.map((cells) => (cells[at] ?? '').trim()).filter((v) => v !== ''));
	return distinct.size === 0 || (distinct.size === 1 && body.length >= SETTLED_AFTER);
}

export function importTable(
	ws: Workspace,
	baseId: string,
	name: string,
	rows: string[][],
	columns: ColumnGuess[] = guessColumns(rows),
	now: number = Date.now()
): { id: string; changes: Change[] } {
	const body = rows.slice(1);
	const typed = chosenColumns(columns, body);
	const { id, fieldIds, changes } = createTable(ws, baseId, name, fieldSpecs(typed), (made) => [
		{ name: 'Grid', type: 'grid', config: {} },
		{
			name: 'Entry',
			type: 'entry',
			config: { hidden: made.filter((_, at) => settled(body, at)).map((field) => field.id) }
		}
	]);
	const ordered = chronological(body, typed);

	ordered.forEach((cells, index) => {
		const set: Record<string, Value> = { [CREATED]: now - (ordered.length - index) };
		typed.forEach((column, at) => {
			set[fieldIds[at]] = coerce(column, cells[at] ?? '');
		});
		changes.push({
			id: `r_${id.slice(2)}${index.toString(36).padStart(6, '0')}`,
			kind: 'row',
			base: baseId,
			parent: id,
			set
		});
	});

	return { id, changes };
}

export const NEW_FIELD = 'new';

export const SKIP = 'skip';

const nameKey = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Each column's field in an existing table: same name, else a new field so nothing is lost. */
export function guessTargets(columns: ColumnGuess[], fields: FieldDef[]): string[] {
	const free = fields.filter((field) => field.type !== 'formula');
	const taken = new Set<string>();

	return columns.map((column) => {
		const match = free.find(
			(field) => !taken.has(field.id) && nameKey(field.name) === nameKey(column.name)
		);
		if (match === undefined) {
			return NEW_FIELD;
		}
		taken.add(match.id);
		return match.id;
	});
}

type Mapped = { at: number; id: string; type: FieldType };

/**
 * Rows added to an existing table in one change list, each column going to `targets[index]`: a field
 * id, NEW_FIELD or SKIP. `unread` counts the cells the target's type could not hold.
 */
export function appendRows(
	ws: Workspace,
	tableId: string,
	rows: string[][],
	columns: ColumnGuess[],
	targets: string[],
	now: number = Date.now()
): { changes: Change[]; count: number; unread: number } {
	const table = ws.table(tableId);
	if (table === undefined) {
		throw new Error('table not found');
	}

	const body = rows.slice(1);
	const typed = chosenColumns(columns, body);
	const fields = new Map(ws.fields(tableId).map((field) => [field.id, field]));
	const changes: Change[] = [];
	const mapped: Mapped[] = [];
	let order = ws.nextOrder(tableId, 'field');

	targets.forEach((target, at) => {
		const column = typed[at];
		if (target === SKIP) {
			return;
		}

		if (target === NEW_FIELD) {
			const [change] = addField(ws, tableId, {
				name: column.name,
				type: column.type,
				choices: column.choices.map((name): Choice => ({ name, color: null }))
			}).changes;
			changes.push({ ...change, set: { ...change.set, order } });
			order += 1;
			mapped.push({ at, id: change.id, type: column.type });
			return;
		}

		const field = fields.get(target);
		if (field === undefined) {
			return;
		}

		if (field.auto) {
			changes.push({
				id: field.id,
				kind: 'field',
				base: field.base,
				parent: field.table,
				set: {
					type: column.type,
					auto: null,
					choices: column.choices.map((name) => ({ name, color: null }))
				}
			});
			mapped.push({ at, id: field.id, type: column.type });
			return;
		}

		if (field.type === 'choice') {
			const known = new Set(field.choices.map((choice) => choice.name));
			const fresh = distinctValues(body, at).filter((name) => !known.has(name));
			if (fresh.length > 0) {
				changes.push({
					id: field.id,
					kind: 'field',
					base: field.base,
					parent: field.table,
					set: {
						choices: [
							...field.choices.map((choice) => ({ name: choice.name, color: choice.color })),
							...fresh.map((name) => ({ name, color: null }))
						]
					}
				});
			}
		}
		mapped.push({ at, id: field.id, type: field.type });
	});

	// The column a blank table started with goes unless a file filled it.
	if (ws.rows(tableId).length === 0) {
		const filled = new Set(mapped.map((item) => item.id));
		const unfilled = [...fields.values()].filter(
			(field) => field.auto && field.name === BLANK_FIELD && !filled.has(field.id)
		);
		changes.push(
			...deleteRecords(
				ws,
				unfilled.map((field) => field.id)
			)
		);
	}

	const ordered = chronological(body, typed);
	let unread = 0;

	ordered.forEach((cells, index) => {
		const set: Record<string, Value> = { [CREATED]: now + index / 1000 };
		for (const { at, id, type } of mapped) {
			const raw = cells[at] ?? '';
			const value = coerce({ type }, raw);
			if (value === null && raw.trim() !== '') {
				unread += 1;
			}
			set[id] = value;
		}
		changes.push({ id: newId('r'), kind: 'row', base: table.base, parent: tableId, set });
	});

	return { changes, count: ordered.length, unread };
}
