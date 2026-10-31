import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown } from './markdown.ts';

describe('parseMarkdown', () => {
	it('reads bold, emphasis and code inline', () => {
		expect(parseInline('**80 kg** on *bench* in `Lifts`')).toEqual([
			{ kind: 'strong', text: '80 kg' },
			{ kind: 'text', text: ' on ' },
			{ kind: 'em', text: 'bench' },
			{ kind: 'text', text: ' in ' },
			{ kind: 'code', text: 'Lifts' }
		]);
	});

	it('leaves a stray star as text while a reply is still streaming', () => {
		expect(parseInline('**80 kg')).toEqual([{ kind: 'text', text: '**80 kg' }]);
		expect(parseInline('3 * 8')).toEqual([{ kind: 'text', text: '3 * 8' }]);
	});

	it('splits paragraphs, lists and headings', () => {
		const blocks = parseMarkdown('Done.\nAll good.\n\n# Sets\n- one\n- two\n\n1. first\n2. second');
		expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'heading', 'list', 'list']);
		expect(blocks[0]).toEqual({
			kind: 'paragraph',
			inline: [{ kind: 'text', text: 'Done. All good.' }]
		});
		expect(blocks[2]).toMatchObject({ ordered: false });
		expect(blocks[3]).toMatchObject({ ordered: true });
	});

	it('reads a table with a rule under its head', () => {
		const [table] = parseMarkdown('| Lift | Kg |\n|---|---:|\n| Bench | 80 |\n| Squat | 100 |');
		expect(table).toMatchObject({
			kind: 'table',
			head: [[{ text: 'Lift' }], [{ text: 'Kg' }]],
			rows: [
				[[{ text: 'Bench' }], [{ text: '80' }]],
				[[{ text: 'Squat' }], [{ text: '100' }]]
			]
		});
	});

	it('keeps a pipe in plain text as text', () => {
		expect(parseMarkdown('a | b')).toEqual([
			{ kind: 'paragraph', inline: [{ kind: 'text', text: 'a | b' }] }
		]);
	});

	it('keeps code as written, closed or not', () => {
		expect(parseMarkdown('```sql\nselect 1\n```')).toEqual([{ kind: 'code', text: 'select 1' }]);
		expect(parseMarkdown('```\nselect 1')).toEqual([{ kind: 'code', text: 'select 1' }]);
	});
});
