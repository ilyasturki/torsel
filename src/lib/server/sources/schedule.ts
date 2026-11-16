import type { Database } from '../db/client.ts';
import { runSource } from './run.ts';
import { dueSources, updateSource } from './store.ts';

const TICK_MS = 60_000;
// node:sqlite writes block the process: two runs at once at most.
const AT_ONCE = 2;
const STARTUP_MS = 5_000;

const running = new Set<string>();

/** Starts every due source it has room for; a run that throws is pushed back an hour rather than retried each tick. */
export function tick(db: Database, now: Date = new Date()): Promise<void>[] {
	const room = AT_ONCE - running.size;
	if (room <= 0) return [];
	return dueSources(db, now, room + running.size)
		.filter((source) => !running.has(`${source.userId}:${source.tableId}`))
		.slice(0, room)
		.map(async (source) => {
			const id = `${source.userId}:${source.tableId}`;
			running.add(id);
			try {
				await runSource(db, source.userId, source.tableId);
			} catch (error) {
				console.error('source run failed:', error);
				updateSource(db, source.userId, source.tableId, {
					nextAt: new Date(Date.now() + 60 * TICK_MS)
				});
			} finally {
				running.delete(id);
			}
		});
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Once per process; the timers never keep it alive. */
export function startScheduler(db: Database): void {
	if (timer !== undefined) return;
	const jitter = Math.floor(Math.random() * 10_000);
	timer = setInterval(() => void tick(db), TICK_MS + jitter);
	timer.unref();
	setTimeout(() => void tick(db), STARTUP_MS).unref();
}
