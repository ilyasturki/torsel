export const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform);

/** A shortcut as the platform spells it: `keys('mod', 'shift', '→')` reads ⇧⌘→ on a Mac, Ctrl+Shift+→ elsewhere. */
export function keys(...parts: string[]): string {
	const names: Record<string, [string, string]> = {
		mod: ['⌘', 'Ctrl'],
		shift: ['⇧', 'Shift'],
		alt: ['⌥', 'Alt']
	};
	if (mac) {
		const order = ['shift', 'alt', 'mod'];
		const sorted = [...parts].sort((a, b) => rank(order, a) - rank(order, b));
		return sorted.map((part) => names[part]?.[0] ?? part.toUpperCase()).join('');
	}
	return parts.map((part) => names[part]?.[1] ?? part.toUpperCase()).join('+');
}

function rank(order: string[], part: string): number {
	const at = order.indexOf(part);
	return at === -1 ? order.length : at;
}
