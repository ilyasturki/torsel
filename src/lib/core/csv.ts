import type { FieldSpec } from './actions.ts';
import { createTable } from './actions.ts';
import type { Change, FieldType, Value } from './model.ts';
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
		const base = raw.trim() === '' ? `Colonne ${index + 1}` : raw.trim();
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

export function importTable(
	ws: Workspace,
	baseId: string,
	name: string,
	rows: string[][],
	columns: ColumnGuess[] = guessColumns(rows),
	now: number = Date.now()
): { id: string; changes: Change[] } {
	const { id, fieldIds, changes } = createTable(ws, baseId, name, fieldSpecs(columns));
	const body = rows.slice(1);

	body.forEach((cells, index) => {
		const set: Record<string, Value> = { [CREATED]: now - (body.length - index) };
		columns.forEach((column, at) => {
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
