import type { ChartData } from '../core/chart.ts';
import { chartData } from '../core/chart.ts';
import { Hlc } from '../core/clock.ts';
import type { MemoryEngine } from '../core/engine.ts';
import { openEngine } from '../core/engine.ts';
import { latestClock, sameRec } from '../core/merge.ts';
import type { Change, ChartConfig, FieldDef, Rec } from '../core/model.ts';
import type { FormulaProblems, SqlRow, SqlValue } from '../core/sql.ts';
import { formulaProblem, formulaValues, materializeTable } from '../core/sql.ts';
import { Workspace } from '../core/workspace.ts';
import type { LocalDb, Stored } from './local.ts';
import { erase, handOver, openLocal, readMeta, save, writeMeta } from './local.ts';

export type Group = {
	id: number;
	label: string;
	by: 'user' | 'ai';
	inverse: Change[];
	// The assistant's action this step applied: the thread hears when it is undone, even after a reload.
	action?: string;
};

const HISTORY = 50;

function randomNode(): string {
	const bytes = new Uint8Array(6);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => (byte % 36).toString(36)).join('');
}

function computedRows(
	engine: MemoryEngine,
	tableId: string,
	formulas: FieldDef[]
): Map<string, SqlRow> {
	const rows = engine.all(
		`select id, ${formulas.map((field) => field.id).join(', ')} from v_${tableId}`
	);

	return new Map(rows.map((row) => [String(row.id), row]));
}

class TorselApp {
	public readonly ws = new Workspace();
	public version = $state(0);
	public ready = $state(false);
	public pending = $state(0);
	public history = $state.raw<Group[]>([]);
	public undone = $state.raw<Group[]>([]);
	public onChange: (() => void) | null = null;
	public onUndo: ((group: Group) => void) | null = null;
	public onRedo: ((group: Group) => void) | null = null;

	private db: LocalDb | undefined;
	private hlc = new Hlc('local');
	private engine: MemoryEngine | undefined;
	private loading: Promise<void> | undefined;
	private readonly dirty = new Set<string>();
	// Settled in memory but not on disk: the next watermark passes them, and `put` won't report them again.
	private readonly unsaved = new Set<string>();
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

		const saved = await readMeta<{ undo: Group[]; redo: Group[] }>(db, 'history');
		if (saved !== undefined) {
			this.history = saved.undo;
			this.undone = saved.redo;
			this.seq = Math.max(0, ...[...saved.undo, ...saved.redo].map((group) => group.id));
		}

		this.engine = await openEngine();
		this.ready = true;
		this.bump(false);
	}

	/**
	 * The landing's working table: with no local database open, `persist` writes nothing and no
	 * sync starts. The page holding it must leave by a full navigation, or /app inherits the sample.
	 */
	public openSample(
		build: (ws: Workspace, commit: (changes: Change[]) => void) => void
	): Promise<void> {
		this.loading ??= (async () => {
			build(this.ws, (changes) => {
				for (const change of changes) {
					this.ws.stamp(change, this.hlc.tick());
				}
			});
			this.engine = await openEngine();
			this.ready = true;
			this.bump(false);
		})();
		return this.loading;
	}

	private bump(changed = true): void {
		this.version += 1;
		this.pending = this.dirty.size;
		if (changed) {
			this.onChange?.();
		}
	}

	/** Stamps changes in order; what takes them back, in the order to stamp it. */
	private stamp(changes: Change[]): { inverse: Change[]; entries: Stored[] } {
		const inverse: Change[] = [];
		const entries: Stored[] = [];

		for (const change of changes) {
			const stamped = this.ws.stamp(change, this.hlc.tick());
			inverse.unshift(stamped.inverse);
			entries.push({ id: stamped.rec.id, rec: stamped.rec, dirty: true });
			this.dirty.add(stamped.rec.id);
		}

		return { inverse, entries };
	}

	private moved(entries: Stored[]): void {
		void save(this.db as LocalDb, entries, {
			history: { undo: this.history, redo: this.undone }
		});
		this.bump();
	}

	public apply(
		changes: Change[],
		label: string,
		by: Group['by'] = 'user',
		action?: string
	): Group | null {
		if (changes.length === 0) {
			return null;
		}

		const { inverse, entries } = this.stamp(changes);
		const group: Group = { id: (this.seq += 1), label, by, inverse, action };
		this.history = [...this.history.slice(1 - HISTORY), group];
		this.undone = [];
		this.moved(entries);

		return group;
	}

	public undo(id?: number): Group | undefined {
		const group =
			id === undefined ? this.history.at(-1) : this.history.find((item) => item.id === id);
		if (group === undefined) {
			return undefined;
		}

		const { inverse, entries } = this.stamp(group.inverse);
		this.history = this.history.filter((item) => item.id !== group.id);
		this.undone = [...this.undone, { ...group, inverse }];
		this.moved(entries);
		this.onUndo?.(group);

		return group;
	}

	public redo(): Group | undefined {
		const group = this.undone.at(-1);
		if (group === undefined) {
			return undefined;
		}

		const { inverse, entries } = this.stamp(group.inverse);
		this.undone = this.undone.slice(0, -1);
		this.history = [...this.history, { ...group, inverse }];
		this.moved(entries);
		this.onRedo?.(group);

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

	public async settle(pushed: Rec[], received: Rec[], watermark: number): Promise<void> {
		for (const rec of pushed) {
			const current = this.ws.get(rec.id);
			if (current !== undefined && sameRec(current, rec)) {
				this.dirty.delete(rec.id);
				this.unsaved.add(rec.id);
			}
		}

		let changed = false;
		for (const rec of received) {
			this.hlc.observe(latestClock(rec));
			if (this.ws.put(rec)) {
				changed = true;
				this.unsaved.add(rec.id);
			}
		}

		const ids = [...this.unsaved];
		const entries = ids.map((id) => ({
			id,
			rec: this.ws.get(id) as Rec,
			dirty: this.dirty.has(id)
		}));
		const saved = save(this.db as LocalDb, entries, { watermark });
		this.version += changed ? 1 : 0;
		this.pending = this.dirty.size;
		await saved;
		for (const id of ids) {
			this.unsaved.delete(id);
		}
	}

	public async meta<T>(key: string): Promise<T | undefined> {
		await this.load();
		return readMeta<T>(this.db as LocalDb, key);
	}

	public async setMeta(key: string, value: unknown): Promise<void> {
		await this.load();
		await writeMeta(this.db as LocalDb, key, value);
	}

	public async reset(drop: string[] = []): Promise<void> {
		await this.load();
		await erase(this.db as LocalDb, drop);
		this.restart();
	}

	/** Drops every local record for another account, unless one still has to reach the server. */
	public async handOver(owner: string): Promise<boolean> {
		await this.load();
		if (!(await handOver(this.db as LocalDb, owner))) {
			return false;
		}
		this.restart();
		return true;
	}

	private restart(): void {
		this.ws.records.clear();
		window.location.reload();
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

		return computedRows(this.built_(tableId), tableId, formulas);
	}

	/** `computed` for a table `ws` holds instead of this workspace, rebuilt on every call. */
	public computedIn(ws: Workspace, tableId: string): Map<string, SqlRow> {
		const formulas = ws.fields(tableId).filter((field) => field.type === 'formula');
		if (!this.ready || formulas.length === 0) {
			return new Map();
		}

		const engine = this.engine as MemoryEngine;
		materializeTable(engine, ws, tableId);
		return computedRows(engine, tableId, formulas);
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
