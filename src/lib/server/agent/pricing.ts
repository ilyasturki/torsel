/** Dollars per million tokens. Cache writes are the 5-minute kind, 1.25× input. */
type Price = { input: number; output: number; cacheWrite: number; cacheRead: number };

const PRICES: Record<string, Price> = {
	'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
	'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
	'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
	'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
	'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
	'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 }
};

// A model missing above is charged as the dearest one listed, so an unknown never runs free.
const UNKNOWN: Price = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };

// $10 per 1,000 searches.
const SEARCH_MICROS = 10_000;

/** What a response reports it used, as the API names it. */
export type Usage = {
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
	cache_read_input_tokens?: number | null;
	server_tool_use?: { web_search_requests?: number | null } | null;
};

/** What one response cost, in millionths of a dollar. */
export function costOf(model: string, usage: Usage): number {
	const price = PRICES[model] ?? UNKNOWN;
	const tokens =
		(usage.input_tokens ?? 0) * price.input +
		(usage.output_tokens ?? 0) * price.output +
		(usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
		(usage.cache_read_input_tokens ?? 0) * price.cacheRead;
	const searches = usage.server_tool_use?.web_search_requests ?? 0;
	return Math.ceil(tokens) + searches * SEARCH_MICROS;
}
