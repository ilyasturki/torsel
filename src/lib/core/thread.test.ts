import { describe, expect, it } from 'vitest';

import type { ThreadAction, ThreadRow } from './thread.ts';
import { afterFallback, dependents, echoable, prerequisites, toItems } from './thread.ts';

function action(id: string, after: string[] = [], status: ThreadAction['status'] = 'pending') {
	return {
		id,
		tier: 'propose',
		summary: id,
		detail: [],
		changes: [],
		after,
		status
	} satisfies ThreadAction;
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
			{ kind: 'user', key: '0', text: 'how much', where: 'On Lifts, Grid' }
		]);
	});

	it('pairs a tool call with its result, across the row that holds it', () => {
		const rows: ThreadRow[] = [
			prompt,
			{
				seq: 2,
				role: 'assistant',
				content: [
					{ type: 'thinking', thinking: '' },
					{ type: 'thinking', thinking: 'Checking the volume.' },
					{ type: 'tool_use', id: 'a', name: 'query', input: { sql: 'select 1' } },
					{ type: 'tool_use', id: 'b', name: 'query', input: { sql: 'nope' } },
					{ type: 'tool_use', id: 'c', name: 'add_rows', input: {} }
				],
				meta: null
			},
			{
				seq: 3,
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'a',
						content: JSON.stringify({ rows: [{}, {}], count: 2 })
					},
					{
						type: 'tool_result',
						tool_use_id: 'b',
						is_error: true,
						content: JSON.stringify({ error: 'no such column' })
					}
				],
				meta: null
			}
		];
		const items = toItems(rows, []);
		expect(items.map((item) => item.kind)).toEqual(['user', 'note', 'tool', 'tool', 'tool']);
		expect(items[2]).toMatchObject({ label: 'Read with SQL: 2 rows', state: 'done' });
		expect(items[3]).toMatchObject({ label: 'Read with SQL', state: 'error' });
		expect(items[4]).toMatchObject({ label: 'Add rows', state: 'running' });
	});

	it('hides the sentinel the API leaves for an unfinished note', () => {
		const rows: ThreadRow[] = [
			{
				seq: 1,
				role: 'assistant',
				content: [
					{
						type: 'thinking',
						thinking: 'This part of the response was interrupted before it finished.'
					}
				],
				meta: null
			}
		];
		expect(toItems(rows, [])).toEqual([]);
	});

	it('labels a write by its action', () => {
		const rows: ThreadRow[] = [
			{
				seq: 1,
				role: 'assistant',
				content: [{ type: 'tool_use', id: 'a', name: 'add_field', input: {} }],
				meta: null
			}
		];
		const items = toItems(rows, [{ ...action('a'), summary: 'New field "RPE" in Lifts' }]);
		expect(items[0]).toMatchObject({ label: 'New field "RPE" in Lifts' });
	});

	it('renders an event from what the server stored', () => {
		const rows: ThreadRow[] = [
			{ seq: 1, role: 'event', content: { kind: 'stopped', message: 'Stopped.' }, meta: null }
		];
		expect(toItems(rows, [])).toEqual([
			{ kind: 'event', key: '0', event: 'stopped', message: 'Stopped.' }
		]);
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

describe('a decision carries what is built on it', () => {
	const actions = [action('table'), action('field', ['table']), action('rows', ['field'])];

	it('rejecting reaches every action built on it, however indirectly', () => {
		expect(dependents(actions, 'table').map((item) => item.id)).toEqual(['field', 'rows']);
		expect(dependents(actions, 'rows')).toEqual([]);
	});

	it('accepting needs every action it stands on', () => {
		expect(prerequisites(actions, 'rows').map((item) => item.id)).toEqual(['table', 'field']);
		expect(prerequisites(actions, 'table')).toEqual([]);
	});

	it('does not ask again for what is already applied', () => {
		const done = [action('table', [], 'applied'), action('field', ['table'])];
		expect(prerequisites(done, 'field')).toEqual([]);
	});
});
