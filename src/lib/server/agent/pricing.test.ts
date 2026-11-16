import { describe, expect, it } from 'vitest';

import { costOf } from './pricing.ts';

describe('costOf', () => {
	it('charges each model its own price per token kind, in millionths of a dollar', () => {
		const usage = {
			input_tokens: 1000,
			output_tokens: 500,
			cache_creation_input_tokens: 2000,
			cache_read_input_tokens: 10_000
		};
		// 1000×4 + 500×20 + 2000×5 + 10000×0.2
		expect(costOf('claude-opus-5-5', usage)).toBe(26_000);
		// 1000×0.1 + 500×0.5 + 2000×0.125 + 10000×0.01
		expect(costOf('claude-haiku-5-5', usage)).toBe(700);
		expect(costOf('claude-sonnet-5-5', usage)).toBe(13_000);
	});

	it('adds a cent per web search', () => {
		expect(
			costOf('claude-opus-5-5', {
				input_tokens: 0,
				output_tokens: 0,
				server_tool_use: { web_search_requests: 6 }
			})
		).toBe(60_000);
	});

	it('charges a model it doesn’t know as the dearest, and rounds a fraction up', () => {
		expect(costOf('fake', { input_tokens: 1, output_tokens: 1 })).toBe(30);
		expect(costOf('claude-haiku-5-5', { input_tokens: 1 })).toBe(1);
		expect(costOf('claude-haiku-5-5', {})).toBe(0);
	});
});
