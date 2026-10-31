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
import type { Decision, LocalDb } from './local.ts';
import {
	decisionKey,
	erase,
	forgetDecisions,
	handOver,
	isDecisionKey,
	openLocal,
	readDecisions,
	readMeta,
	readWritten,
	save
} from './local.ts';

export type Group = {
	id: number;
	label: string;
	by: 'user' | 'ai';
	inverse: Change[];
	// The assistant's action this step applied: its thread hears each undo and redo, open or not.
	action?: string;
	thread?: string;
};

type Stacks = { undo: Group[]; redo: Group[] };

/** Tells the other tabs a transaction committed; each re-reads the store, so the store's commit order settles a race. */
type Written = { ids: string[]; decided: Decision[] } | 'restart';

const HISTORY = 50;
const HISTORY_KEY = 'history';
const SAVE_RETRY_MS = 5000;

function decisionOf(group: Group, status: Decision['status']): Decision | undefined {
	return group.action === undefined || group.thread === undefined
		? undefined
		: { thread: group.thread, id: group.action, status };
}

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
	public saveFailed = $state(false);
	public onChange: (() => void) | null = null;
	public onSynced: (() => void) | null = null;
	public onUndo: ((group: Group) => void) | null = null;
	public onRedo: ((group: Group) => void) | null = null;
	public onDecided: ((decisions: Decision[]) => void) | null = null;

	private db: LocalDb | undefined;
	private hlc = new Hlc('local');
	private engine: MemoryEngine | undefined;
	private loading: Promise<void> | undefined;
	private channel: BroadcastChannel | undefined;
	private readonly dirty = new Set<string>();
	// In memory but not on disk, each written as it stands by the next `persist`.
	private readonly unsaved = new Set<string>();
	private readonly unsavedMeta = new Map<string, unknown>();
	// The newest write to carry each meta key: a failed older one must not bring its value back.
	private readonly carried = new Map<string, number>();
	private writes = 0;
	private retry: ReturnType<typeof setTimeout> | undefined;
	// The store was just emptied and the reload hasn't taken this page yet: any write would land in it.
	private leaving = false;
	private readonly built = new Map<string, number>();
	private readonly problems = new Map<string, FormulaProblems>();
	private seq = 0;

	public load(): Promise<void> {
		this.loading ??= this.open();
		return this.loading;
	}

	private async open(): Promise<void> {
		// Before the first read: a write committed after it still reaches this tab.
		this.channel = new BroadcastChannel('torsel-store');
		this.channel.onmessage = ({ data }: MessageEvent<Written>): void => {
			void this.load().then(() => this.follow(data));
		};

		const db = await openLocal();
		this.db = db;

		// Per tab: `merge` takes equal clocks for one write.
		this.hlc = new Hlc(randomNode());

		for (const stored of await db.getAll('records')) {
			this.ws.put(stored.rec);
			this.hlc.observe(latestClock(stored.rec));
			if (stored.dirty) {
				this.dirty.add(stored.id);
			}
		}

		const saved = await readMeta<Stacks>(db, HISTORY_KEY);
		if (saved !== undefined) {
			this.adopt(saved);
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
	private stamp(changes: Change[]): Change[] {
		const inverse: Change[] = [];

		for (const change of changes) {
			const stamped = this.ws.stamp(change, this.hlc.tick());
			inverse.unshift(stamped.inverse);
			this.unsaved.add(stamped.rec.id);
			this.dirty.add(stamped.rec.id);
		}

		return inverse;
	}

	/** Starts its transaction in the caller's task and never rejects: what fails goes back to wait for the next write. */
	private persist(): Promise<void> {
		clearTimeout(this.retry);
		this.retry = undefined;
		if (this.db === undefined || this.leaving) {
			return Promise.resolve();
		}

		const ids = [...this.unsaved];
		const meta = new Map(this.unsavedMeta);
		const attempt = (this.writes += 1);
		this.unsaved.clear();
		this.unsavedMeta.clear();
		for (const key of meta.keys()) {
			this.carried.set(key, attempt);
		}

		const entries = ids.map((id) => ({
			id,
			rec: this.ws.get(id) as Rec,
			dirty: this.dirty.has(id)
		}));

		return save(this.db, entries, Object.fromEntries(meta)).then(
			() => {
				if (this.unsaved.size === 0 && this.unsavedMeta.size === 0) {
					this.saveFailed = false;
				}
				this.announce(ids, meta);
			},
			() => {
				for (const id of ids) {
					this.unsaved.add(id);
				}
				for (const [key, value] of meta) {
					if (this.carried.get(key) === attempt) {
						this.unsavedMeta.set(key, value);
					}
				}
				this.saveFailed = true;
				this.retry ??= setTimeout(() => void this.persist(), SAVE_RETRY_MS);
			}
		);
	}

	public retrySave(): void {
		void this.persist();
	}

	private announce(ids: string[], meta: Map<string, unknown>): void {
		const decided = [...meta]
			.filter(([key]) => isDecisionKey(key))
			.map(([, value]) => value as Decision);
		if (ids.length > 0 || decided.length > 0 || meta.has(HISTORY_KEY)) {
			this.channel?.postMessage({ ids, decided } satisfies Written);
		}
	}

	/** The store as another tab just left it. Memory ahead of it, from a write that lost a race, goes back. */
	private async follow(written: Written): Promise<void> {
		if (written === 'restart') {
			this.leave();
			return;
		}

		const before = this.carried.get(HISTORY_KEY);
		const { entries, meta } = await readWritten<Stacks>(
			this.db as LocalDb,
			written.ids,
			HISTORY_KEY
		);

		for (const { id, rec, dirty } of entries) {
			this.hlc.observe(latestClock(rec));
			this.ws.put(rec);
			const same = sameRec(this.ws.get(id), rec);
			if (dirty) {
				this.dirty.add(id);
			} else if (same) {
				this.dirty.delete(id);
			}
			if (!same) {
				this.unsaved.add(id);
			}
		}

		// A history write of this tab since the read, or one waiting to retry, is newer than what the read saw.
		if (
			meta !== undefined &&
			before === this.carried.get(HISTORY_KEY) &&
			!this.unsavedMeta.has(HISTORY_KEY)
		) {
			this.adopt(meta);
		}
		if (this.unsaved.size > 0 && this.retry === undefined) {
			void this.persist();
		}
		this.bump(false);
		if (written.decided.length > 0) {
			// A row still held is newer than the message, which may have been overtaken on the way.
			const held = await this.decisions();
			this.onDecided?.(
				written.decided.map((sent) => held.find(({ id }) => id === sent.id) ?? sent)
			);
		}
	}

	private adopt(stacks: Stacks): void {
		this.history = stacks.undo;
		this.undone = stacks.redo;
		this.seq = Math.max(this.seq, ...[...stacks.undo, ...stacks.redo].map((group) => group.id));
	}

	private moved(decision?: Decision): void {
		this.unsavedMeta.set(HISTORY_KEY, { undo: this.history, redo: this.undone });
		if (decision !== undefined) {
			this.unsavedMeta.set(decisionKey(decision.id), decision);
		}
		void this.persist();
		this.bump();
	}

	public apply(
		changes: Change[],
		label: string,
		by: Group['by'] = 'user',
		action?: { thread: string; id: string }
	): Group | null {
		if (changes.length === 0) {
			return null;
		}

		const inverse = this.stamp(changes);
		const group: Group = {
			id: (this.seq += 1),
			label,
			by,
			inverse,
			action: action?.id,
			thread: action?.thread
		};
		this.history = [...this.history.slice(1 - HISTORY), group];
		this.undone = [];
		this.moved(decisionOf(group, 'applied'));

		return group;
	}

	public undo(id?: number): Group | undefined {
		const group =
			id === undefined ? this.history.at(-1) : this.history.find((item) => item.id === id);
		if (group === undefined) {
			return undefined;
		}

		const inverse = this.stamp(group.inverse);
		this.history = this.history.filter((item) => item.id !== group.id);
		this.undone = [...this.undone, { ...group, inverse }];
		this.moved(decisionOf(group, 'undone'));
		this.onUndo?.(group);

		return group;
	}

	public redo(): Group | undefined {
		const group = this.undone.at(-1);
		if (group === undefined) {
			return undefined;
		}

		const inverse = this.stamp(group.inverse);
		this.undone = this.undone.slice(0, -1);
		this.history = [...this.history, { ...group, inverse }];
		this.moved(decisionOf(group, 'applied'));
		this.onRedo?.(group);

		return group;
	}

	/** A decision that changes no record: with one, `apply`, `undo` and `redo` write it in the change's transaction. */
	public decide(decision: Decision): void {
		this.unsavedMeta.set(decisionKey(decision.id), decision);
		void this.persist();
	}

	/** Every decision still owed to the server, in any thread. */
	public async decisions(): Promise<Decision[]> {
		await this.load();
		const stored = await readDecisions(this.db as LocalDb);
		const held = new Map(stored.map((decision) => [decision.id, decision]));
		for (const [key, value] of this.unsavedMeta) {
			if (isDecisionKey(key)) {
				held.set((value as Decision).id, value as Decision);
			}
		}
		return [...held.values()];
	}

	public delivered(sent: Decision[]): Promise<void> {
		return forgetDecisions(this.db as LocalDb, sent);
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
		// Each stays in `unsaved` until a write holds it: the next watermark passes it, and `put` won't report it again.
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

		this.unsavedMeta.set('watermark', watermark);
		const saved = this.persist();
		this.version += changed ? 1 : 0;
		this.pending = this.dirty.size;
		await saved;
	}

	public async meta<T>(key: string): Promise<T | undefined> {
		await this.load();
		const stored = await readMeta<T>(this.db as LocalDb, key);
		// After the read: a failing write in flight hands its value back before the read resolves.
		return this.unsavedMeta.has(key) ? (this.unsavedMeta.get(key) as T) : stored;
	}

	public async setMeta(key: string, value: unknown): Promise<void> {
		await this.load();
		this.unsavedMeta.set(key, value);
		await this.persist();
	}

	public async reset(drop: string[] = []): Promise<void> {
		await this.load();
		await erase(this.db as LocalDb, drop);
		this.restart();
	}

	/** Drops every local record for another account, unless one still has to reach the server or the disk. */
	public async handOver(owner: string): Promise<boolean> {
		await this.load();
		if (this.saveFailed || !(await handOver(this.db as LocalDb, owner))) {
			return false;
		}
		this.restart();
		return true;
	}

	private restart(): void {
		this.channel?.postMessage('restart' satisfies Written);
		this.leave();
	}

	private leave(): void {
		this.leaving = true;
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
