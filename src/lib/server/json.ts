export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function jsonObject(
	source: Request | Response
): Promise<Record<string, unknown> | undefined> {
	try {
		const parsed: unknown = await source.json();
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}
