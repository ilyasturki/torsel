export type AssistantLimit = { scope: 'account' | 'instance'; until: number };

/** The body of a 429 from the assistant's endpoints, when it names a cap. */
export function limitOf(payload: unknown): AssistantLimit | null {
	if (typeof payload !== 'object' || payload === null) {
		return null;
	}
	const { scope, until } = payload as Record<string, unknown>;
	return (scope === 'account' || scope === 'instance') && typeof until === 'number'
		? { scope, until }
		: null;
}

function sameDay(a: Date, b: Date): boolean {
	return a.toDateString() === b.toDateString();
}

export function limitMessage(limit: AssistantLimit, now: Date = new Date()): string {
	const back = new Date(limit.until);
	const time = back.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	const when = sameDay(back, now) ? `at ${time}` : `tomorrow at ${time}`;
	const reached =
		limit.scope === 'account'
			? 'You’ve reached today’s assistant limit.'
			: 'The assistant has reached today’s limit on this server.';
	return `${reached} Ask again ${when}.`;
}
