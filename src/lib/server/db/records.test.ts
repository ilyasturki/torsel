import { describe, expect, it } from 'vitest';

import { createBase, createTable, insertRows, updateRecord } from '../../core/actions.ts';
import { Hlc } from '../../core/clock.ts';
import type { Rec } from '../../core/model.ts';
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
		const table = createTable(phone.ws, base.id, 'Séries', [
			{ name: 'Poids', type: 'number' },
			{ name: 'Reps', type: 'number' }
		]);
		act(phone, table.changes);
		const [poids, reps] = table.fieldIds;
		const rows = insertRows(phone.ws, table.id, [{ [poids]: 80, [reps]: 6 }]);
		act(phone, rows.changes);

		const first = syncExchange(db, userId, { watermark: 0, push: [...phone.pending.values()] });
		phone.pending.clear();
		expect(first.records).toHaveLength(0);

		const pulled = syncExchange(db, userId, { watermark: 0, push: [] });
		for (const rec of pulled.records) {
			laptop.ws.put(rec);
		}
		expect(laptop.ws.rows(table.id)).toHaveLength(1);

		act(phone, updateRecord(phone.ws, rows.ids[0], { [poids]: 82.5 }));
		act(laptop, updateRecord(laptop.ws, rows.ids[0], { [reps]: 7 }));

		syncExchange(db, userId, { watermark: first.watermark, push: [...phone.pending.values()] });
		const back = syncExchange(db, userId, {
			watermark: pulled.watermark,
			push: [...laptop.pending.values()]
		});

		const merged = back.records.find((rec) => rec.id === rows.ids[0]);
		expect(merged?.data[poids]).toBe(82.5);
		expect(merged?.data[reps]).toBe(7);
	});

	it('stamps server writes after the edits they touch', async () => {
		const { db, userId } = await setup();
		const phone = device('phone');
		const base = createBase(phone.ws, 'B');
		act(phone, base.changes);
		syncExchange(db, userId, { watermark: 0, push: [...phone.pending.values()] });

		const ws = loadWorkspace(db, userId, base.id);
		writeChanges(db, userId, ws, updateRecord(ws, base.id, { name: 'Renommée' }));

		expect(loadWorkspace(db, userId).base(base.id)?.name).toBe('Renommée');
	});
});
