import { defineConfig } from 'drizzle-kit';

import { databasePath, migrationsFolder } from './src/lib/server/db/config.ts';

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/lib/server/db/schema.ts',
	out: migrationsFolder,
	dbCredentials: { url: databasePath }
});
