import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
	ReadFailed,
	cellsOf,
	detectFormat,
	guessKey,
	itemKey,
	pathName,
	readBody
} from './read.ts';
import { parseXml } from './xml.ts';

const LETTERBOXD = readFileSync(join(import.meta.dirname, 'fixtures/letterboxd.xml'));

const text = (value: string): Buffer => Buffer.from(value);

function failure(read: () => unknown): string {
	try {
		read();
	} catch (error) {
		if (error instanceof ReadFailed) return error.reason;
		throw error;
	}
	return 'read';
}

function zip(entries: Record<string, string>): Buffer {
	const parts: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(entries)) {
		const data = deflateRawSync(Buffer.from(content));
		const file = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt16LE(file.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(8, 10);
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
	return Buffer.concat([...parts, directory, end]);
}

describe('detectFormat', () => {
	it.each([
		['Title,Year\nAlien,1979', 'text/csv', 'csv'],
		['Title;Year\nAlien;1979', 'text/plain', 'csv'],
		['Title\tYear\nAlien\t1979', 'text/plain', 'tsv'],
		['[{"a":1}]', 'text/plain', 'json'],
		['  {"a":1}', 'application/octet-stream', 'json'],
		['<?xml version="1.0"?><rss version="2.0"></rss>', 'text/xml', 'rss'],
		['<feed xmlns="http://www.w3.org/2005/Atom"></feed>', 'application/atom+xml', 'atom'],
		['<!DOCTYPE html><html><body>docs</body></html>', 'text/html', 'html'],
		['', 'text/plain', null]
	])('reads %j as %s', (body, type, format) => {
		expect(detectFormat(text(body), type)).toBe(format);
	});
});

describe('readBody', () => {
	it('reads a CSV with its header, a duplicated name numbered', () => {
		const feed = readBody(text('Title,Year,Title\r\nAlien,1979,x\r\n"Heat, again",1995,y\r\n'), '');
		expect(feed.format).toBe('csv');
		expect(feed.paths).toEqual(['Title', 'Year', 'Title (2)']);
		expect(feed.items[1]).toEqual({ Title: 'Heat, again', Year: '1995', 'Title (2)': 'y' });
	});

	it('reads a TSV', () => {
		const feed = readBody(text('Day\tKg\n2026-11-01\t81.5\n'), 'text/tab-separated-values');
		expect(feed.format).toBe('tsv');
		expect(feed.items).toEqual([{ Day: '2026-11-01', Kg: '81.5' }]);
	});

	it('reads an XLSX and refuses one that inflates past the cap', () => {
		const book = {
			'xl/workbook.xml': '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>',
			'xl/_rels/workbook.xml.rels':
				'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Day</t></is></c><c r="B1" t="inlineStr"><is><t>Kg</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>2026-10-30</t></is></c><c r="B2"><v>81.5</v></c></row></sheetData></worksheet>'
		};
		const feed = readBody(zip(book), '');
		expect(feed.format).toBe('xlsx');
		expect(feed.items).toEqual([{ Day: '2026-10-30', Kg: '81.5' }]);

		const bomb = zip({ ...book, 'xl/worksheets/sheet1.xml': ' '.repeat(80 * 1024 * 1024) });
		expect(bomb.length).toBeLessThan(200_000);
		expect(failure(() => readBody(bomb, ''))).toBe('format');
	});

	it('reads JSON rows at the longest array of objects, nested values flattened', () => {
		const body = {
			total: 2,
			data: {
				results: [
					{ id: 7, title: 'Alien', genres: ['Horror', 'Sci-Fi'], ratings: { imdb: 8.5 } },
					{ id: 9, title: 'Heat', genres: [], ratings: { imdb: 8.3 }, extra: null }
				],
				tags: [{ id: 1 }]
			},
			links: { next: 'https://api.example.com/movies?page=2' }
		};
		const feed = readBody(text(JSON.stringify(body)), 'application/json');
		expect(feed.rows).toBe('data.results');
		expect(feed.rowPaths).toEqual(['data.results', 'data.tags']);
		expect(feed.paths).toEqual(['id', 'title', 'genres', 'ratings.imdb', 'extra']);
		expect(feed.items[0]).toEqual({
			id: '7',
			title: 'Alien',
			genres: 'Horror, Sci-Fi',
			'ratings.imdb': '8.5'
		});
		expect(feed.next).toBe('https://api.example.com/movies?page=2');
		expect(readBody(text(JSON.stringify(body)), '', 'data.tags').items).toEqual([{ id: '1' }]);
	});

	it('reads a root array, a single object, and refuses a path with no rows', () => {
		expect(readBody(text('[{"a":1},{"a":2}]'), '').items).toHaveLength(2);
		expect(readBody(text('{"rates":{"EUR":1,"USD":1.08}}'), '').items).toEqual([
			{ 'rates.EUR': '1', 'rates.USD': '1.08' }
		]);
		expect(failure(() => readBody(text('{"a":1}'), '', 'missing'))).toBe('rows');
		// A path set to a list that now holds one object is a changed answer, not one row.
		expect(failure(() => readBody(text('{"data":{"id":1}}'), '', 'data'))).toBe('rows');
		expect(failure(() => readBody(text('{"a":'), ''))).toBe('format');
	});

	it('reads a Letterboxd diary, its HTML as plain lines', () => {
		const feed = readBody(LETTERBOXD, 'application/rss+xml');
		expect(feed.format).toBe('rss');
		expect(feed.items).toHaveLength(4);
		const [first] = feed.items;
		expect(first['letterboxd:filmTitle']).toBe('Backrooms');
		expect(first['letterboxd:filmYear']).toBe('2026');
		expect(first['letterboxd:memberRating']).toBe('3.5');
		expect(first['letterboxd:watchedDate']).toBe('2026-11-15');
		expect(first['tmdb:movieId']).toBe('1083381');
		expect(first.guid).toMatch(/^letterboxd-watch-\d+$/u);
		expect(first.description).toBe('Watched on Sunday November 15, 2026.');
		expect(guessKey(feed.items, feed.paths)).toBe('guid');
		expect(feed.items.filter((item) => item['letterboxd:filmTitle'] === undefined)).toHaveLength(1);
	});

	it('reads an Atom feed, a link by its address', () => {
		const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Releases</title>
  <entry>
    <id>tag:github.com,2008:Repository/1/v2.0</id>
    <updated>2026-11-10T09:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/o/r/releases/tag/v2.0"/>
    <title>v2.0 &amp; more</title>
    <content type="html">&lt;p&gt;Fixes&lt;/p&gt;&lt;p&gt;Speed&amp;nbsp;up&lt;/p&gt;</content>
    <author><name>octo</name></author>
    <category term="release"/><category term="major"/>
  </entry>
</feed>`;
		const feed = readBody(text(atom), 'application/atom+xml');
		expect(feed.format).toBe('atom');
		expect(feed.items).toEqual([
			{
				id: 'tag:github.com,2008:Repository/1/v2.0',
				updated: '2026-11-10T09:00:00Z',
				'link.href': 'https://github.com/o/r/releases/tag/v2.0',
				title: 'v2.0 & more',
				content: 'Fixes\nSpeed up',
				'author.name': 'octo',
				'category.term': 'release'
			}
		]);
		expect(guessKey(feed.items, feed.paths)).toBe('id');
	});

	it('refuses a web page', () => {
		expect(failure(() => readBody(text('<html><body>API docs</body></html>'), 'text/html'))).toBe(
			'html'
		);
	});
});

describe('parseXml', () => {
	it('expands no declared entity and skips an internal subset', () => {
		const root = parseXml(
			'<!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;">]><r><x>&b; &lt; &#233;</x></r>'
		);
		expect(root?.children[0].text).toBe('&b; < é');
	});

	it('keeps a broken document readable as far as it goes', () => {
		expect(parseXml('<r><a>1</a><b>2')?.children.map((node) => node.text)).toEqual(['1', '2']);
		expect(parseXml('just text')).toBeNull();
	});
});

describe('keys and names', () => {
	it('takes the first unique id-like path, else none', () => {
		const items = [
			{ slug: 'a', id: '1' },
			{ slug: 'b', id: '1' }
		];
		expect(guessKey(items, ['slug', 'id'])).toBe('slug');
		expect(guessKey([{ id: '' }], ['id'])).toBeNull();
	});

	it('hashes the values of an item with no key, the same each run', () => {
		const item = { Title: 'Alien', Year: '1979' };
		expect(itemKey(item, null, ['Title', 'Year'])).toBe(
			itemKey({ ...item }, null, ['Title', 'Year'])
		);
		expect(itemKey(item, null, ['Title', 'Year'])).not.toBe(
			itemKey({ ...item, Year: '1980' }, null, ['Title', 'Year'])
		);
		expect(itemKey(item, 'Title', [])).toBe('Alien');
	});

	it('names a path as a person would', () => {
		expect(pathName('rss', 'letterboxd:watchedDate')).toBe('Watched date');
		expect(pathName('json', 'stats.stargazers_count')).toBe('Stargazers count');
		expect(pathName('atom', 'link.href')).toBe('Link');
		expect(pathName('csv', 'my_column')).toBe('my_column');
	});

	it('lays items out as cells under their paths', () => {
		expect(cellsOf({ paths: ['a', 'b'], items: [{ a: '1' }] })).toEqual([
			['a', 'b'],
			['1', '']
		]);
	});
});
