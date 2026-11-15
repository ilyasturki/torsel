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
