export function sameName(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Which of `taken` already holds `name`, leaving out `self`, the record being renamed. */
export function nameTaken<T extends { id: string; name: string }>(
	taken: readonly T[],
	name: string,
	self?: string
): T | undefined {
	return taken.find((other) => other.id !== self && sameName(other.name, name));
}

/** `wanted`, or the first of "wanted (2)", "wanted (3)"… that none of `taken` holds. */
export function numberedName(taken: readonly string[], wanted: string): string {
	const name = wanted.trim();
	const held = (candidate: string): boolean => taken.some((other) => sameName(other, candidate));
	if (!held(name)) {
		return name;
	}
	let number = 2;
	while (held(`${name} (${number})`)) number += 1;
	return `${name} (${number})`;
}
