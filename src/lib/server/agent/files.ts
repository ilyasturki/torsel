import { inflateRawSync } from 'node:zlib';

import type Anthropic from '@anthropic-ai/sdk';

import { parseExport } from '../../core/backup.ts';
import { parseCsv, withHeader } from '../../core/csv.ts';
import { sheetRows, zipEntries } from '../../core/xlsx.ts';
import { names } from '../../i18n/names.ts';
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
			? { kind: 'table', name: file.name, rows: withHeader(rows, names) }
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

/** The first sheet of an .xlsx, read with node's own inflate, which is synchronous. */
export function xlsxRows(data: Buffer): string[][] | null {
	try {
		const entries = zipEntries(data);
		if (entries === null) return null;
		const rows = sheetRows((name) => {
			const entry = entries.get(name);
			if (entry === undefined) return undefined;
			return Buffer.from(entry.method === 0 ? entry.raw : inflateRawSync(entry.raw)).toString(
				'utf8'
			);
		});
		return rows === null ? null : withHeader(rows, names);
	} catch {
		return null;
	}
}
