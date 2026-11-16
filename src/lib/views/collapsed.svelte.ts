const KEY = 'torsel.collapsed';

function load(): Record<string, string[]> {
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		return typeof saved === 'object' && saved !== null ? (saved as Record<string, string[]>) : {};
	} catch {
		return {};
	}
}

/** The groups folded on this device, by view and group field: a fold is no change to the view. */
const folded = $state<Record<string, string[]>>(load());

export function foldedGroups(view: string, field: string): ReadonlySet<string> {
	return new Set(folded[`${view}:${field}`] ?? []);
}

export function setFolded(view: string, field: string, keys: string[]): void {
	const scope = `${view}:${field}`;
	if (keys.length === 0) delete folded[scope];
	else folded[scope] = keys;
	try {
		localStorage.setItem(KEY, JSON.stringify(folded));
	} catch {
		// Private windows refuse storage; the fold then lasts the session.
	}
}
