import { describe, expect, it } from 'vitest';

import type { ThreadAction, ThreadRow } from './thread.ts';
import { afterFallback, droppedSeqs, echoable, fitTitle, titleOf, toItems } from './thread.ts';

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
