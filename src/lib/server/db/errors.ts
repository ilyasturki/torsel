function messageOf(value: unknown): string {
	return value instanceof Error ? value.message : '';
}

// `node:sqlite` offers no error code, and drizzle replaces the message with the
// query text while leaving SQLite's own on `cause` — hence both are checked.
export function isUniqueViolation(thrown: unknown): boolean {
	const pattern = /unique constraint failed/iu;
	const cause = thrown instanceof Error ? thrown.cause : undefined;

	return pattern.test(messageOf(thrown)) || pattern.test(messageOf(cause));
}
