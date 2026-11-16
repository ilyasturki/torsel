import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { readXlsx } from './xlsx.ts';

/** A zip as Excel writes one, its entries deflated or, with `stored`, kept as they are. */
function zip(entries: Record<string, string>, stored = false): Uint8Array {
	const parts: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, text] of Object.entries(entries)) {
		const raw = Buffer.from(text);
		const data = stored ? raw : deflateRawSync(raw);
		const file = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(stored ? 0 : 8, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt16LE(file.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(stored ? 0 : 8, 10);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt16LE(file.length, 28);
		central.writeUInt32LE(offset, 42);
		parts.push(local, file, data);
		centrals.push(central, file);
		offset += local.length + file.length + data.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(entries).length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return new Uint8Array(Buffer.concat([...parts, directory, end]));
}

const BOOK = {
	'xl/workbook.xml': '<workbook><sheets><sheet name="Pesées" r:id="rId1"/></sheets></workbook>',
	'xl/_rels/workbook.xml.rels':
		'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
	'xl/sharedStrings.xml':
		'<sst><si><t>Date</t></si><si><t>Kg</t></si><si><t>a &amp; b</t></si></sst>',
	'xl/styles.xml':
		'<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
	'xl/worksheets/sheet1.xml':
		'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" s="1"><v>46296</v></c><c r="B2"><v>78.4</v></c><c r="C2" t="s"><v>2</v></c></row></sheetData></worksheet>'
};

describe('a workbook read in the browser', () => {
	it('reads the first sheet, dates as dates, rows padded to one width', async () => {
		const rows = [
			['Date', 'Kg', ''],
			['2026-10-01', '78.4', 'a & b']
		];
		expect(await readXlsx(zip(BOOK))).toEqual(rows);
		expect(await readXlsx(zip(BOOK, true))).toEqual(rows);
	});

	it('reads anything else as no workbook', async () => {
		expect(await readXlsx(new TextEncoder().encode('Date,Kg\n2026-10-01,78.4'))).toBeNull();
		const book = zip(BOOK);
		expect(await readXlsx(book.slice(0, book.length - 30))).toBeNull();
		expect(await readXlsx(book.slice(40))).toBeNull();
	});
});
