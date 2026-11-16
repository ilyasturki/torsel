import { describe, expect, it } from 'vitest';

import type { ThreadAction, ThreadRow } from './thread.ts';

describe('mentions', () => {
	it('reads the @word typed before the caret, and nothing mid-word or after a space', () => {
		expect(mentionAt('compare with @Pe', 16)).toEqual({ start: 13, query: 'Pe' });
		expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
		expect(mentionAt('mail me@home', 12)).toBeNull();
		expect(mentionAt('compare @Pesées now', 19)).toBeNull();
	});

	it('finds each named table once, the longest name first', () => {
		expect(mentionsIn('@Liste 2 and @Liste, not @Listes', ['Liste', 'Liste 2'])).toEqual([
			'Liste 2',
			'Liste'
		]);
		expect(mentionsIn('weight in Pesées', ['Pesées'])).toEqual([]);
	});
});
import {
	afterFallback,
	droppedSeqs,
	echoable,
	fitSuggestions,
	mentionAt,
	mentionsIn,
	fitTitle,
	titleOf,
	toItems
} from './thread.ts';

function action(id: string, turn = 1): ThreadAction {
	return { id, turn, summary: id, changes: [], before: [], status: 'applied' };
}

const prompt: ThreadRow = {
	seq: 1,
	role: 'user',
	content: [
		{ type: 'text', text: 'Today: 2026-10-31.' },
		{ type: 'text', text: 'how much' }
	],
	meta: { prompt: 'how much', where: 'On Lifts, Grid' }
};

describe('toItems', () => {
	it('shows the person what they typed, never the context note', () => {
		expect(toItems([prompt], [])).toEqual([
			{ kind: 'user', key: '0', seq: 1, text: 'how much', where: 'On Lifts, Grid', files: [] }
		]);
	});

	it('shows a write as its change, and leaves reads, notes and words on the way out', () => {
		const rows: ThreadRow[] = [
			prompt,
			{
				seq: 2,
				role: 'assistant',
				content: [
					{ type: 'thinking', thinking: 'Checking the volume.' },
					{ type: 'tool_use', id: 'a', name: 'query', input: { sql: 'select 1' } },
					{ type: 'text', text: 'Let me add them.' },
					{ type: 'tool_use', id: 'b', name: 'add_rows', input: {} }
				],
				meta: null
			},
			{ seq: 3, role: 'assistant', content: [{ type: 'text', text: 'Done.' }], meta: null }
		];
		const items = toItems(rows, [action('b')]);
		expect(items.map((item) => item.kind)).toEqual(['user', 'change', 'text']);
		expect(items[1]).toMatchObject({ key: 'b', action: { id: 'b' } });
	});

	it('shows the answer that follows a docs page the server read, not the words before it', () => {
		const rows: ThreadRow[] = [
			prompt,
			{
				seq: 2,
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Reading the docs.' },
					{ type: 'server_tool_use', id: 's', name: 'web_fetch', input: { url: 'https://x' } },
					{ type: 'web_fetch_tool_result', tool_use_id: 's', content: {} },
					{ type: 'text', text: 'It needs a key.' }
				],
				meta: null
			}
		];
		expect(toItems(rows, []).map((item) => (item.kind === 'text' ? item.text : item.kind))).toEqual(
			['user', 'It needs a key.']
		);
	});

	it('shows a searched reply as one text, then the sites it read, one per host', () => {
		const result = (url: string, title: string) => ({
			type: 'web_search_result' as const,
			url,
			title,
			encrypted_content: 'x'
		});
		const rows: ThreadRow[] = [
			prompt,
			{
				seq: 2,
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Searching.' },
					{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'dune' } },
					{
						type: 'web_search_tool_result',
						tool_use_id: 's1',
						content: [
							result('https://www.imdb.com/title/tt15239678/', 'Dune: Part Two'),
							result('https://www.imdb.com/title/tt1160419/', 'Dune'),
							result('https://en.wikipedia.org/wiki/Dune:_Part_Two', 'Dune: Part Two')
						]
					},
					{ type: 'text', text: 'It is rated ' },
					{
						type: 'text',
						text: '8.5',
						citations: [
							{
								type: 'web_search_result_location',
								url: 'https://www.imdb.com/title/tt15239678/',
								title: 'Dune: Part Two',
								cited_text: '8.5/10',
								encrypted_index: 'x'
							}
						]
					},
					{ type: 'text', text: ' on IMDb.' }
				],
				meta: null
			}
		];
		const items = toItems(rows, []);
		expect(items.slice(1)).toEqual([
			{ kind: 'text', key: '1.3', text: 'It is rated 8.5 on IMDb.' },
			{
				kind: 'sources',
				key: '1.sources',
				sources: [{ url: 'https://www.imdb.com/title/tt15239678/', title: 'imdb.com' }]
			}
		]);
	});

	it('lists what a search found under a reply that only wrote, and nothing while it is paused', () => {
		const search: ThreadRow = {
			seq: 2,
			role: 'assistant',
			content: [
				{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'ratings' } },
				{
					type: 'web_search_tool_result',
					tool_use_id: 's1',
					content: [
						{
							type: 'web_search_result',
							url: 'https://www.imdb.com/x',
							title: 'X',
							encrypted_content: 'x'
						},
						{
							type: 'web_search_result',
							url: 'javascript:alert(1)',
							title: 'Y',
							encrypted_content: 'x'
						}
					]
				},
				{ type: 'tool_use', id: 'b', name: 'update_rows', input: {} }
			],
			meta: null
		};
		const paused: ThreadRow = {
			seq: 2,
			role: 'assistant',
			content: [
				{ type: 'text', text: 'Looking.' },
				{ type: 'server_tool_use', id: 's0', name: 'web_search', input: { query: 'x' } }
			],
			meta: null
		};
		const done: ThreadRow = {
			seq: 4,
			role: 'assistant',
			content: [{ type: 'text', text: 'Done.' }],
			meta: null
		};
		expect(toItems([prompt, paused], []).map((item) => item.kind)).toEqual(['user']);
		const items = toItems([prompt, search, done], [action('b')]);
		expect(items.map((item) => item.kind)).toEqual(['user', 'change', 'text', 'sources']);
		expect(items[3]).toMatchObject({
			sources: [{ url: 'https://www.imdb.com/x', title: 'imdb.com' }]
		});
	});

	it('renders an event from what the server stored', () => {
		const rows: ThreadRow[] = [
			{ seq: 1, role: 'event', content: { kind: 'stopped', message: 'Stopped.' }, meta: null }
		];
		expect(toItems(rows, [])).toEqual([
			{ kind: 'event', key: '0', event: 'stopped', message: 'Stopped.' }
		]);
	});

	it('hides what an edit replaced, the replacement marker included', () => {
		const rows: ThreadRow[] = [
			prompt,
			{ seq: 2, role: 'assistant', content: [{ type: 'text', text: 'Old.' }], meta: null },
			{ seq: 3, role: 'event', content: { kind: 'error', message: 'Failed.' }, meta: null },
			{
				seq: 4,
				role: 'event',
				content: { kind: 'replaced', message: '', drops: { from: 1, to: 3 } },
				meta: null
			},
			{ ...prompt, seq: 5, meta: { prompt: 'how many', where: 'On Lifts' } }
		];
		expect(toItems(rows, []).map((item) => (item.kind === 'user' ? item.text : item.kind))).toEqual(
			['how many']
		);
		const dropped = droppedSeqs(rows);
		expect([1, 2, 3, 5].map(dropped)).toEqual([true, true, true, false]);
	});
});

describe('a turn that fell back', () => {
	const content = [
		{ type: 'thinking' },
		{ type: 'text' },
		{ type: 'tool_use' },
		{ type: 'fallback' },
		{ type: 'thinking' },
		{ type: 'tool_use' }
	];

	it('runs only the tools after the last fallback', () => {
		expect(afterFallback(content).map((block) => block.type)).toEqual(['thinking', 'tool_use']);
	});

	it('echoes the declined part as text only, as the API asks', () => {
		expect(echoable(content).map((block) => block.type)).toEqual([
			'text',
			'fallback',
			'thinking',
			'tool_use'
		]);
	});

	it('leaves an ordinary turn untouched', () => {
		const plain = [{ type: 'thinking' }, { type: 'tool_use' }];
		expect(echoable(plain)).toBe(plain);
		expect(afterFallback(plain)).toBe(plain);
	});
});

describe('titleOf', () => {
	it('keeps one line, cut at the limit', () => {
		expect(titleOf('  add\n3 sets  ')).toBe('add 3 sets');
		expect(titleOf('x'.repeat(100))).toBe(`${'x'.repeat(60)}…`);
	});
});

describe('fitTitle', () => {
	it('drops quotes and final punctuation', () => {
		expect(fitTitle('  "Bench press sets."  ')).toBe('Bench press sets');
		expect(fitTitle('« Liste de courses »')).toBe('Liste de courses');
	});

	it('cuts whole words at 32 characters, with no ellipsis', () => {
		const title = fitTitle('log 3x10 at 72 on bench press declined');
		expect(title).toBe('log 3x10 at 72 on bench press');
		expect(title.length).toBeLessThanOrEqual(32);
		expect(fitTitle('x'.repeat(40))).toBe('x'.repeat(32));
		expect(fitTitle('every morning, pull my weight from Withings')).toBe(
			'every morning, pull my weight'
		);
	});
});

describe('fitSuggestions', () => {
	it('keeps three distinct one-line requests, questions with their mark', () => {
		expect(
			fitSuggestions([
				{ text: '  "Log bench press\n declined."', complete: false },
				{ text: 'My best set?', complete: true },
				{ text: 'my best set?', complete: true },
				{ text: '', complete: true },
				{ text: 'x'.repeat(81), complete: true },
				{ text: 'Chart kg by week', complete: true },
				{ text: 'A fourth one', complete: true }
			])
		).toEqual([
			{ text: 'Log bench press declined', complete: false },
			{ text: 'My best set?', complete: true },
			{ text: 'Chart kg by week', complete: true }
		]);
	});

	it('answers nothing for anything but a list', () => {
		expect(fitSuggestions({ text: 'Log' })).toEqual([]);
		expect(fitSuggestions([7, null, { text: 3 }])).toEqual([]);
	});
});
