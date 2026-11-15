const tails = new Map<string, Promise<unknown>>();

/** Runs `work` once every earlier call with the same key has settled; one process, so in memory. */
export async function serially<T>(key: string, work: () => Promise<T>): Promise<T> {
	const turn = (tails.get(key) ?? Promise.resolve()).then(work);
	const tail = turn.catch(() => undefined);
	tails.set(key, tail);

	try {
		return await turn;
	} finally {
		if (tails.get(key) === tail) {
			tails.delete(key);
		}
	}
}
