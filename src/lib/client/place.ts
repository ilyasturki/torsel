import type { ViewDef } from '../core/model.ts';

type Place = {
	table: string | null;
	views: Record<string, string>;
	logged: Record<string, string>;
};

// localStorage, not the IndexedDB store: a table's view is read while it renders.
const KEY = 'torsel.place';

function read(): Place {
	try {
		const stored: Partial<Place> = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		return { table: stored.table ?? null, views: stored.views ?? {}, logged: stored.logged ?? {} };
	} catch {
		return { table: null, views: {}, logged: {} };
	}
}

function write(place: Place): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(place));
	} catch {
		// Private windows can refuse storage: the app then just opens on its home.
	}
}

export function visitTable(table: string, view: string): void {
	const place = read();
	if (place.table !== table || place.views[table] !== view) {
		write({ ...place, table, views: { ...place.views, [table]: view } });
	}
}

export function visitHome(): void {
	const place = read();
	if (place.table !== null) {
		write({ ...place, table: null });
	}
}

/** A row added through this view: a phone comes back to it whatever was looked at since. */
export function loggedThrough(table: string, view: string): void {
	const place = read();
	if (place.logged[table] !== view) {
		write({ ...place, logged: { ...place.logged, [table]: view } });
	}
}

export function lastTable(): string | null {
	return read().table;
}

function onPhone(): boolean {
	return matchMedia('(pointer: coarse), (max-width: 40rem)').matches;
}

export function viewToOpen(
	views: ViewDef[],
	table: string,
	requested: string | null
): ViewDef | undefined {
	const place = read();
	const candidates = [requested, onPhone() ? place.logged[table] : undefined, place.views[table]];

	for (const id of candidates) {
		const view = views.find((item) => item.id === id);
		if (view !== undefined) {
			return view;
		}
	}

	return views[0];
}
