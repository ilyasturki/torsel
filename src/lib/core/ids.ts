const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export type IdPrefix = 'b' | 't' | 'f' | 'v' | 'r';

// Ids double as SQL identifiers (a table is named by its id, a column by its field's), so
// they stay within [a-z0-9_] and always start with a letter.
export function newId(prefix: IdPrefix, length = 12): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);

	let out = `${prefix}_`;
	for (const byte of bytes) {
		out += ALPHABET[byte % ALPHABET.length];
	}

	return out;
}

export function isId(value: unknown): value is string {
	return typeof value === 'string' && /^[btfvr]_[0-9a-z]{6,32}$/u.test(value);
}
