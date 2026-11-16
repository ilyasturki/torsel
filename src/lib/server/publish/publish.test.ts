import type { RequestEvent } from '@sveltejs/kit';
import { isHttpError } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	addField,
	createBase,
	createTable,
	createView,
	insertRows,
	updateRecord
} from '../../core/actions.ts';
import type { Actor } from '../../core/access.ts';
import { Hlc } from '../../core/clock.ts';
import type { Change } from '../../core/model.ts';
import type { Published } from '../../core/published.ts';
import { openPublished } from '../../core/published.ts';
import { Workspace } from '../../core/workspace.ts';
import { createUser } from '../auth/accounts.ts';
import { resetRateLimits } from '../auth/rate-limit.ts';
import type { Database } from '../db/client.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { loadWorkspace, writeChanges } from '../db/records.ts';
import { blobs } from '../db/schema.ts';

const shared = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock('../db/client.ts', async (original) => ({
	...(await original<typeof import('../db/client.ts')>()),
	getDatabase: () => shared.db
}));

const { POST: publishedPost } = await import('../../../routes/api/published/+server.ts');
const { GET: listGet, POST: publishPost } =
	await import('../../../routes/api/publications/+server.ts');
const { DELETE: unpublishDelete } =
	await import('../../../routes/api/publications/[view]/+server.ts');
const { GET: fileGet } = await import('../../../routes/v/[token]/files/[id]/+server.ts');

type Handler = (event: RequestEvent) => Promise<Response> | Response;

const SHOWN_IMAGE = 'a'.repeat(64);
const FILTERED_IMAGE = 'b'.repeat(64);
const HIDDEN_IMAGE = 'c'.repeat(64);

let db: Database;
let userId: string;
let ws: Workspace;
let actor: Actor;

const event = (init: Partial<RequestEvent> & { body?: unknown; signedIn?: boolean }) =>
	({
		request: new Request('https://torsel.test/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(init.body ?? {})
		}),
		params: {},
		getClientAddress: () => '203.0.113.7',
		locals: { credential: init.signedIn === false ? null : { user: { id: userId } } },
		...init
	}) as unknown as RequestEvent;

async function call(handler: unknown, init: Parameters<typeof event>[0]): Promise<Response> {
	try {
		return await (handler as Handler)(event(init));
	} catch (thrown) {
		if (isHttpError(thrown))
			return new Response(JSON.stringify(thrown.body), { status: thrown.status });
		throw thrown;
	}
}

function commit(changes: Change[]): void {
	writeChanges(db, actor, ws, changes);
}

type Garden = {
	ids: string[];
	grid: string;
	list: string;
	light: string;
	minty: string;
	chart: string;
	entry: string;
};

function plant(): Garden {
	const base = createBase(ws, 'Garden');
	commit(base.changes);

	const pots = createTable(ws, base.id, 'Pots', [{ name: 'Name', type: 'text' }], () => []);
	commit(pots.changes);
	const potRows = insertRows(ws, pots.id, [
		{ [pots.fieldIds[0]]: 'Clay pot' },
		{ [pots.fieldIds[0]]: 'SENTINEL unlinked pot' }
	]);
	commit(potRows.changes);

	const plants = createTable(
		ws,
		base.id,
		'Plants',
		[
			{ name: 'Name', type: 'text' },
			{ name: 'SENTINEL secret field', type: 'text' },
			{ name: 'Hidden number', type: 'number' },
			{ name: 'Kg', type: 'number' },
			{
				name: 'Kind',
				type: 'choice',
				choices: [
					{ name: 'Herb', color: null },
					{ name: 'SENTINEL unused choice', color: null }
				]
			},
			{ name: 'Pot', type: 'link', target: pots.id },
			{ name: 'Photo', type: 'image' },
			{ name: 'Receipt', type: 'image' }
		],
		() => []
	);
	commit(plants.changes);
	const [name, secret, hiddenNumber, kg, kind, pot, photo, receipt] = plants.fieldIds;
	const double = addField(ws, plants.id, {
		name: 'Double',
		type: 'formula',
		expr: `{{${hiddenNumber}}} * 2`
	});
	commit(double.changes);

	const image = (id: string) => [{ id, type: 'image/png', w: 1, h: 1, size: 4 }];
	const rows = insertRows(ws, plants.id, [
		{
			[name]: 'Basil xq',
			[secret]: 'SENTINEL hidden basil',
			[hiddenNumber]: 4242,
			[kg]: 2,
			[kind]: 'Herb',
			[pot]: potRows.ids[0],
			[photo]: image(SHOWN_IMAGE),
			[receipt]: image(HIDDEN_IMAGE)
		},
		{ [name]: 'Banana xq', [secret]: 'SENTINEL hidden banana', [kg]: 5 },
		{ [name]: 'Mint', [kg]: 9, [photo]: image(FILTERED_IMAGE) }
	]);
	commit(rows.changes);

	const grid = createView(ws, plants.id, {
		name: 'Public',
		type: 'grid',
		config: {
			hidden: [secret, hiddenNumber, receipt],
			filters: [{ field: name, op: 'contains', value: 'xq' }],
			sort: [{ field: kg, dir: 'desc' }],
			widths: { [secret]: 333, [name]: 222 }
		}
	});
	const list = createView(ws, plants.id, {
		name: 'Cards',
		type: 'list',
		config: { title: name, show: [kg], group: null }
	});
	const chart = createView(ws, plants.id, {
		name: 'Weight',
		type: 'chart',
		config: { kind: 'bar', x: kind, agg: 'sum', y: kg }
	});
	const entry = createView(ws, plants.id, { name: 'Log', type: 'entry' });
	const light = createView(ws, plants.id, {
		name: 'Light',
		type: 'list',
		config: { title: name, show: [kg], filters: [{ field: kg, op: 'lt', value: 5 }] }
	});
	const minty = createView(ws, plants.id, {
		name: 'Minty',
		type: 'chart',
		config: {
			kind: 'bar',
			x: kind,
			agg: 'sum',
			y: kg,
			filters: [{ field: name, op: 'contains', value: 'Mint' }]
		}
	});
	for (const view of [grid, list, chart, entry, light, minty]) commit(view.changes);

	for (const id of [SHOWN_IMAGE, FILTERED_IMAGE, HIDDEN_IMAGE]) {
		db.insert(blobs)
			.values({
				userId,
				baseId: base.id,
				id,
				type: 'image/png',
				size: 4,
				w: 1,
				h: 1,
				data: Buffer.from(id.slice(0, 4)),
				createdAt: new Date()
			})
			.run();
	}

	return {
		ids: [...ws.records.keys()],
		grid: grid.id,
		list: list.id,
		light: light.id,
		minty: minty.id,
		chart: chart.id,
		entry: entry.id
	};
}

async function publishView(view: string): Promise<string> {
	const response = await call(publishPost, { body: { view } });
	expect(response.status).toBe(200);
	return ((await response.json()) as { token: string }).token;
}

async function fetchPublished(token: string): Promise<{ status: number; text: string }> {
	const response = await call(publishedPost, { body: { token }, signedIn: false });
	return { status: response.status, text: await response.text() };
}

beforeEach(async () => {
	db = createDatabase(':memory:');
	runMigrations(db);
	shared.db = db;
	userId = (await createUser(db, 'owner@example.com', 'correct horse')).id;
	actor = { user: userId, path: 'device' };
	ws = loadWorkspace(db, userId);
	resetRateLimits();
});

afterEach(() => {
	vi.restoreAllMocks();
});

function expectNoLeak(text: string, garden: Garden): void {
	expect(text).not.toMatch(/SENTINEL/u);
	expect(text).not.toContain('{{');
	expect(text).not.toContain('clocks');
	expect(text).not.toMatch(/[0-9a-z]{9}\.[0-9a-z]{4}\.srv/u);
	for (const id of garden.ids) expect(text).not.toContain(id);
}

describe('a published grid', () => {
	it('sends only what the view shows, under fresh ids', async () => {
		const garden = plant();
		const { status, text } = await fetchPublished(await publishView(garden.grid));

		expect(status).toBe(200);
		expectNoLeak(text, garden);
		expect(text).not.toContain('Mint');
		expect(text).not.toContain('Hidden number');
		expect(text).not.toContain(HIDDEN_IMAGE);
		expect(text).not.toContain(FILTERED_IMAGE);
		expect(text).not.toContain('4242');
		expect(text).not.toContain('333');

		const published = JSON.parse(text) as Published;
		expect(Object.keys(published.view.config)).toEqual(['widths']);
		expect(published.fields.map((field) => field.data.name)).toEqual([
			'Name',
			'Kg',
			'Kind',
			'Pot',
			'Photo',
			'Double'
		]);

		const { changes, computed } = openPublished(published);
		const page = new Workspace();
		const hlc = new Hlc('page');
		for (const change of changes) page.stamp(change, hlc.tick());
		const [name, , , pot] = published.fields.map((field) => field.id);
		const rows = page.rows(published.table.id);
		expect(rows.map((row) => row.data[name])).toEqual(['Banana xq', 'Basil xq']);
		expect(page.rowTitle(String(rows[1].data[pot]))).toBe('Clay pot');
		const double = published.fields.at(-1)?.id ?? '';
		expect(computed.get(rows[1].id)?.[double]).toBe(8484);
		expect(published.targets.flatMap((target) => target.rows.map((row) => row.title))).toEqual([
			'Clay pot'
		]);
	});

	it('serves an image only a shown cell holds', async () => {
		const garden = plant();
		const token = await publishView(garden.grid);
		const file = (id: string) => call(fileGet, { params: { token, id }, signedIn: false });

		expect((await file(SHOWN_IMAGE)).status).toBe(200);
		expect((await file(FILTERED_IMAGE)).status).toBe(404);
		expect((await file(HIDDEN_IMAGE)).status).toBe(404);
	});

	it('drops a field the owner hides from the next request on', async () => {
		const garden = plant();
		const token = await publishView(garden.grid);
		expect((await fetchPublished(token)).text).toContain('"Kg"');

		const view = ws.view(garden.grid);
		const kg = ws.fields(view?.table ?? '').find((field) => field.name === 'Kg')?.id ?? '';
		commit(
			updateRecord(ws, garden.grid, {
				config: { ...view?.config, hidden: [...(view?.config.hidden ?? []), kg] }
			})
		);
		expect((await fetchPublished(token)).text).not.toContain('"Kg"');
	});

	it('stops at once when unpublished', async () => {
		const garden = plant();
		const token = await publishView(garden.grid);
		expect((await fetchPublished(token)).status).toBe(200);

		const listed = await call(listGet, {});
		expect(await listed.json()).toEqual([{ view: garden.grid, token }]);
		expect(await publishView(garden.grid)).toBe(token);

		await call(unpublishDelete, { params: { view: garden.grid } });
		expect((await fetchPublished(token)).status).toBe(404);
		const file = await call(fileGet, {
			params: { token, id: SHOWN_IMAGE },
			signedIn: false
		});
		expect(file.status).toBe(404);
	});
});

describe('a published list and chart', () => {
	it('sends a list with its laid-out fields alone', async () => {
		const garden = plant();
		const { text } = await fetchPublished(await publishView(garden.list));
		expectNoLeak(text, garden);
		const published = JSON.parse(text) as Published;
		expect(published.fields.map((field) => field.data.name)).toEqual(['Name', 'Kg']);
		expect(published.rows).toHaveLength(3);
	});

	it('sends only the rows a filter keeps, and charts only those', async () => {
		const garden = plant();
		const list = JSON.parse(
			(await fetchPublished(await publishView(garden.light))).text
		) as Published;
		expect(list.rows).toHaveLength(1);
		const chart = JSON.parse(
			(await fetchPublished(await publishView(garden.minty))).text
		) as Published;
		expect(chart.chart?.points ?? []).toEqual([]);
	});

	it('sends a chart as figures, never its rows', async () => {
		const garden = plant();
		const { text } = await fetchPublished(await publishView(garden.chart));
		expectNoLeak(text, garden);
		expect(text).not.toContain('Basil');
		const published = JSON.parse(text) as Published;
		expect(published.rows).toEqual([]);
		expect(published.chart?.points).toEqual([{ x: 'Herb', series: '', y: 2 }]);
	});
});

describe('publishing', () => {
	it('refuses an entry view, and a token that opens nothing reads the same as a revoked one', async () => {
		const garden = plant();
		expect((await call(publishPost, { body: { view: garden.entry } })).status).toBe(404);
		const unknown = await fetchPublished('A'.repeat(22));
		const malformed = await fetchPublished('nope');
		expect(unknown).toEqual(malformed);
		expect(unknown.status).toBe(404);
	});

	it('refuses anyone past the rate limit', async () => {
		const garden = plant();
		const token = await publishView(garden.grid);
		let last = 0;
		for (let tries = 0; tries < 61; tries += 1) last = (await fetchPublished(token)).status;
		expect(last).toBe(429);
	});
});
