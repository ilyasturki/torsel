import { AsyncLocalStorage } from 'node:async_hooks';

type Turn = { key: string; live: boolean };

const tails = new Map<string, Promise<unknown>>();
const held = new AsyncLocalStorage<Turn[]>();

/** Runs `work` once every earlier call with the same key has settled; one process, so in memory. A call made inside a live turn of the same key runs at once, as part of that turn. */
export async function serially<T>(key: string, work: () => Promise<T>): Promise<T> {
	const outer = (held.getStore() ?? []).filter((turn) => turn.live);
	if (outer.some((turn) => turn.key === key)) {
		return work();
	}
	// `live` is checked, not just the store: a timer set inside the turn inherits the store and outlives it.
	const mine: Turn = { key, live: true };
	const turn = (tails.get(key) ?? Promise.resolve()).then(() => held.run([...outer, mine], work));
	const tail = turn.catch(() => undefined);
	tails.set(key, tail);

	try {
		return await turn;
	} finally {
		mine.live = false;
		if (tails.get(key) === tail) {
			tails.delete(key);
		}
	}
}
