import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Rec } from '../core/model.ts';
import type { LocalDb, Stored } from './local.ts';
import { erase, handOver, openLocal, readMeta, save } from './local.ts';

let db: LocalDb;
let opened = 0;

function entry(id: string, dirty: boolean, data: unknown = {}): Stored {
	return { id, dirty, rec: { id, data } as Rec };
}

const records = async (): Promise<string[]> => (await db.getAllKeys('records')).map(String);

beforeEach(async () => {
	opened += 1;
	db = await openLocal(`test-${opened}`);
});

describe('save', () => {
	it('stores records and meta together', async () => {
		await save(db, [entry('a', true)], { history: { undo: [], redo: [] } });

		expect(await records()).toEqual(['a']);
		expect(await readMeta(db, 'history')).toEqual({ undo: [], redo: [] });
	});

	it('stores nothing when one entry can’t be stored', async () => {
		const uncloneable = entry('b', true, { value: () => undefined });

		await expect(save(db, [entry('a', true), uncloneable], { watermark: 9 })).rejects.toThrow();

		expect(await records()).toEqual([]);
		expect(await readMeta(db, 'watermark')).toBeUndefined();
	});
});

describe('erase', () => {
	it('takes the records with what describes them, and leaves the rest', async () => {
		await save(db, [entry('a', true)], {
			watermark: 9,
			history: { undo: [], redo: [] },
			owner: 'one',
			node: 'n'
		});

		await erase(db, ['owner']);

		expect(await records()).toEqual([]);
		expect(await readMeta(db, 'watermark')).toBeUndefined();
		expect(await readMeta(db, 'history')).toBeUndefined();
		expect(await readMeta(db, 'owner')).toBeUndefined();
		expect(await readMeta(db, 'node')).toBe('n');
	});
});

describe('handOver', () => {
	it('changes nothing while a record has not reached the server', async () => {
		await save(db, [entry('a', false), entry('b', true)], { watermark: 9, owner: 'one' });

		expect(await handOver(db, 'two')).toBe(false);

		expect(await records()).toEqual(['a', 'b']);
		expect(await readMeta(db, 'watermark')).toBe(9);
		expect(await readMeta(db, 'owner')).toBe('one');
	});

	it('empties the store for the new owner once everything has', async () => {
		await save(db, [entry('a', false)], { watermark: 9, owner: 'one' });

		expect(await handOver(db, 'two')).toBe(true);

		expect(await records()).toEqual([]);
		expect(await readMeta(db, 'watermark')).toBeUndefined();
		expect(await readMeta(db, 'owner')).toBe('two');
	});
});
