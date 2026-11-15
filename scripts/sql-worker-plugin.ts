import { build } from 'rolldown';
import type { Plugin } from 'vite';

const ENTRY = 'src/lib/server/sql/worker.ts';

/** Bundles the server's SQL worker into `import.meta.env.SQL_WORKER`, so it ships inside the server's own code. */
export function sqlWorker(): Plugin {
	return {
		name: 'torsel-sql-worker',
		async config() {
			const { output } = await build({
				input: ENTRY,
				platform: 'node',
				write: false,
				external: [/^node:/u],
				output: { format: 'esm', codeSplitting: false }
			});
			return {
				define: { 'import.meta.env.SQL_WORKER': JSON.stringify(output[0].code) }
			};
		}
	};
}
