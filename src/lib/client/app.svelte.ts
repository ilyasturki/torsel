import type { ChartData } from '../core/chart.ts';
import { chartData } from '../core/chart.ts';
import { Hlc } from '../core/clock.ts';
import type { MemoryEngine } from '../core/engine.ts';
import { openEngine } from '../core/engine.ts';
import { latestClock, sameRec } from '../core/merge.ts';
import type { Change, ChartConfig, Rec } from '../core/model.ts';
import type { FormulaProblems, SqlRow, SqlValue } from '../core/sql.ts';
import { formulaProblem, formulaValues, materializeTable } from '../core/sql.ts';
import { Workspace } from '../core/workspace.ts';
import type { LocalDb, Stored } from './local.ts';
import { openLocal, putRecords, readMeta, writeMeta } from './local.ts';

export type Group = { id: number; label: string; by: 'user' | 'ai'; inverse: Change[] };

const HISTORY = 50;

function randomNode(): string {
	const bytes = new Uint8Array(6);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => (byte % 36).toString(36)).join('');
}

class TorselApp {
	public readonly ws = new Workspace();
	public version = $state(0);
	public ready = $state(false);
	public pending = $state(0);
	public history = $state.raw<Group[]>([]);
	public onChange: (() => void) | null = null;
	public onUndo: ((group: Group) => void) | null = null;

	private db: LocalDb | undefined;
	private hlc = new Hlc('local');
	private engine: MemoryEngine | undefined;
	private loading: Promise<void> | undefined;
	private readonly dirty = new Set<string>();
	private readonly built = new Map<string, number>();
	private readonly problems = new Map<string, FormulaProblems>();
	private seq = 0;

	public load(): Promise<void> {
		this.loading ??= this.open();
		return this.loading;
	}

	private async open(): Promise<void> {
		const db = await openLocal();
		this.db = db;

		let node = await readMeta<string>(db, 'node');
		if (node === undefined) {
			node = randomNode();
			await writeMeta(db, 'node', node);
		}
		this.hlc = new Hlc(node);

		for (const stored of await db.getAll('records')) {
			this.ws.put(stored.rec);
			this.hlc.observe(latestClock(stored.rec));
			if (stored.dirty) {
				this.dirty.add(stored.id);
			}
		}

		this.engine = await openEngine();
		this.ready = true;
		this.bump(false);
	}

	private bump(changed = true): void {
		this.version += 1;
		this.pending = this.dirty.size;
		if (changed) {
			this.onChange?.();
		}
	}

	private persist(entries: Stored[]): void {
		if (this.db !== undefined && entries.length > 0) {
			void putRecords(this.db, entries);
		}
	}

	public apply(changes: Change[], label: string, by: Group['by'] = 'user'): Group | null {
		if (changes.length === 0) {
			return null;
		}

		const inverse: Change[] = [];
		const entries: Stored[] = [];

		for (const change of changes) {
			const stamped = this.ws.stamp(change, this.hlc.tick());
			inverse.unshift(stamped.inverse);
			entries.push({ id: stamped.rec.id, rec: stamped.rec, dirty: true });
			this.dirty.add(stamped.rec.id);
		}

		this.persist(entries);

		const group: Group = { id: (this.seq += 1), label, by, inverse };
		this.history = [...this.history.slice(1 - HISTORY), group];
		this.bump();

		return group;
	}

	public undo(id?: number): Group | undefined {
		const group =
			id === undefined ? this.history.at(-1) : this.history.find((item) => item.id === id);
		if (group === undefined) {
			return undefined;
		}

		this.history = this.history.filter((item) => item.id !== group.id);
		const entries: Stored[] = [];
		for (const change of group.inverse) {
			const { rec } = this.ws.stamp(change, this.hlc.tick());
			entries.push({ id: rec.id, rec, dirty: true });
			this.dirty.add(rec.id);
		}
		this.persist(entries);
		this.bump();
		this.onUndo?.(group);

		return group;
	}

	public dirtyRecords(): Rec[] {
		const out: Rec[] = [];
		for (const id of this.dirty) {
			const rec = this.ws.get(id);
			if (rec !== undefined) {
				out.push(rec);
			}
		}
		return out;
	}

	public settle(pushed: Rec[], received: Rec[]): void {
		const entries = new Map<string, Stored>();

		for (const rec of pushed) {
			const current = this.ws.get(rec.id);
			if (current !== undefined && sameRec(current, rec)) {
				this.dirty.delete(rec.id);
				entries.set(rec.id, { id: rec.id, rec: current, dirty: false });
			}
		}

		let changed = false;
		for (const rec of received) {
			this.hlc.observe(latestClock(rec));
			if (this.ws.put(rec)) {
				changed = true;
				const merged = this.ws.get(rec.id) as Rec;
				entries.set(rec.id, { id: rec.id, rec: merged, dirty: this.dirty.has(rec.id) });
			}
		}

		this.persist([...entries.values()]);
		this.version += changed ? 1 : 0;
		this.pending = this.dirty.size;
	}

	public async meta<T>(key: string): Promise<T | undefined> {
		await this.load();
		return readMeta<T>(this.db as LocalDb, key);
	}

	public async setMeta(key: string, value: unknown): Promise<void> {
		await this.load();
		await writeMeta(this.db as LocalDb, key, value);
	}

	/** Drops every local record, for a device handed to another account. */
	public async reset(): Promise<void> {
		await this.load();
		const db = this.db as LocalDb;
		await db.clear('records');
		await db.delete('meta', 'watermark');
		this.ws.records.clear();
		window.location.reload();
	}

	public async forgetOwner(): Promise<void> {
		await this.load();
		await (this.db as LocalDb).delete('meta', 'owner');
	}

	private built_(tableId: string): MemoryEngine {
		const engine = this.engine as MemoryEngine;
		if (this.built.get(tableId) !== this.version) {
			this.problems.set(tableId, materializeTable(engine, this.ws, tableId));
			this.built.set(tableId, this.version);
		}
		return engine;
	}

	public formulaProblems(tableId: string): FormulaProblems {
		if (!this.ready || !this.ws.fields(tableId).some((field) => field.type === 'formula')) {
			return new Map();
		}
		this.built_(tableId);
		return this.problems.get(tableId) ?? new Map();
	}

	/** Each row's computed values, by row id then field id. */
	public computed(tableId: string): Map<string, SqlRow> {
		const formulas = this.ws.fields(tableId).filter((field) => field.type === 'formula');
		if (!this.ready || formulas.length === 0) {
			return new Map();
		}

		const rows = this.built_(tableId).all(
			`select id, ${formulas.map((field) => field.id).join(', ')} from v_${tableId}`
		);

		return new Map(rows.map((row) => [String(row.id), row]));
	}

	public chart(tableId: string, config: ChartConfig): ChartData | null {
		if (!this.ready) {
			return null;
		}
		return chartData(this.built_(tableId), this.ws, tableId, config);
	}

	public checkFormula(tableId: string, stored: string): string | null {
		return this.ready ? formulaProblem(this.built_(tableId), this.ws, tableId, stored) : null;
	}

	public formulaPreview(tableId: string, stored: string): Map<string, SqlValue> {
		return this.ready ? formulaValues(this.built_(tableId), this.ws, tableId, stored) : new Map();
	}

	public sql(tableId: string, sql: string): SqlRow[] {
		return this.ready ? this.built_(tableId).all(sql) : [];
	}
}

export const app = new TorselApp();
