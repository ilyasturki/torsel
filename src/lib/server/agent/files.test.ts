import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { blocksOf, kindOf, sheetOf, xlsxRows } from './files.ts';
import type { StoredFile } from './threads.ts';

/** A zip as Excel writes one: deflated entries, a central directory, its end record. */
function zip(entries: Record<string, string>): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, text] of Object.entries(entries)) {
		const raw = Buffer.from(text);
		const data = deflateRawSync(raw);
		const file = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(file.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(file.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, file, data);
		centrals.push(central, file);
		offset += local.length + file.length + data.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(entries).length, 8);
	end.writeUInt16LE(Object.keys(entries).length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}

const workbook = zip({
	'xl/workbook.xml':
		'<workbook><sheets><sheet name="Séries" sheetId="1" r:id="rId1"/></sheets></workbook>',
	'xl/_rels/workbook.xml.rels':
		'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
	'xl/sharedStrings.xml':
		'<sst><si><t>Date</t></si><si><t>Exercise</t></si><si><t>Weight</t></si><si><r><t>bench</t></r><r><t> press</t></r></si></sst>',
	'xl/styles.xml':
		'<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
	'xl/worksheets/sheet1.xml':
		'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" s="1"><v>46296</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>82.5</v></c></row><row r="3"><c r="A3" s="1"><v>46297</v></c><c r="C3"><v>85</v></c></row></sheetData></worksheet>'
});

function stored(name: string, type: string, data: Buffer | string): StoredFile {
	const bytes = typeof data === 'string' ? Buffer.from(data) : data;
	return { id: 'f1', name, type, size: bytes.length, data: bytes };
}

describe('attachments', () => {
	it('read the first sheet of a workbook, dates as dates and gaps kept', () => {
		expect(xlsxRows(workbook)).toEqual([
			['Date', 'Exercise', 'Weight'],
			['2026-10-01', 'bench press', '82.5'],
			['2026-10-02', '', '85']
		]);
	});

	it('read a CSV, a TSV and a JSON array as tables, and a backup as one', () => {
		expect(sheetOf(stored('a.csv', 'text/csv', 'Date;Kg\n2026-10-01;78,4\n'))).toEqual({
			kind: 'table',
			name: 'a.csv',
			rows: [
				['Date', 'Kg'],
				['2026-10-01', '78,4']
			]
		});
		expect(sheetOf(stored('a.tsv', '', 'Kg\tNote\n80\tok'))?.kind).toBe('table');
		expect(sheetOf(stored('a.json', 'application/json', '[{"a":1,"b":"x"},{"a":2}]'))).toEqual({
			kind: 'table',
			name: 'a.json',
			rows: [
				['a', 'b'],
				['1', 'x'],
				['2', '']
			]
		});
		expect(sheetOf(stored('notes.txt', 'text/plain', 'just words'))).toBeNull();
	});

	it('reach the model as themselves when it reads them natively, as text otherwise', () => {
		const image = blocksOf(stored('photo.jpg', 'image/jpeg', 'jpeg bytes'));
		expect(image[1]).toMatchObject({
			type: 'image',
			source: { type: 'base64', media_type: 'image/jpeg' }
		});
		const pdf = blocksOf(stored('receipt.pdf', 'application/pdf', '%PDF'));
		expect(pdf[1]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
		const sheet = blocksOf(stored('s.xlsx', '', workbook));
		expect(sheet[0]).toMatchObject({ text: expect.stringMatching(/2 rows, all shown/u) });
		expect(sheet[1]).toMatchObject({
			type: 'document',
			source: {
				type: 'text',
				data: 'Date,Exercise,Weight\n2026-10-01,bench press,82.5\n2026-10-02,,85'
			}
		});
	});

	it('refuse what nothing here reads', () => {
		expect(kindOf({ name: 'movie.mp4', type: 'video/mp4' })).toBeNull();
		expect(kindOf({ name: 'export.xlsx', type: '' })).toBe('excel');
	});
});
