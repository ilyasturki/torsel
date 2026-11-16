import names from '#lib/i18n/names.ts';
import { describe, expect, it, vi } from 'vitest';

import {
	createBase,
	createTable,
	defaultViews,
	insertRows,
	updateRecord
} from '../../core/actions.ts';
import type { Actor } from '../../core/access.ts';
import { PATH, SOURCE } from '../../core/access.ts';
import { Hlc } from '../../core/clock.ts';
import { sameRec } from '../../core/merge.ts';
import type { Rec } from '../../core/model.ts';
import { isDeleted } from '../../core/model.ts';
import { Workspace } from '../../core/workspace.ts';
import { createUser } from '../auth/accounts.ts';
import { createDatabase } from './client.ts';
import { runMigrations } from './migrate.ts';
import { loadWorkspace, syncExchange, writeChanges } from './records.ts';

async function setup(): Promise<{ db: ReturnType<typeof createDatabase>; userId: string }> {
	const db = createDatabase(':memory:');
	runMigrations(db);
	const user = await createUser(db, 'me@example.com', 'correct horse');
	return { db, userId: user.id };
}

function device(node: string): { ws: Workspace; hlc: Hlc; pending: Map<string, Rec> } {
	return { ws: new Workspace(), hlc: new Hlc(node), pending: new Map() };
}

function act(dev: ReturnType<typeof device>, changes: ReturnType<typeof updateRecord>): void {
	for (const change of changes) {
		const { rec } = dev.ws.stamp(change, dev.hlc.tick());
		dev.pending.set(rec.id, rec);
	}
}

describe('sync', () => {
	it('keeps both edits when two devices change different cells of one row', async () => {
		const { db, userId } = await setup();
		const phone = device('phone');
		const laptop = device('laptop');

		const base = createBase(phone.ws, 'Muscu');
		act(phone, base.changes);
		const table = createTable(
			phone.ws,
			base.id,
			'Séries',
			[
				{ name: 'Poids', type: 'number' },
				{ name: 'Reps', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		act(phone, table.changes);
		const [poids, reps] = table.fieldIds;
		const rows = insertRows(phone.ws, table.id, [{ [poids]: 80, [reps]: 6 }]);
		act(phone, rows.changes);

		const first = syncExchange(
			db,
			{ user: userId, path: 'device' },
			{ watermark: 0, push: [...phone.pending.values()] }
		);
		phone.pending.clear();
		expect(first.records).toHaveLength(0);

		const pulled = syncExchange(db, { user: userId, path: 'device' }, { watermark: 0, push: [] });
		for (const rec of pulled.records) {
			laptop.ws.put(rec);
		}
		expect(laptop.ws.rows(table.id)).toHaveLength(1);

		act(phone, updateRecord(phone.ws, rows.ids[0], { [poids]: 82.5 }));
		act(laptop, updateRecord(laptop.ws, rows.ids[0], { [reps]: 7 }));

		syncExchange(
			db,
			{ user: userId, path: 'device' },
			{ watermark: first.watermark, push: [...phone.pending.values()] }
		);
		const back = syncExchange(
			db,
			{ user: userId, path: 'device' },
			{
				watermark: pulled.watermark,
				push: [...laptop.pending.values()]
			}
		);

		const merged = back.records.find((rec) => rec.id === rows.ids[0]);
		expect(merged?.data[poids]).toBe(82.5);
		expect(merged?.data[reps]).toBe(7);
	});

	it('stamps server writes after the edits they touch', async () => {
		const { db, userId } = await setup();
		const phone = device('phone');
		const base = createBase(phone.ws, 'B');
		act(phone, base.changes);
		syncExchange(
			db,
			{ user: userId, path: 'device' },
			{ watermark: 0, push: [...phone.pending.values()] }
		);

		const ws = loadWorkspace(db, userId, base.id);
		writeChanges(
			db,
			{ user: userId, path: 'mcp' },
			ws,
			updateRecord(ws, base.id, { name: 'Renommée' })
		);

		expect(loadWorkspace(db, userId).base(base.id)?.name).toBe('Renommée');
	});

	it('orders two server writes made in the same millisecond from the same snapshot', async () => {
		const { db, userId } = await setup();
		const phone = device('phone');
		const base = createBase(phone.ws, 'B');
		act(phone, base.changes);
		syncExchange(
			db,
			{ user: userId, path: 'device' },
			{ watermark: 0, push: [...phone.pending.values()] }
		);

		const first = loadWorkspace(db, userId);
		const second = loadWorkspace(db, userId);
		const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
		try {
			writeChanges(
				db,
				{ user: userId, path: 'mcp' },
				first,
				updateRecord(first, base.id, { name: 'First' })
			);
			writeChanges(
				db,
				{ user: userId, path: 'mcp' },
				second,
				updateRecord(second, base.id, { name: 'Second' })
			);
		} finally {
			now.mockRestore();
		}

		expect(loadWorkspace(db, userId).base(base.id)?.name).toBe('Second');
	});
});

describe('access on the server merge', () => {
	async function sourced() {
		const { db, userId } = await setup();
		const phone = device('phone');
		const base = createBase(phone.ws, 'Films');
		act(phone, base.changes);
		const table = createTable(
			phone.ws,
			base.id,
			'Movies',
			[
				{ name: 'Title', type: 'text' },
				{ name: 'Notes', type: 'text' }
			],
			() => defaultViews(names.en)
		);
		act(phone, table.changes);
		const [title, notes] = table.fieldIds;
		const person: Actor = { user: userId, path: 'device' };
		const rows = insertRows(phone.ws, table.id, [{ [title]: 'Alien' }]);
		act(phone, rows.changes);
		const exchange = (watermark: number) => {
			const response = syncExchange(db, person, { watermark, push: [...phone.pending.values()] });
			phone.pending.clear();
			for (const rec of response.records) phone.ws.put(rec);
			return response;
		};
		const first = exchange(0);
		const lock = (): void => {
			const ws = loadWorkspace(db, userId);
			writeChanges(db, { user: userId, path: 'connector' }, ws, [
				...updateRecord(ws, table.id, { [SOURCE]: { kind: 'rss' } }),
				...updateRecord(ws, title, { [PATH]: 'title' })
			]);
		};
		return {
			db,
			userId,
			phone,
			exchange,
			lock,
			watermark: first.watermark,
			table: table.id,
			title,
			notes,
			row: rows.ids[0]
		};
	}

	it('stamps the stored value back over an offline edit of a source field, and the device converges', async () => {
		const s = await sourced();
		act(s.phone, updateRecord(s.phone.ws, s.row, { [s.title]: 'Aliens', [s.notes]: 'seen twice' }));
		s.lock();

		const answer = s.exchange(s.watermark);

		expect(answer.refused).toEqual([{ id: s.row, keys: [s.title] }]);
		const stored = loadWorkspace(s.db, s.userId).get(s.row);
		expect(stored?.data[s.title]).toBe('Alien');
		expect(stored?.data[s.notes]).toBe('seen twice');
		expect(sameRec(s.phone.ws.get(s.row), stored)).toBe(true);

		s.phone.pending.set(s.row, s.phone.ws.get(s.row) as Rec);
		const again = s.exchange(answer.watermark);
		expect(again.records).toEqual([]);
		expect(again.refused).toEqual([]);
	});

	it('writes nothing for a replay its own stamp already outran', async () => {
		const s = await sourced();
		act(s.phone, updateRecord(s.phone.ws, s.row, { [s.title]: 'Aliens' }));
		const refused = s.phone.ws.get(s.row) as Rec;
		s.lock();
		const answer = s.exchange(s.watermark);

		s.phone.pending.set(s.row, refused);
		const replay = s.exchange(answer.watermark);
		expect(replay.refused).toEqual([]);
		expect(replay.records.map((rec) => rec.id)).toEqual([s.row]);
	});

	it('tombstones a row the device added to a source table', async () => {
		const s = await sourced();
		s.lock();
		s.exchange(s.watermark);
		const added = insertRows(s.phone.ws, s.table, [{ [s.notes]: 'mine' }]);
		act(s.phone, added.changes);

		const answer = s.exchange(s.watermark);

		expect(answer.refused.map((refusal) => refusal.id)).toEqual(added.ids);
		expect(isDeleted(s.phone.ws.get(added.ids[0]) as Rec)).toBe(true);
		expect(
			loadWorkspace(s.db, s.userId)
				.rows(s.table)
				.map((row) => row.id)
		).toEqual([s.row]);
	});

	it('tombstones a row added to a source table even when it carries no key', async () => {
		const s = await sourced();
		s.lock();
		const answer = s.exchange(s.watermark);
		const base = s.phone.ws.get(s.table)?.base as string;
		const ghost: Rec = { id: 'r_ghost', kind: 'row', base, parent: s.table, data: {}, clocks: {} };
		s.phone.ws.put(ghost);
		s.phone.pending.set(ghost.id, ghost);

		const refused = s.exchange(answer.watermark);

		expect(refused.refused.map((refusal) => refusal.id)).toEqual([ghost.id]);
		expect(isDeleted(s.phone.ws.get(ghost.id) as Rec)).toBe(true);
		expect(
			loadWorkspace(s.db, s.userId)
				.rows(s.table)
				.map((row) => row.id)
		).toEqual([s.row]);
	});

	it('keeps a server write off a source field and lets a connector write it', async () => {
		const s = await sourced();
		s.lock();
		const ws = loadWorkspace(s.db, s.userId);
		writeChanges(
			s.db,
			{ user: s.userId, path: 'mcp' },
			ws,
			updateRecord(ws, s.row, { [s.title]: 'Prometheus', [s.notes]: 'meh' })
		);
		let stored = loadWorkspace(s.db, s.userId).get(s.row);
		expect(stored?.data[s.title]).toBe('Alien');
		expect(stored?.data[s.notes]).toBe('meh');

		const fresh = loadWorkspace(s.db, s.userId);
		writeChanges(
			s.db,
			{ user: s.userId, path: 'connector' },
			fresh,
			updateRecord(fresh, s.row, { [s.title]: 'Alien³' })
		);
		stored = loadWorkspace(s.db, s.userId).get(s.row);
		expect(stored?.data[s.title]).toBe('Alien³');
	});

	it('keeps a device from giving its own field a path', async () => {
		const s = await sourced();
		act(s.phone, updateRecord(s.phone.ws, s.notes, { [PATH]: 'notes' }));
		const answer = s.exchange(s.watermark);
		expect(answer.refused).toEqual([{ id: s.notes, keys: [PATH] }]);
		expect(s.phone.ws.get(s.notes)?.data[PATH]).toBeNull();
	});
});
