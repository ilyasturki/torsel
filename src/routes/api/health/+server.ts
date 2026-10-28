import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';

import { getDatabase } from '#lib/server/db/client.ts';
import { appliedMigrationCount } from '#lib/server/db/migrate.ts';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	try {
		const db = getDatabase();
		db.get(sql`select 1`);

		return json({
			ok: true,
			name: 'torsel',
			version: import.meta.env.APP_VERSION,
			migrations: appliedMigrationCount(db)
		});
	} catch (error) {
		console.error('health check failed:', error);

		return json({ ok: false }, { status: 503 });
	}
};
