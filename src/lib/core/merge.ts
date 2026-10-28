import type { Rec, Value } from './model.ts';

function sameValue(a: Value | undefined, b: Value | undefined): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function merge(local: Rec | undefined, incoming: Rec): Rec {
	if (local === undefined) {
		return { ...incoming, data: { ...incoming.data }, clocks: { ...incoming.clocks } };
	}

	const data: Record<string, Value> = { ...local.data };
	const clocks = { ...local.clocks };

	for (const [key, clock] of Object.entries(incoming.clocks)) {
		const mine = clocks[key];
		// Equal clocks name the same write, so either side's value is the same value.
		if (mine === undefined || clock > mine) {
			clocks[key] = clock;
			data[key] = incoming.data[key] ?? null;
		}
	}

	return { ...local, data, clocks };
}

export function sameRec(a: Rec | undefined, b: Rec | undefined): boolean {
	if (a === undefined || b === undefined) {
		return a === b;
	}

	const keys = new Set([...Object.keys(a.clocks), ...Object.keys(b.clocks)]);

	for (const key of keys) {
		if (a.clocks[key] !== b.clocks[key] || !sameValue(a.data[key], b.data[key])) {
			return false;
		}
	}

	return true;
}

export function latestClock(rec: Rec): string {
	let latest = '';

	for (const clock of Object.values(rec.clocks)) {
		if (clock > latest) {
			latest = clock;
		}
	}

	return latest;
}
