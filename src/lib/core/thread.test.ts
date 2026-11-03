import { describe, expect, it } from 'vitest';

import type { ThreadAction, ThreadRow } from './thread.ts';
import { afterFallback, droppedSeqs, echoable, titleOf, toItems } from './thread.ts';

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
