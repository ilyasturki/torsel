import { configDefaults, defineConfig } from 'vitest/config';

import { sqlWorker } from './scripts/sql-worker-plugin.ts';

export default defineConfig({
	plugins: [sqlWorker()],
	define: {
		'import.meta.env.CHEAP_SCRYPT': 'true'
	},
	test: {
		include: ['src/**/*.test.ts'],
		// Fixtures shared by several test files: named as tests so no build or catalog check reads them.
		exclude: [...configDefaults.exclude, 'src/**/*.fixture.test.ts']
	}
});
