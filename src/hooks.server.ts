import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/env';

import { getDatabase } from '#lib/server/db/client.ts';
import { runMigrations } from '#lib/server/db/migrate.ts';
import { createHandle } from '#lib/server/http/handle.ts';
import { handleLocale } from '#lib/server/http/locale.ts';
import { handleSite } from '#lib/server/http/site.ts';

// The build imports this module too: without the guard, compiling the Capacitor
// bundle opens and migrates the build machine's `DATABASE_PATH`.
if (!building) {
	runMigrations(getDatabase());
}

export const handle = sequence(handleLocale, createHandle(getDatabase), handleSite);
