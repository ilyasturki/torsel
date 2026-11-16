import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import { detectDelimiter, parseCsv, withHeader } from '../../core/csv.ts';
import { sheetRows, zipEntries } from '../../core/xlsx.ts';
import { names } from '../../i18n/names.ts';
import type { XmlNode } from './xml.ts';
import { child, decodeEntities, parseXml } from './xml.ts';

export const FORMATS = ['csv', 'tsv', 'json', 'xlsx', 'rss', 'atom'] as const;

export type Format = (typeof FORMATS)[number];

/** One row of a source: each path's text. */
export type Item = Record<string, string>;

export type Feed = {
	format: Format;
	// Every path any item holds, in the order they first appear.
	paths: string[];
	items: Item[];
	// Where rows can be found in a JSON answer; empty for the other formats.
	rowPaths: string[];
	// The JSON path the items came from, '' for the answer itself.
	rows: string;
	// The next page a JSON answer names, as it wrote it.
	next: string | null;
};

export type Unreadable = 'html' | 'format' | 'rows';

export class ReadFailed extends Error {
	constructor(readonly reason: Unreadable) {
		super(`unreadable: ${reason}`);
		this.name = 'ReadFailed';
	}
}

const MAX_PATHS = 100;
const MAX_TEXT = 10_000;
const MAX_NESTING = 4;
// An XLSX is a zip: a few megabytes can inflate to gigabytes.
const MAX_INFLATED = 64 * 1024 * 1024;

function capped(text: string): string {
	return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

function textOf(body: Buffer): string {
	return body.toString('utf8').replace(/^﻿/u, '');
}

function isZip(body: Buffer): boolean {
	return body.length > 4 && body.readUInt32LE(0) === 0x04034b50;
}

/** The format a body is in, from its media type and its first bytes. */
export function detectFormat(body: Buffer, contentType: string): Format | 'html' | null {
	if (isZip(body)) return 'xlsx';
	const type = contentType.toLowerCase();
	const head = textOf(body.subarray(0, 4096)).trimStart();
	if (head.startsWith('<')) {
		const start = head.slice(0, 2048);
		if (/<rss[\s>]|<rdf:RDF[\s>]/u.test(start)) return 'rss';
		if (/<feed[\s>]/u.test(start)) return 'atom';
		return /<html[\s>]|<!doctype html/iu.test(start) || type.includes('html') ? 'html' : null;
	}
	if (head.startsWith('{') || head.startsWith('[') || type.includes('json')) return 'json';
	if (type.includes('tab-separated')) return 'tsv';
	if (head === '') return null;
	return detectDelimiter(head) === '\t' ? 'tsv' : 'csv';
}

function unique(header: string[]): string[] {
	const seen = new Set<string>();
	return header.map((raw, index) => {
		const base = raw.trim() === '' ? names.column(index + 1) : raw.trim();
		let name = base;
		for (let n = 2; seen.has(name.toLowerCase()); n += 1) name = `${base} (${n})`;
		seen.add(name.toLowerCase());
		return name;
	});
}

function fromCells(format: Format, cells: string[][]): Feed {
	const rows = withHeader(cells, names);
	const [header = [], ...body] = rows;
	const paths = unique(header).slice(0, MAX_PATHS);
	const items = body.map((line) =>
		Object.fromEntries(paths.map((path, at) => [path, capped(line[at] ?? '')]))
	);
	return { format, paths, items, rowPaths: [], rows: '', next: null };
}

function xlsxCells(body: Buffer): string[][] | null {
	const entries = zipEntries(body);
	if (entries === null) return null;
	return sheetRows((name) => {
		const entry = entries.get(name);
		if (entry === undefined) return undefined;
		const raw =
			entry.method === 0 ? entry.raw : inflateRawSync(entry.raw, { maxOutputLength: MAX_INFLATED });
		return Buffer.from(raw).toString('utf8');
	});
}

// --- JSON

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isObject = (value: Json | undefined): value is { [key: string]: Json } =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function scalarText(value: Json): string {
	return value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function flatten(value: Json, prefix: string, out: Item, depth: number): void {
	if (Array.isArray(value)) {
		const scalars = value.every((entry) => entry === null || typeof entry !== 'object');
		out[prefix] = capped(
			scalars
				? value
						.map(scalarText)
						.filter((text) => text !== '')
						.join(', ')
				: JSON.stringify(value)
		);
	} else if (isObject(value) && prefix !== '' && depth >= MAX_NESTING) {
		out[prefix] = capped(JSON.stringify(value));
	} else if (isObject(value)) {
		for (const [key, entry] of Object.entries(value)) {
			flatten(entry, prefix === '' ? key : `${prefix}.${key}`, out, depth + 1);
		}
	} else if (prefix !== '') {
		out[prefix] = capped(scalarText(value));
	}
}

/** The value at a dotted path; '' is the value itself. */
export function valueAt(value: Json, path: string): Json | undefined {
	if (path === '') return value;
	let at: Json | undefined = value;
	for (const key of path.split('.')) {
		if (!isObject(at)) return undefined;
		at = at[key];
	}
	return at;
}

/** Arrays of objects within three levels, the longest first. */
function arraysOfObjects(value: Json): string[] {
	const found: { path: string; length: number }[] = [];
	const walk = (at: Json, path: string, depth: number): void => {
		if (Array.isArray(at)) {
			if (at.length > 0 && at.filter(isObject).length * 2 >= at.length) {
				found.push({ path, length: at.length });
			}
			return;
		}
		if (!isObject(at) || depth >= 3) return;
		for (const [key, entry] of Object.entries(at)) {
			walk(entry, path === '' ? key : `${path}.${key}`, depth + 1);
		}
	};
	walk(value, '', 0);
	return found.sort((a, b) => b.length - a.length).map(({ path }) => path);
}

const NEXT_PATHS = ['next', 'next_url', 'nextUrl', 'links.next', 'links.next.href', 'paging.next'];

function nextLink(value: Json): string | null {
	for (const path of NEXT_PATHS) {
		const found = valueAt(value, path);
		if (typeof found === 'string' && /^(https?:\/\/|\/|\?)/u.test(found)) return found;
	}
	return null;
}

function orderedPaths(items: Item[]): string[] {
	const paths = new Set<string>();
	for (const item of items) {
		for (const path of Object.keys(item)) {
			if (paths.size >= MAX_PATHS) break;
			paths.add(path);
		}
	}
	return [...paths];
}

function readJson(text: string, rows: string | null): Feed {
	let value: Json;
	try {
		value = JSON.parse(text) as Json;
	} catch {
		throw new ReadFailed('format');
	}
	const rowPaths = arraysOfObjects(value);
	const chosen = rows ?? rowPaths[0] ?? '';
	const at = valueAt(value, chosen);
	let entries: Json[];
	if (Array.isArray(at)) {
		entries = at;
	} else if (isObject(at) && chosen === '') {
		entries = [at];
	} else {
		throw new ReadFailed('rows');
	}
	const items = entries.map((entry) => {
		const item: Item = {};
		flatten(isObject(entry) ? entry : { value: entry }, '', item, 0);
		return item;
	});
	return {
		format: 'json',
		paths: orderedPaths(items),
		items,
		rowPaths,
		rows: chosen,
		next: nextLink(value)
	};
}

// --- RSS and Atom

const BLOCK_END = /<\/(p|div|li|h[1-6]|tr)>|<br\s*\/?>/giu;

/** The words of an HTML fragment, its paragraphs on their own lines. */
function plain(text: string): string {
	if (!/<[a-z!/][^>]*>/iu.test(text)) return text.trim();
	return decodeEntities(
		text
			.replace(BLOCK_END, '\n')
			.replace(/<[^>]*>/gu, '')
			.replace(/&nbsp;/giu, ' ')
	)
		.split('\n')
		.map((line) => line.replace(/\s+/gu, ' ').trim())
		.filter((line) => line !== '')
		.join('\n');
}

const SKIPPED_ATTRS = new Set(['rel', 'type', 'xmlns']);

function flattenXml(node: XmlNode, prefix: string, out: Item, depth: number): void {
	for (const element of node.children) {
		const path = prefix === '' ? element.name : `${prefix}.${element.name}`;
		if (element.children.length > 0 && depth < MAX_NESTING) {
			flattenXml(element, path, out, depth + 1);
		}
		const text = plain(element.text);
		if (text !== '') {
			out[path] = capped(out[path] === undefined ? text : `${out[path]}, ${text}`);
		} else if (element.children.length === 0) {
			for (const [name, value] of Object.entries(element.attrs)) {
				const key = `${path}.${name}`;
				if (!SKIPPED_ATTRS.has(name) && !name.startsWith('xmlns') && out[key] === undefined) {
					out[key] = capped(value);
				}
			}
		}
	}
}

function readFeed(text: string): Feed {
	const root = parseXml(text);
	if (root === null) throw new ReadFailed('format');
	let format: Format;
	let entries: XmlNode[];
	if (root.name === 'feed') {
		format = 'atom';
		entries = root.children.filter((node) => node.name === 'entry');
	} else if (root.name === 'rss') {
		format = 'rss';
		entries = (child(root, 'channel') ?? root).children.filter((node) => node.name === 'item');
	} else if (root.name === 'rdf:RDF') {
		format = 'rss';
		entries = root.children.filter((node) => node.name === 'item');
	} else {
		throw new ReadFailed('format');
	}
	const items = entries.map((entry) => {
		const item: Item = {};
		flattenXml(entry, '', item, 0);
		return item;
	});
	return { format, paths: orderedPaths(items), items, rowPaths: [], rows: '', next: null };
}

/** The rows of a fetched body; `rows` picks where they are in a JSON answer. */
export function readBody(body: Buffer, contentType: string, rows: string | null = null): Feed {
	const format = detectFormat(body, contentType);
	if (format === 'html') throw new ReadFailed('html');
	if (format === null) throw new ReadFailed('format');
	if (format === 'xlsx') {
		let cells: string[][] | null;
		try {
			cells = xlsxCells(body);
		} catch {
			cells = null;
		}
		if (cells === null) throw new ReadFailed('format');
		return fromCells('xlsx', cells);
	}
	const text = textOf(body);
	if (format === 'json') return readJson(text, rows);
	if (format === 'rss' || format === 'atom') return readFeed(text);
	return fromCells(format, parseCsv(text, format === 'tsv' ? '\t' : detectDelimiter(text)));
}

// --- Keys and names

const KEY_NAMES = ['id', 'uid', 'guid', 'key', 'slug', 'url', 'link'];

const lastName = (path: string): string => (path.split('.').at(-1) ?? path).replace(/^[^:]+:/u, '');

/** The path whose values tell items apart, by name: null when none does. */
export function guessKey(items: Item[], paths: string[]): string | null {
	for (const name of KEY_NAMES) {
		for (const path of paths) {
			if (lastName(path).toLowerCase() !== name) continue;
			const values = items.map((item) => item[path] ?? '');
			if (values.every((value) => value !== '') && new Set(values).size === values.length) {
				return path;
			}
		}
	}
	return null;
}

/** What identifies an item across runs: its key, or all of its values when there is none. */
export function itemKey(item: Item, key: string | null, paths: string[]): string {
	if (key !== null) return item[key] ?? '';
	const values = paths.map((path) => item[path] ?? '');
	return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

const ADDRESSES = new Set(['href', 'url', 'src']);

/** A field name for a path: `letterboxd:watchedDate` reads as "Watched date", `link.href` as "Link". */
export function pathName(format: Format, path: string): string {
	if (format === 'csv' || format === 'tsv' || format === 'xlsx') return path;
	const parts = path.split('.');
	const named = parts.length > 1 && ADDRESSES.has(parts.at(-1) ?? '') ? parts.slice(0, -1) : parts;
	const words = lastName(named.join('.'))
		.replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
		.replace(/[_-]+/gu, ' ')
		.trim()
		.toLowerCase();
	return words === '' ? path : words[0].toUpperCase() + words.slice(1);
}

/** The table the items make, the header being the paths. */
export function cellsOf(feed: Pick<Feed, 'paths' | 'items'>): string[][] {
	return [feed.paths, ...feed.items.map((item) => feed.paths.map((path) => item[path] ?? ''))];
}
