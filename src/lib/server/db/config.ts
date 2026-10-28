import path from 'node:path';

import { envText } from '../env.ts';

export const databasePath = envText('DATABASE_PATH', '.data/torsel.db');

export const migrationsFolder = path.resolve(envText('MIGRATIONS_DIR', 'drizzle'));
