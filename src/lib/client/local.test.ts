import 'fake-indexeddb/auto';

import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ImageRef } from '../core/images.ts';
import type { Rec } from '../core/model.ts';
import type { Decision, LocalDb, Stored } from './local.ts';
import {
	decisionKey,
	erase,
	forgetDecisions,
	handOver,
	keepImage,
	openLocal,
	readDecisions,
	readImage,
	readMeta,
	readOutbox,
	readWritten,
	save,
	sent
} from './local.ts';

let db: LocalDb;
let opened = 0;

const poster: ImageRef = { id: 'a'.repeat(64), type: 'image/jpeg', w: 2, h: 3, size: 1 };

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

const undone: Decision = { thread: 't', id: 'x', status: 'undone' };

describe('decisions', () => {
	it('are written with the change, and fail with it', async () => {
		const uncloneable = entry('b', true, { value: () => undefined });

		await expect(save(db, [uncloneable], { [decisionKey('x')]: undone })).rejects.toThrow();
		expect(await readDecisions(db)).toEqual([]);

		await save(db, [entry('a', true)], { [decisionKey('x')]: undone, owner: 'one' });
		expect(await readDecisions(db)).toEqual([undone]);
	});

	it('are forgotten once delivered, unless the status moved on meanwhile', async () => {
		const other: Decision = { thread: 't', id: 'y', status: 'applied' };
		await save(db, [], { [decisionKey('x')]: undone, [decisionKey('y')]: other });

		await forgetDecisions(db, [{ ...undone, status: 'applied' }, other]);

		expect(await readDecisions(db)).toEqual([undone]);
	});
});

describe('readWritten', () => {
	it('reads the records named and the meta key, skipping a record that is gone', async () => {
		await save(db, [entry('a', true), entry('b', false)], { history: 'stacks' });

		const { entries, meta } = await readWritten(db, ['a', 'gone'], 'history');

		expect(entries.map((stored) => stored.id)).toEqual(['a']);
		expect(meta).toBe('stacks');
	});
});

describe('erase', () => {
	it('takes the records with what describes them, and leaves the rest', async () => {
		await save(db, [entry('a', true)], {
			watermark: 9,
			history: { undo: [], redo: [] },
			owner: 'one',
			node: 'n',
			[decisionKey('x')]: undone
		});

		await erase(db, ['owner']);

		expect(await records()).toEqual([]);
		expect(await readMeta(db, 'watermark')).toBeUndefined();
		expect(await readMeta(db, 'history')).toBeUndefined();
		expect(await readMeta(db, 'owner')).toBeUndefined();
		expect(await readDecisions(db)).toEqual([]);
		expect(await readMeta(db, 'node')).toBe('n');
	});

	it('takes the images and the ones waiting to leave', async () => {
		await keepImage(db, poster, new Blob(['x']), 'b_home');

		await erase(db);

		expect(await readImage(db, poster.id)).toBeUndefined();
		expect(await readOutbox(db)).toEqual([]);
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

	it('changes nothing while a decision has not reached the server', async () => {
		await save(db, [entry('a', false)], { owner: 'one', [decisionKey('x')]: undone });

		expect(await handOver(db, 'two')).toBe(false);

		expect(await records()).toEqual(['a']);
		expect(await readMeta(db, 'owner')).toBe('one');
	});

	it('changes nothing while an image has not reached the server', async () => {
		await save(db, [entry('a', false)], { owner: 'one' });
		await keepImage(db, poster, new Blob(['x']), 'b_home');

		expect(await handOver(db, 'two')).toBe(false);
		await sent(db, 'b_home', poster.id);
		expect(await handOver(db, 'two')).toBe(true);
	});

	it('empties the store for the new owner once everything has', async () => {
		await save(db, [entry('a', false)], { watermark: 9, owner: 'one' });

		expect(await handOver(db, 'two')).toBe(true);

		expect(await records()).toEqual([]);
		expect(await readMeta(db, 'watermark')).toBeUndefined();
		expect(await readMeta(db, 'owner')).toBe('two');
	});
});

describe('openLocal', () => {
	it('upgrades a store of the first version and keeps its unsent records', async () => {
		const name = `old-${opened}`;
		const old = await openDB(name, 1, {
			upgrade(store) {
				store.createObjectStore('records', { keyPath: 'id' });
				store.createObjectStore('meta');
			}
		});
		await old.put('records', entry('a', true));
		await old.put('meta', 4, 'watermark');
		old.close();

		const upgraded = await openLocal(name);
		await keepImage(upgraded, poster, new Blob(['x']), 'b_home');

		expect(await upgraded.get('records', 'a')).toEqual(entry('a', true));
		expect(await readMeta(upgraded, 'watermark')).toBe(4);
		expect((await readOutbox(upgraded)).map((item) => item.ref.id)).toEqual([poster.id]);
		upgraded.close();
	});
});
