import { cell, expect, seedLifts, test } from './harness.ts';

test('a token from Settings reads and writes rows over the REST API', async ({ page, account }) => {
	void account;
	const path = await seedLifts(page.request);
	await page.goto('/app/settings');
	const agents = page
		.locator('section')
		.filter({ has: page.getByRole('heading', { name: 'Agents (MCP)' }) });
	await expect(agents.locator('code', { hasText: /^\S+\/api\/v1$/u })).toBeVisible();
	await expect(agents.getByRole('link', { name: 'API docs' })).toHaveAttribute(
		'href',
		/\/docs\/api$/u
	);

	await agents.getByRole('textbox', { name: 'Token name' }).fill('Shortcut');
	await agents.getByRole('button', { name: 'Create token' }).click();
	const command = await agents.locator('code', { hasText: 'Authorization: Bearer' }).innerText();
	const token = /Bearer (ts_[\w-]+)/u.exec(command)?.[1];
	const headers = { authorization: `Bearer ${token}` };
	const rows = '/api/v1/bases/Gym/tables/Lifts/rows';

	// The page's own cookie must not count: only the bearer does.
	expect((await page.request.get('/api/v1/bases')).status()).toBe(401);

	const added = await page.request.post(rows, {
		headers,
		data: { rows: [{ Exercise: 'Deadlift', Kg: 140 }] }
	});
	expect(added.status()).toBe(201);
	const [row] = ((await added.json()) as { rows: { id: string; fields: unknown }[] }).rows;
	expect(row.fields).toEqual({ Exercise: 'Deadlift', Kg: 140 });

	const listed = await page.request.get(`${rows}?fields=Exercise`, { headers });
	expect(await listed.json()).toMatchObject({
		rows: [{ fields: { Exercise: 'Squat' } }, { fields: { Exercise: 'Deadlift' } }],
		cursor: null
	});

	const changes = await page.request.get('/api/v1/changes?base=Gym', { headers });
	const feed = (await changes.json()) as { changes: { id: string }[]; cursor: string };
	expect(feed.changes.map((change) => change.id)).toContain(row.id);

	expect(
		(await page.request.delete(`${rows}/${row.id}`, { headers })).status(),
		'a curl-like DELETE with no body'
	).toBe(200);
	const after = await page.request.get(`/api/v1/changes?base=Gym&since=${feed.cursor}`, {
		headers
	});
	expect((await after.json()).changes).toEqual([
		expect.objectContaining({ id: row.id, deleted: true })
	]);

	await page.goto(path);
	await expect(cell(page, 'Squat')).toBeVisible();
	await expect(cell(page, 'Deadlift')).toHaveCount(0);
});

test('the API docs list every operation from the OpenAPI document', async ({ page }) => {
	const spec = await page.request.get('/api/v1/openapi.json');
	expect(spec.headers()['access-control-allow-origin']).toBe('*');
	const doc = (await spec.json()) as {
		openapi: string;
		paths: Record<string, object>;
		components: { schemas: Record<string, object> };
	};
	expect(doc.openapi).toMatch(/^3\.1\./u);
	const count = Object.values(doc.paths).flatMap((methods) => Object.keys(methods)).length;
	const schemas = Object.keys(doc.components.schemas).length;

	await page.goto('/docs/api');
	await expect(page.getByRole('heading', { name: 'API', level: 1 })).toBeVisible();
	await expect(page.locator('section[id]').filter({ has: page.locator('h2') })).toHaveCount(
		count + schemas
	);
	await expect(page.getByRole('heading', { name: 'Add rows' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Image', exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'OpenAPI document' })).toHaveAttribute(
		'href',
		'/api/v1/openapi.json'
	);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
		page.viewportSize()?.width ?? 0
	);
});

test.describe('in French', () => {
	test.use({ locale: 'fr-FR' });

	test('the API docs keep their own words in French', async ({ page }) => {
		await page.goto('/fr/docs/api');
		await expect(page.getByRole('link', { name: 'Document OpenAPI' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Corps' }).first()).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			page.viewportSize()?.width ?? 0
		);
	});
});
