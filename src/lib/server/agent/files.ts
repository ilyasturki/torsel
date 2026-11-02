import { inflateRawSync } from 'node:zlib';

import type Anthropic from '@anthropic-ai/sdk';

import { parseExport } from '../../core/backup.ts';
import { parseCsv, withHeader } from '../../core/csv.ts';
import type { Rec } from '../../core/model.ts';
import type { StoredFile } from './threads.ts';

export type Sheet =
	| { kind: 'table'; name: string; rows: string[][] }
	| { kind: 'backup'; name: string; records: Rec[] };

type FileKind = 'image' | 'pdf' | 'excel' | 'delimited' | 'json' | 'text';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// A table this long reaches the model whole; a longer one as its head, import_file reading the rest.
const SHOWN_ROWS = 300;
const HEAD_ROWS = 100;
const SHOWN_TEXT = 100_000;

function extension(name: string): string {
	return name.toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1] ?? '';
}

export function kindOf(file: { name: string; type: string }): FileKind | null {
	const ext = extension(file.name);
	if (IMAGE_TYPES.has(file.type)) return 'image';
	if (file.type === 'application/pdf' || ext === 'pdf') return 'pdf';
	if (ext === 'xlsx' || file.type.includes('spreadsheetml')) return 'excel';
	if (['csv', 'tsv'].includes(ext) || ['text/csv', 'text/tab-separated-values'].includes(file.type))
		return 'delimited';
	if (ext === 'json' || file.type === 'application/json') return 'json';
	if (file.type.startsWith('text/') || ['txt', 'md'].includes(ext)) return 'text';
	return null;
}

function text(file: StoredFile): string {
	return file.data.toString('utf8').replace(/^﻿/u, '');
}

/** The rows of a file that reads as a table, its header first. */
export function sheetOf(file: StoredFile): Sheet | null {
	const kind = kindOf(file);
	if (kind === 'delimited' || kind === 'text') {
		const rows = parseCsv(text(file));
		return rows.length > 1 && rows[0].length > 1
			? { kind: 'table', name: file.name, rows: withHeader(rows) }
			: null;
	}
	if (kind === 'excel') {
		const rows = xlsxRows(file.data);
		return rows === null || rows.length === 0 ? null : { kind: 'table', name: file.name, rows };
	}
	if (kind === 'json') {
		const source = text(file);
		const records = parseExport(source);
		if (records !== null) return { kind: 'backup', name: file.name, records };
		return jsonRows(source, file.name);
	}
	return null;
}

function jsonRows(source: string, name: string): Sheet | null {
	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch {
		return null;
	}
	if (!Array.isArray(value) || !value.every((item) => typeof item === 'object' && item !== null)) {
		return null;
	}
	const items = value as Record<string, unknown>[];
	const header = [...new Set(items.flatMap((item) => Object.keys(item)))];
	if (header.length === 0) return null;
	const cell = (item: unknown): string =>
		item === null || item === undefined
			? ''
			: typeof item === 'object'
				? JSON.stringify(item)
				: String(item);
	return {
		kind: 'table',
		name,
		rows: [header, ...items.map((item) => header.map((key) => cell(item[key])))]
	};
}

function csvLine(cells: string[]): string {
	return cells
		.map((cell) => (/[",\n]/u.test(cell) ? `"${cell.replace(/"/gu, '""')}"` : cell))
		.join(',');
}

/** What the model is given of a file: images and PDFs as themselves, the rest as text. */
export function blocksOf(file: StoredFile): Anthropic.Beta.BetaContentBlockParam[] {
	const label = `Attached file "${file.name}" (id ${file.id}, ${file.type || 'unknown type'}, ${file.size} bytes).`;
	const kind = kindOf(file);
	if (kind === 'image') {
		return [
			{ type: 'text', text: label },
			{
				type: 'image',
				source: {
					type: 'base64',
					media_type: file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
					data: file.data.toString('base64')
				}
			}
		];
	}
	if (kind === 'pdf') {
		return [
			{ type: 'text', text: label },
			{
				type: 'document',
				title: file.name,
				source: {
					type: 'base64',
					media_type: 'application/pdf',
					data: file.data.toString('base64')
				}
			}
		];
	}
	const sheet = sheetOf(file);
	if (sheet?.kind === 'backup') {
		return [
			{
				type: 'text',
				text: `${label} A Torsel backup of ${sheet.records.length} records: import_file restores it.`
			}
		];
	}
	if (sheet?.kind === 'table') {
		const body = sheet.rows.length - 1;
		const shown = body <= SHOWN_ROWS ? sheet.rows : sheet.rows.slice(0, HEAD_ROWS + 1);
		const note =
			shown.length === sheet.rows.length
				? `${body} rows, all shown.`
				: `${body} rows; the first ${HEAD_ROWS} shown, import_file reads them all.`;
		return [
			{ type: 'text', text: `${label} ${note}` },
			{
				type: 'document',
				title: file.name,
				source: { type: 'text', media_type: 'text/plain', data: shown.map(csvLine).join('\n') }
			}
		];
	}
	if (kind === 'text' || kind === 'json') {
		const content = text(file);
		const cut = content.length > SHOWN_TEXT;
		return [
			{ type: 'text', text: cut ? `${label} Its first ${SHOWN_TEXT} characters.` : label },
			{
				type: 'document',
				title: file.name,
				source: {
					type: 'text',
					media_type: 'text/plain',
					data: cut ? content.slice(0, SHOWN_TEXT) : content
				}
			}
		];
	}
	return [{ type: 'text', text: `${label} This file type can't be read.` }];
}

// --- Excel: the first sheet of an .xlsx, read with node's own inflate.

function zipEntries(data: Buffer): Map<string, Buffer> | null {
	const entries = new Map<string, Buffer>();
	let end = -1;
	for (let at = data.length - 22; at >= Math.max(0, data.length - 65_557); at -= 1) {
		if (data.readUInt32LE(at) === 0x06054b50) {
			end = at;
			break;
		}
	}
	if (end === -1) return null;
	const count = data.readUInt16LE(end + 10);
	let at = data.readUInt32LE(end + 16);
	for (let index = 0; index < count; index += 1) {
		if (at + 46 > data.length || data.readUInt32LE(at) !== 0x02014b50) return null;
		const method = data.readUInt16LE(at + 10);
		const compressed = data.readUInt32LE(at + 20);
		const nameLength = data.readUInt16LE(at + 28);
		const extraLength = data.readUInt16LE(at + 30);
		const commentLength = data.readUInt16LE(at + 32);
		const local = data.readUInt32LE(at + 42);
		const name = data.toString('utf8', at + 46, at + 46 + nameLength);
		const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
		const raw = data.subarray(start, start + compressed);
		if (method === 0) entries.set(name, raw);
		else if (method === 8) entries.set(name, inflateRawSync(raw));
		at += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

function unescapeXml(value: string): string {
	return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_, code: string) => {
		if (code[0] === '#') {
			return String.fromCodePoint(
				code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
			);
		}
		return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code.toLowerCase()] as string;
	});
}

function textsOf(xml: string): string {
	return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)]
		.map((match) => unescapeXml(match[1]))
		.join('');
}

function attribute(tag: string, name: string): string | undefined {
	return tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'u'))?.[1];
}

const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Which cell styles show a number as a date, and whether with its time. */
function dateStyles(styles: string | undefined): Map<number, boolean> {
	const out = new Map<number, boolean>();
	if (styles === undefined) return out;
	const custom = new Map<number, string>();
	for (const match of styles.matchAll(/<numFmt\s[^>]*>/gu)) {
		const id = Number(attribute(match[0], 'numFmtId'));
		custom.set(id, unescapeXml(attribute(match[0], 'formatCode') ?? ''));
	}
	const xfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/u)?.[1] ?? '';
	[...xfs.matchAll(/<xf\s[^>]*>/gu)].forEach((match, index) => {
		const id = Number(attribute(match[0], 'numFmtId'));
		const code = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]/gu, '').toLowerCase();
		const isDate = DATE_FORMATS.has(id) || (/[dy]/u.test(code) && !/^[#0.,%\s]*$/u.test(code));
		if (isDate) out.set(index, [18, 19, 20, 21, 22, 45, 46, 47].includes(id) || /h/u.test(code));
	});
	return out;
}

function excelDate(serial: number, timed: boolean): string {
	const ms = Math.round((serial - 25569) * 86_400_000);
	const iso = new Date(ms).toISOString();
	return timed && serial % 1 !== 0 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

function columnIndex(ref: string): number {
	const letters = ref.match(/^[A-Z]+/u)?.[0] ?? 'A';
	let index = 0;
	for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
	return index - 1;
}

export function xlsxRows(data: Buffer): string[][] | null {
	let entries: Map<string, Buffer> | null;
	try {
		entries = zipEntries(data);
	} catch {
		return null;
	}
	if (entries === null) return null;
	const read = (name: string): string | undefined => entries.get(name)?.toString('utf8');

	const workbook = read('xl/workbook.xml');
	const rels = read('xl/_rels/workbook.xml.rels') ?? '';
	const first = workbook?.match(/<sheet\s[^>]*>/u)?.[0];
	const rid = first === undefined ? undefined : attribute(first, 'r:id');
	const target = [...rels.matchAll(/<Relationship\s[^>]*>/gu)]
		.map((match) => match[0])
		.find((tag) => attribute(tag, 'Id') === rid);
	const path = target === undefined ? 'worksheets/sheet1.xml' : (attribute(target, 'Target') ?? '');
	const sheet = read(path.startsWith('/') ? path.slice(1) : `xl/${path}`);
	if (sheet === undefined) return null;

	const shared = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/gu)].map(
		(match) => textsOf(match[1])
	);
	const dates = dateStyles(read('xl/styles.xml'));

	const rows: string[][] = [];
	for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
		const cells: string[] = [];
		for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
			const tag = cell[1];
			const inner = cell[2] ?? '';
			const at = columnIndex(attribute(tag, 'r') ?? '');
			const type = attribute(tag, 't');
			const raw = inner.match(/<v>([\s\S]*?)<\/v>/u)?.[1];
			let value = '';
			if (type === 's') value = shared[Number(raw)] ?? '';
			else if (type === 'inlineStr') value = textsOf(inner);
			else if (type === 'b') value = raw === '1' ? 'true' : 'false';
			else if (raw !== undefined) {
				const style = Number(attribute(tag, 's') ?? -1);
				const number = Number(raw);
				value =
					type !== 'str' && dates.has(style) && Number.isFinite(number)
						? excelDate(number, dates.get(style) === true)
						: unescapeXml(raw);
			}
			while (cells.length < at) cells.push('');
			cells[at] = value;
		}
		if (cells.some((cell) => cell.trim() !== '')) rows.push(cells);
	}
	const width = Math.max(0, ...rows.map((cells) => cells.length));
	return rows.length === 0
		? null
		: withHeader(rows.map((cells) => [...cells, ...Array<string>(width - cells.length).fill('')]));
}
