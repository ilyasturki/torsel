import type { Clock } from './clock.ts';
import { merge, sameRec } from './merge.ts';
import type {
	BaseDef,
	Change,
	Choice,
	FieldDef,
	FieldType,
	Rec,
	TableDef,
	Value,
	ViewConfig,
	ViewDef,
	ViewType
} from './model.ts';
import {
	CREATED,
	DATE_STYLES,
	DELETED,
	FIELD_TYPES,
	RESULT_TYPES,
	VIEW_TYPES,
	isDeleted
} from './model.ts';

function text(value: Value | undefined, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function num(value: Value | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableText(value: Value | undefined): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

function choicesOf(value: Value | undefined): Choice[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const out: Choice[] = [];
	for (const item of value) {
		if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
			const name = item.name;
			if (typeof name === 'string' && name !== '') {
				out.push({ name, color: typeof item.color === 'string' ? item.color : null });
			}
		}
	}

	return out;
}

function decimalsOf(value: Value | undefined): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
		? value
		: null;
}

function oneOf<T extends string>(list: readonly T[], value: Value | undefined): T | null {
	return (list as readonly Value[]).includes(value ?? null) ? (value as T) : null;
}

function fieldType(value: Value | undefined): FieldType {
	return (FIELD_TYPES as readonly Value[]).includes(value ?? null) ? (value as FieldType) : 'text';
}

function viewType(value: Value | undefined): ViewType {
	return (VIEW_TYPES as readonly Value[]).includes(value ?? null) ? (value as ViewType) : 'grid';
}

function configOf(value: Value | undefined): ViewConfig {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as ViewConfig)
		: {};
}

function byOrder<T extends { order: number; name: string }>(a: T, b: T): number {
	return a.order - b.order || a.name.localeCompare(b.name);
}

export function baseDef(rec: Rec): BaseDef {
	return { id: rec.id, name: text(rec.data.name, ''), order: num(rec.data.order, 0) };
}

export function tableDef(rec: Rec): TableDef {
	return {
		id: rec.id,
		base: rec.base,
		name: text(rec.data.name, ''),
		order: num(rec.data.order, 0)
	};
}

export function fieldDef(rec: Rec): FieldDef {
	return {
		id: rec.id,
		base: rec.base,
		table: rec.parent,
		name: text(rec.data.name, ''),
		type: fieldType(rec.data.type),
		order: num(rec.data.order, 0),
		choices: choicesOf(rec.data.choices),
		target: nullableText(rec.data.target),
		expr: nullableText(rec.data.expr),
		description: nullableText(rec.data.description),
		step: typeof rec.data.step === 'number' && rec.data.step > 0 ? rec.data.step : null,
		decimals: decimalsOf(rec.data.decimals),
		grouping: rec.data.grouping !== false,
		unit: nullableText(rec.data.unit),
		currency: nullableText(rec.data.currency),
		min: typeof rec.data.min === 'number' ? rec.data.min : null,
		max: typeof rec.data.max === 'number' ? rec.data.max : null,
		seconds: rec.data.seconds === true,
		dateStyle: oneOf(DATE_STYLES, rec.data.dateStyle),
		result: oneOf(RESULT_TYPES, rec.data.result),
		auto: rec.data.auto === true
	};
}

export function viewDef(rec: Rec): ViewDef {
	return {
		id: rec.id,
		base: rec.base,
		table: rec.parent,
		name: text(rec.data.name, ''),
		type: viewType(rec.data.type),
		order: num(rec.data.order, 0),
		config: configOf(rec.data.config)
	};
}

export function createdAt(rec: Rec): number {
	return num(rec.data[CREATED], 0);
}

export type Stamped = { rec: Rec; inverse: Change };

export class Workspace {
	public readonly records = new Map<string, Rec>();

	private readonly children = new Map<string, Set<string>>();
	private readonly inBase = new Map<string, Set<string>>();
	private readonly revisions = new Map<string, number>();
	private changes = 0;

	public get(id: string): Rec | undefined {
		return this.records.get(id);
	}

	public live(id: string): Rec | undefined {
		const rec = this.records.get(id);
		return rec === undefined || isDeleted(rec) ? undefined : rec;
	}

	private index(rec: Rec): void {
		const family = `${rec.parent}/${rec.kind}`;
		let siblings = this.children.get(family);
		if (siblings === undefined) {
			siblings = new Set();
			this.children.set(family, siblings);
		}
		siblings.add(rec.id);

		let members = this.inBase.get(rec.base);
		if (members === undefined) {
			members = new Set();
			this.inBase.set(rec.base, members);
		}
		members.add(rec.id);
	}

	/** Merges a record in; true when that changed what this workspace holds. */
	public put(incoming: Rec): boolean {
		const existing = this.records.get(incoming.id);
		const merged = merge(existing, incoming);

		if (existing !== undefined && sameRec(existing, merged)) {
			return false;
		}

		this.records.set(merged.id, merged);
		if (existing === undefined) {
			this.index(merged);
		}
		if (merged.kind === 'row' || merged.kind === 'field') {
			this.revisions.set(merged.parent, (this.changes += 1));
		}

		return true;
	}

	/** Moves whenever a row or a field of the table changes: what its SQL copy is built from. */
	public revision(tableId: string): number {
		return this.revisions.get(tableId) ?? 0;
	}

	public stamp(change: Change, clock: Clock): Stamped {
		const existing = this.records.get(change.id);
		const previous: Record<string, Value> = {};

		if (existing === undefined) {
			previous[DELETED] = true;
		} else {
			for (const key of Object.keys(change.set)) {
				previous[key] = existing.data[key] ?? null;
			}
		}

		const clocks: Record<string, Clock> = {};
		for (const key of Object.keys(change.set)) {
			clocks[key] = clock;
		}

		this.put({
			id: change.id,
			kind: change.kind,
			base: change.base,
			parent: change.parent,
			data: change.set,
			clocks
		});

		return {
			rec: this.records.get(change.id) as Rec,
			inverse: {
				id: change.id,
				kind: change.kind,
				base: change.base,
				parent: change.parent,
				set: previous
			}
		};
	}

	private liveChildren(parent: string, kind: Rec['kind']): Rec[] {
		const out: Rec[] = [];

		for (const id of this.children.get(`${parent}/${kind}`) ?? []) {
			const rec = this.records.get(id);
			if (rec !== undefined && !isDeleted(rec)) {
				out.push(rec);
			}
		}

		return out;
	}

	/** Deleted ones included: what a name once held stays held. */
	public everChildren(parent: string, kind: Rec['kind']): Rec[] {
		const out: Rec[] = [];

		for (const id of this.children.get(`${parent}/${kind}`) ?? []) {
			const rec = this.records.get(id);
			if (rec !== undefined) {
				out.push(rec);
			}
		}

		return out;
	}

	public bases(): BaseDef[] {
		return this.liveChildren('', 'base').map(baseDef).sort(byOrder);
	}

	public tables(baseId: string): TableDef[] {
		return this.liveChildren(baseId, 'table').map(tableDef).sort(byOrder);
	}

	public fields(tableId: string): FieldDef[] {
		return this.liveChildren(tableId, 'field').map(fieldDef).sort(byOrder);
	}

	public views(tableId: string): ViewDef[] {
		return this.liveChildren(tableId, 'view').map(viewDef).sort(byOrder);
	}

	public rows(tableId: string): Rec[] {
		return this.liveChildren(tableId, 'row').sort(
			(a, b) => createdAt(a) - createdAt(b) || a.id.localeCompare(b.id)
		);
	}

	public base(id: string): BaseDef | undefined {
		const rec = this.live(id);
		return rec?.kind === 'base' ? baseDef(rec) : undefined;
	}

	public table(id: string): TableDef | undefined {
		const rec = this.live(id);
		return rec?.kind === 'table' && this.base(rec.base) !== undefined ? tableDef(rec) : undefined;
	}

	public field(id: string): FieldDef | undefined {
		const rec = this.live(id);
		return rec?.kind === 'field' ? fieldDef(rec) : undefined;
	}

	public view(id: string): ViewDef | undefined {
		const rec = this.live(id);
		return rec?.kind === 'view' ? viewDef(rec) : undefined;
	}

	/** Every record of a base, tombstones included: what a replica needs to hold. */
	public baseRecords(baseId: string): Rec[] {
		const out: Rec[] = [];

		for (const id of this.inBase.get(baseId) ?? []) {
			const rec = this.records.get(id);
			if (rec !== undefined) {
				out.push(rec);
			}
		}

		return out;
	}

	/** The field a row is named by: the first text field, else the first field. */
	public primaryField(tableId: string): FieldDef | undefined {
		const fields = this.fields(tableId);
		return fields.find((field) => field.type === 'text') ?? fields[0];
	}

	public rowTitle(rowId: string): string {
		const row = this.live(rowId);
		if (row === undefined) {
			return '';
		}
		const primary = this.primaryField(row.parent);
		const value = primary === undefined ? undefined : row.data[primary.id];
		return value === undefined || value === null ? '' : String(value);
	}

	public nextOrder(parent: string, kind: Rec['kind']): number {
		let max = -1;

		for (const rec of this.liveChildren(parent, kind)) {
			const order = rec.data.order;
			if (typeof order === 'number' && order > max) {
				max = order;
			}
		}

		return max + 1;
	}
}
