import { defineConfig } from 'vitest/config';

export default defineConfig({
	define: {
		'import.meta.env.CHEAP_SCRYPT': 'true'
	},
	test: {
		include: ['src/**/*.test.ts']
	}
});
