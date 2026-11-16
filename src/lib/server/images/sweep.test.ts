import { createHash } from 'node:crypto';

import names from '#lib/i18n/names.ts';
import { describe, expect, it } from 'vitest';

import {
	createBase,
	createTable,
	defaultViews,
	deleteRecords,
	insertRows,
	updateRecord
} from '../../core/actions.ts';
import type { ImageRef } from '../../core/images.ts';
import type { Change } from '../../core/model.ts';
import { Workspace } from '../../core/workspace.ts';
import { insertUser } from '../auth/accounts.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { writeChanges, writeUndoable } from '../db/records.ts';
import { imageInfo, receiveImagePart } from './store.ts';
import { KEPT_UNNAMED_MS, sweepImages } from './sweep.ts';

const DAY = 24 * 60 * 60 * 1000;

function png(w: number): Buffer {
	const head = Buffer.alloc(40);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
	head.writeUInt32BE(13, 8);
	head.write('IHDR', 12, 'latin1');
	head.writeUInt32BE(w, 16);
	head.writeUInt32BE(10, 20);
	return head;
}

function setup() {
	const db = createDatabase(':memory:');
	runMigrations(db);
	const userId = insertUser(db, { email: 'me@example.com' }).id;
	const actor = { user: userId, path: 'mcp' } as const;
	const ws = new Workspace();
	const write = (changes: Change[]): Change[] => writeUndoable(db, actor, ws, changes);

	const base = createBase(ws, 'Home');
	write(base.changes);
	const table = createTable(
		ws,
		base.id,
		'Movies',
		[
			{ name: 'Title', type: 'text' },
			{ name: 'Poster', type: 'image' }
		],
		() => defaultViews(names.en)
	);
	write(table.changes);
	const poster = table.fieldIds[1];

	const store = (w: number): ImageRef => {
		const bytes = png(w);
		const id = createHash('sha256').update(bytes).digest('hex');
		const got = receiveImagePart(
			db,
			{ userId, baseId: base.id, id, size: bytes.length, offset: 0, bytes },
			0
		);
		if (got.status !== 'stored') throw new Error(got.status);
		return got.ref;
	};
	const kept = (ref: ImageRef): boolean => imageInfo(db, userId, base.id, ref.id) !== undefined;
	const row = (ref: ImageRef): string => {
		const rows = insertRows(ws, table.id, [{ [poster]: [ref] }]);
		write(rows.changes);
		return rows.ids[0];
	};

	let now = Date.now();
	const sweepAfter = (days: number): number => {
		now += days * DAY;
		return sweepImages(db, new Date(now));
	};

	return { db, ws, base, table, poster, store, kept, row, write, sweepAfter, actor };
}

describe('sweepImages', () => {
	it('keeps every image a live row names, however long', () => {
		const { store, kept, row, sweepAfter } = setup();
		const dune = store(342);
		row(dune);

		expect(sweepAfter(0)).toBe(0);
		expect(sweepAfter(40)).toBe(0);
		expect(kept(dune)).toBe(true);
	});

	it('deletes an image 30 days after it left its cell, not before', () => {
		const { store, kept, row, write, ws, poster, sweepAfter } = setup();
		const dune = store(342);
		const id = row(dune);
		write(updateRecord(ws, id, { [poster]: null }));

		expect(sweepAfter(0)).toBe(0);
		expect(sweepAfter(29)).toBe(0);
		expect(kept(dune)).toBe(true);
		expect(sweepAfter(1)).toBe(1);
		expect(kept(dune)).toBe(false);
	});

	it('frees the images of a deleted row, field or base', () => {
		for (const target of ['row', 'field', 'base'] as const) {
			const { store, kept, row, write, ws, base, poster, sweepAfter } = setup();
			const dune = store(342);
			const id = row(dune);
			write(deleteRecords(ws, [target === 'row' ? id : target === 'field' ? poster : base.id]));

			sweepAfter(0);
			expect(sweepAfter(KEPT_UNNAMED_MS / DAY), target).toBe(1);
			expect(kept(dune), target).toBe(false);
		}
	});

	it('keeps an image whose deletion is undone within 30 days', () => {
		const { store, kept, row, ws, db, actor, sweepAfter } = setup();
		const dune = store(342);
		const id = row(dune);
		const undo = writeUndoable(db, actor, ws, deleteRecords(ws, [id]));

		sweepAfter(0);
		sweepAfter(20);
		writeChanges(db, actor, ws, undo);
		sweepAfter(1);

		expect(sweepAfter(40)).toBe(0);
		expect(kept(dune)).toBe(true);
	});

	it('gives an image uploaded ahead of its row the same 30 days', () => {
		const { store, kept, sweepAfter } = setup();
		const early = store(500);

		expect(sweepAfter(0)).toBe(0);
		expect(sweepAfter(29)).toBe(0);
		expect(kept(early)).toBe(true);
		expect(sweepAfter(1)).toBe(1);
	});

	it('starts the 30 days over when the same image is added again', () => {
		const { store, kept, sweepAfter } = setup();
		const early = store(500);
		sweepAfter(0);
		sweepAfter(29);

		store(500);

		expect(sweepAfter(1)).toBe(0);
		expect(sweepAfter(29)).toBe(0);
		expect(kept(early)).toBe(true);
		expect(sweepAfter(1)).toBe(1);
	});
});
