import type { RowUpdate } from '#lib/core/actions.ts';
import { updateRecord, writeRows } from '#lib/core/actions.ts';
import type { Change, Choice, FieldDef, FieldType, Rec, Value } from '#lib/core/model.ts';
import { coerce, pad } from '#lib/core/values.ts';
import type { Workspace } from '#lib/core/workspace.ts';
import { nextChoice } from '#lib/ui/colors.ts';

import type { Computed } from './grid.ts';
import { cellValue } from './grid.ts';

/** Rows and columns of the grid, both ends included. */
export type Box = { top: number; bottom: number; left: number; right: number };

type Series = (index: number) => Value;

const blank = (value: Value | undefined): boolean =>
	value === null || value === undefined || value === '';

function steady(values: number[]): number | null {
	const step = values[1] - values[0];
	const close = (a: number, b: number): boolean =>
		Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
	return values.every((value, at) => at === 0 || close(value - values[at - 1], step)) ? step : null;
}

function decimals(value: number): number | null {
	const text = String(value);
	if (text.includes('e')) return null;
	const at = text.indexOf('.');
	return at < 0 ? 0 : text.length - at - 1;
}

function numberSeries(source: Value[]): Series | null {
	const numbers = source.filter((value) => typeof value === 'number');
	if (numbers.length < 2 || numbers.length !== source.length) return null;
	const step = steady(numbers);
	if (step === null) return null;
	const places = numbers.map(decimals);
	const round = places.includes(null) ? null : 10 ** Math.max(...(places as number[]));
	const last = numbers[numbers.length - 1];
	return (index) => {
		const next = last + step * (index + 1);
		return round === null ? next : Math.round(next * round) / round;
	};
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/u;

type Moment = { year: number; month: number; day: number; minutes: number | null };

function momentOf(value: Value): Moment | null {
	const match = typeof value === 'string' ? ISO.exec(value) : null;
	if (match === null) return null;
	const [, year, month, day, hours, minutes] = match;
	return {
		year: Number(year),
		month: Number(month),
		day: Number(day),
		minutes: hours === undefined ? null : Number(hours) * 60 + Number(minutes)
	};
}

function isoOf(moment: Moment): string {
	const day = `${String(moment.year).padStart(4, '0')}-${pad(moment.month)}-${pad(moment.day)}`;
	return moment.minutes === null
		? day
		: `${day}T${pad(Math.floor(moment.minutes / 60))}:${pad(moment.minutes % 60)}`;
}

function fromEpoch(minutes: number, timed: boolean): string {
	const date = new Date(minutes * 60_000);
	return isoOf({
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
		minutes: timed ? date.getUTCHours() * 60 + date.getUTCMinutes() : null
	});
}

function dateSeries(source: Value[]): Series | null {
	const moments = source.map(momentOf);
	if (moments.some((moment) => moment === null)) return null;
	const all = moments as Moment[];
	const timed = all[0].minutes !== null;
	if (all.some((moment) => (moment.minutes !== null) !== timed)) return null;
	const last = all[all.length - 1];

	const months = all.map((moment) => moment.year * 12 + moment.month - 1);
	const monthStep = all.length < 2 ? null : steady(months);
	const sameDay = all.every((moment) => moment.day === last.day && moment.minutes === last.minutes);
	if (monthStep !== null && monthStep !== 0 && sameDay) {
		return (index) => {
			const at = months[months.length - 1] + monthStep * (index + 1);
			const year = Math.floor(at / 12);
			const month = at - year * 12 + 1;
			const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
			return isoOf({ year, month, day: Math.min(last.day, length), minutes: last.minutes });
		};
	}

	const epochs = all.map(
		(moment) => Date.UTC(moment.year, moment.month - 1, moment.day) / 60_000 + (moment.minutes ?? 0)
	);
	const step = all.length < 2 ? 1440 : steady(epochs);
	if (step === null || step === 0) return null;
	const end = epochs[epochs.length - 1];
	return (index) => fromEpoch(end + step * (index + 1), timed);
}

const NUMBERED = /^(.*?)(\d+)$/su;

function textSeries(source: Value[]): Series | null {
	const parts = source.map((value) => (typeof value === 'string' ? NUMBERED.exec(value) : null));
	if (parts.some((match) => match === null)) return null;
	const matches = parts as RegExpExecArray[];
	const prefix = matches[0][1];
	if (matches.some((match) => match[1] !== prefix)) return null;
	const numbers = matches.map((match) => Number(match[2]));
	const step = numbers.length < 2 ? 1 : steady(numbers);
	if (step === null || step === 0) return null;
	const digits = matches[matches.length - 1][2];
	const width = digits.startsWith('0') ? digits.length : 1;
	const last = numbers[numbers.length - 1];
	return (index) => {
		const next = last + step * (index + 1);
		return next < 0 ? null : `${prefix}${String(next).padStart(width, '0')}`;
	};
}

/** What follows `source` when it is dragged on: the series it shows, else its cells again. */
export function nextValues(type: FieldType | null, source: Value[], count: number): Value[] {
	if (source.length === 0) return [];
	const series =
		type === null || source.some(blank)
			? null
			: type === 'number'
				? numberSeries(source)
				: type === 'date'
					? dateSeries(source)
					: type === 'text'
						? textSeries(source)
						: null;
	return Array.from({ length: count }, (_, index) =>
		series === null ? source[index % source.length] : series(index)
	);
}

function range(from: number, to: number): number[] {
	const step = from <= to ? 1 : -1;
	return Array.from({ length: Math.abs(to - from) + 1 }, (_, at) => from + at * step);
}

export type Fill = { changes: Change[]; cells: number };

/**
 * The changes that carry `from` into `to`, a box beside it in one direction.
 * `series` continues what the cells show; without it they are copied.
 */
export function fillChanges(
	ws: Workspace,
	tableId: string,
	fields: FieldDef[],
	rows: Rec[],
	computed: Computed,
	from: Box,
	to: Box,
	series = true
): Fill {
	const vertical = to.top > from.bottom || to.bottom < from.top;
	const forward = vertical ? to.top > from.bottom : to.left > from.right;
	const lines = vertical ? range(from.left, from.right) : range(from.top, from.bottom);
	const sources = vertical ? range(from.top, from.bottom) : range(from.left, from.right);
	const targets = vertical
		? forward
			? range(to.top, to.bottom)
			: range(to.bottom, to.top)
		: forward
			? range(to.left, to.right)
			: range(to.right, to.left);
	if (!forward) sources.reverse();

	const values = new Map<string, Record<string, Value>>();
	const choices = new Map<string, Choice[]>();
	let cells = 0;

	const cellAt = (line: number, at: number): { row?: Rec; field?: FieldDef } =>
		vertical ? { row: rows[at], field: fields[line] } : { row: rows[line], field: fields[at] };

	for (const line of lines) {
		const origins = sources.map((at) => cellAt(line, at));
		const source = origins.map(({ row, field }) =>
			row === undefined || field === undefined ? null : (cellValue(row, field, computed) ?? null)
		);
		const types = new Set(
			[...origins, ...targets.map((at) => cellAt(line, at))].map(({ field }) => field?.type)
		);
		const type = series && types.size === 1 ? (origins[0].field?.type ?? null) : null;
		const next = nextValues(type, source, targets.length);

		targets.forEach((at, index) => {
			const { row, field } = cellAt(line, at);
			const origin = origins[index % origins.length].field;
			if (row === undefined || field === undefined || field.type === 'formula') return;
			const raw = next[index];
			const linked = field.type !== 'link' || raw === null || origin?.target === field.target;
			const value = linked ? coerce(field, raw) : null;
			if (value === null && raw !== null && raw !== '') return;
			cells += 1;
			if (field.type === 'choice' && typeof value === 'string') {
				const known = choices.get(field.id) ?? field.choices;
				if (!known.some((choice) => choice.name === value)) {
					choices.set(field.id, [...known, nextChoice(known, value)]);
				}
			}
			if (JSON.stringify(row.data[field.id] ?? null) !== JSON.stringify(value)) {
				values.set(row.id, { ...values.get(row.id), [field.id]: value });
			}
		});
	}

	const updates: RowUpdate[] = [...values].map(([id, set]) => ({ id, values: set }));
	const fieldChanges = [...choices].flatMap(([id, list]) =>
		updateRecord(ws, id, {
			choices: list.map((choice) => ({ name: choice.name, color: choice.color }))
		})
	);
	const written = updates.length === 0 ? [] : writeRows(ws, tableId, updates, []).changes;
	return { changes: [...fieldChanges, ...written], cells };
}

/** Where a fill handle dragged to `over` reaches: the side it went furthest past, or null. */
export function fillTarget(from: Box, over: { r: number; c: number }, last: Box): Box | null {
	const down =
		over.r > from.bottom ? over.r - from.bottom : over.r < from.top ? over.r - from.top : 0;
	const across =
		over.c > from.right ? over.c - from.right : over.c < from.left ? over.c - from.left : 0;
	if (down === 0 && across === 0) return null;
	if (Math.abs(down) >= Math.abs(across)) {
		const reach = Math.max(last.top, Math.min(last.bottom, over.r));
		const box =
			down > 0
				? { ...from, top: from.bottom + 1, bottom: reach }
				: { ...from, top: reach, bottom: from.top - 1 };
		return box.top <= box.bottom ? box : null;
	}
	const reach = Math.max(last.left, Math.min(last.right, over.c));
	const box =
		across > 0
			? { ...from, left: from.right + 1, right: reach }
			: { ...from, left: reach, right: from.left - 1 };
	return box.left <= box.right ? box : null;
}
