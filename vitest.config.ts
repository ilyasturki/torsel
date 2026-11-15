import { defineConfig } from 'vitest/config';

import { sqlWorker } from './scripts/sql-worker-plugin.ts';

export default defineConfig({
	plugins: [sqlWorker()],
	define: {
		'import.meta.env.CHEAP_SCRYPT': 'true'
	},
	test: {
		include: ['src/**/*.test.ts']
	}
});
