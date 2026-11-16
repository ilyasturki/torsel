/**
 * Formulas are SQL expressions over a row's own fields. They are written with field names and
 * stored with field ids (`{{f_…}}`), so renaming a field never breaks one. `"Link"."Field"`
 * reads a field of the linked row; `SUM("Table"."Field")` folds the rows of a table linking here.
 */
import { AGGREGATE_NAMES, FUNCTIONS } from './functions.ts';
import type { Workspace } from './workspace.ts';

export type FormulaProblem =
	| 'unknown-field'
	| 'unclosed-name'
	| 'unclosed-text'
	| 'one-expression'
	| 'empty'
	| 'self-reference'
	| 'not-a-link'
	| 'needs-aggregate'
	| 'two-links'
	| 'two-readings';

/** What `formulaProblem` reports, beside SQLite's own errors, for an aggregate without OVER: it folds the table's rows into one. */
export const BARE_AGGREGATE = 'bare-aggregate';

/** `subject` is the name the problem is about, `others` the names it hesitates between; whoever shows it words the problem. */
export class FormulaError extends Error {
	public readonly problem: FormulaProblem;

	public readonly subject: string;

	public readonly others: string[];

	public constructor(problem: FormulaProblem, subject = '', others: string[] = []) {
		super(subject === '' ? problem : `${problem}: ${subject}`);
		this.name = 'FormulaError';
		this.problem = problem;
		this.subject = subject;
		this.others = others;
	}
}

export type Named = { id: string; name: string };

/** What a formula on one table may name. */
export type Scope = {
	/** The row's own fields. */
	fields: Named[];
	/** The tables that link to this one. */
	tables: Named[];
	/** The fields a dot reaches from a link field (its table's) or from a linking table (its own). */
	through(id: string): Named[] | undefined;
	/** The fields a linking table links here through. */
	links(tableId: string): Named[];
};

const TOKEN = /\{\{([a-z]_[0-9a-z]+)\}\}/gu;
const PAIR = /\{\{([a-z]_[0-9a-z]+)\}\}(?:\.\{\{([a-z]_[0-9a-z]+)\}\})?/gu;

function normal(name: string): string {
	return name.trim().toLowerCase();
}

/** A table's fields and the tables linking to it, as `toStored` resolves them. */
export function scopeOf(ws: Workspace, tableId: string, without: string | null = null): Scope {
	const table = ws.table(tableId);
	const tables = table === undefined ? [] : ws.tables(table.base);
	const linksHere = (id: string): Named[] =>
		ws.fields(id).filter((field) => field.type === 'link' && field.target === tableId);

	return {
		fields: ws.fields(tableId).filter((field) => field.id !== without),
		tables: tables.filter((other) => linksHere(other.id).length > 0),
		through(id) {
			const field = ws.field(id);
			if (field?.type === 'link' && field.target !== null && field.table === tableId) {
				return ws.table(field.target) === undefined ? undefined : ws.fields(field.target);
			}
			return ws.table(id) !== undefined && linksHere(id).length > 0 ? ws.fields(id) : undefined;
		},
		links: linksHere
	};
}

/** Every name a stored formula of this base may hold, for `toDisplay`. */
export function namesIn(ws: Workspace, baseId: string): Named[] {
	const tables = ws.tables(baseId);
	return [...tables, ...tables.flatMap((table) => ws.fields(table.id))];
}

function readQuoted(expr: string, start: number, close: string): { text: string; end: number } {
	let text = '';
	let i = start + 1;

	while (i < expr.length) {
		const char = expr[i];
		if (char === close) {
			if (expr[i + 1] === close && close !== ']') {
				text += close;
				i += 2;
				continue;
			}
			return { text, end: i + 1 };
		}
		text += char;
		i += 1;
	}

	throw new FormulaError(close === "'" ? 'unclosed-text' : 'unclosed-name');
}

function skipSpaces(expr: string, from: number): number {
	let i = from;
	while (i < expr.length && /\s/u.test(expr[i])) {
		i += 1;
	}
	return i;
}

type Name = { text: string; end: number; kind: 'quoted' | 'token' | 'word' };

const WORD_START = /[\p{L}_]/u;
const WORD_PART = /[\p{L}\p{N}_]/u;

/** A name starting at `i`, or null; a bare word followed by `(` is a function, not a name. */
function readName(expr: string, i: number): Name | null {
	const char = expr[i];
	if (char === '"' || char === '`' || char === '[') {
		const { text, end } = readQuoted(expr, i, char === '[' ? ']' : char);
		return { text, end, kind: 'quoted' };
	}
	if (expr.startsWith('{{', i)) {
		const close = expr.indexOf('}}', i);
		const id = close < 0 ? '' : expr.slice(i + 2, close);
		return { text: id, end: close < 0 ? expr.length : close + 2, kind: 'token' };
	}
	if (char !== undefined && WORD_START.test(char)) {
		let end = i + 1;
		while (end < expr.length && WORD_PART.test(expr[end])) {
			end += 1;
		}
		return { text: expr.slice(i, end), end, kind: 'word' };
	}
	return null;
}

function isScope(value: Named[] | Scope): value is Scope {
	return !Array.isArray(value);
}

function asScope(value: Named[] | Scope): Scope {
	return isScope(value)
		? value
		: { fields: value, tables: [], through: () => undefined, links: () => [] };
}

function find(names: Named[], name: Name): string | undefined {
	if (name.kind === 'token') {
		return names.some((named) => named.id === name.text) ? name.text : undefined;
	}
	const wanted = normal(name.text);
	return names.find((named) => normal(named.name) === wanted)?.id;
}

export function toStored(expr: string, fields: Named[] | Scope): string {
	const scope = asScope(fields);
	let out = '';
	let i = 0;

	while (i < expr.length) {
		const char = expr[i];

		if (char === "'") {
			const { end } = readQuoted(expr, i, "'");
			out += expr.slice(i, end);
			i = end;
			continue;
		}
		if (char === ';') {
			throw new FormulaError('one-expression');
		}
		if (char === '-' && expr[i + 1] === '-') {
			const end = expr.indexOf('\n', i);
			i = end < 0 ? expr.length : end;
			continue;
		}

		const name = readName(expr, i);
		if (name === null) {
			out += char;
			i += 1;
			continue;
		}
		if (name.kind === 'word' && expr[skipSpaces(expr, name.end)] === '(') {
			out += name.text;
			i = name.end;
			continue;
		}

		const own = find(scope.fields, name);
		const table = find(scope.tables, name);
		const dot = skipSpaces(expr, name.end);
		const second = expr[dot] === '.' ? readName(expr, skipSpaces(expr, dot + 1)) : null;

		if (second !== null && (own !== undefined || table !== undefined)) {
			const readings = [own, table].flatMap((id) => {
				if (id === undefined) return [];
				const reached = scope.through(id);
				const target = reached === undefined ? undefined : find(reached, second);
				return target === undefined ? [] : [`{{${id}}}.{{${target}}}`];
			});
			if (readings.length > 1) {
				throw new FormulaError('two-readings', name.text);
			}
			if (readings.length === 0) {
				const reaches = [own, table].some((id) => id !== undefined && scope.through(id));
				throw reaches
					? new FormulaError('unknown-field', second.text)
					: new FormulaError('not-a-link', name.text);
			}
			out += readings[0];
			i = second.end;
			continue;
		}

		const id = own ?? table;
		if (id !== undefined) {
			out += `{{${id}}}`;
		} else if (name.kind === 'word') {
			out += name.text;
		} else {
			throw new FormulaError('unknown-field', name.text);
		}
		i = name.end;
	}

	if (out.trim() === '') {
		throw new FormulaError('empty');
	}

	const tableName = new Map(scope.tables.map((table) => [table.id, table.name]));
	const found = rollupsOf(out, (id) => tableName.has(id));
	if ('missing' in found) {
		throw new FormulaError('needs-aggregate', tableName.get(found.missing) ?? '');
	}
	for (const { table } of found) {
		const links = scope.links(table);
		if (links.length > 1) {
			throw new FormulaError(
				'two-links',
				tableName.get(table) ?? '',
				links.map((link) => link.name)
			);
		}
	}

	return out;
}

export function toDisplay(stored: string, names: Named[]): string {
	const byId = new Map(names.map((named) => [named.id, named.name]));
	const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

	return stored.replace(PAIR, (_, first: string, second: string | undefined) => {
		const one = byId.get(first);
		const two = second === undefined ? '' : byId.get(second);
		if (one === undefined || two === undefined) return 'NULL';
		return second === undefined ? quoted(one) : `${quoted(one)}.${quoted(two)}`;
	});
}

/** An aggregate call that folds a linking table's rows: `fn(` at `open`, its `)` at `close`. */
export type Rollup = { fn: string; from: number; open: number; close: number; table: string };

type Call = { fn: string; from: number; open: number; close: number };

/** The rollups of a stored formula, or the first linking table named outside an aggregate. */
export function rollupsOf(
	stored: string,
	isTable: (id: string) => boolean
): Rollup[] | { missing: string } {
	const open: Call[] = [];
	const uses: { table: string; calls: Call[] }[] = [];
	let word: { text: string; from: number } | null = null;
	let i = 0;

	while (i < stored.length) {
		const char = stored[i];
		if (char === "'") {
			const close = stored.indexOf("'", i + 1);
			i = close < 0 ? stored.length : close + 1;
			if (stored[i] === "'") continue;
			word = null;
		} else if (stored.startsWith('{{', i)) {
			const close = stored.indexOf('}}', i);
			const id = stored.slice(i + 2, close < 0 ? stored.length : close);
			if (isTable(id)) uses.push({ table: id, calls: [...open] });
			i = close < 0 ? stored.length : close + 2;
			word = null;
		} else if (WORD_START.test(char)) {
			let end = i + 1;
			while (end < stored.length && WORD_PART.test(stored[end])) end += 1;
			word = { text: stored.slice(i, end), from: i };
			i = end;
		} else if (char === '(') {
			open.push({ fn: word?.text ?? '', from: word?.from ?? i, open: i, close: -1 });
			word = null;
			i += 1;
		} else if (char === ')') {
			const call = open.pop();
			if (call !== undefined) call.close = i;
			word = null;
			i += 1;
		} else {
			if (!/\s/u.test(char)) word = null;
			i += 1;
		}
	}

	const found = new Map<Call, string>();
	for (const use of uses) {
		const call = use.calls.findLast((each) => AGGREGATE_NAMES.has(each.fn.toUpperCase()));
		const taken = call === undefined ? undefined : found.get(call);
		if (call === undefined || call.close < 0 || (taken !== undefined && taken !== use.table)) {
			return { missing: use.table };
		}
		found.set(call, use.table);
	}

	const rollups = [...found].map(([call, table]) => ({ ...call, table }));
	for (const rollup of rollups) {
		const nested = rollups.some(
			(other) => other !== rollup && other.open < rollup.open && rollup.close < other.close
		);
		if (nested) return { missing: rollup.table };
	}
	return rollups.sort((left, right) => left.open - right.open);
}

export function tokenIds(stored: string): string[] {
	return [...stored.matchAll(TOKEN)].map((match) => match[1]);
}

/** The field name being typed before `caret`: an open `"…"` or a bare word, never inside text or a comment; `owner` is the name before a dot. */
export type NameAt = { from: number; query: string; quoted: boolean; owner?: string };

const OWNER = /(?:"((?:[^"]|"")*)"|([\p{L}_][\p{L}\p{N}_]*))\s*\.\s*$/u;

function ownerBefore(expr: string, at: number): string | undefined {
	const match = OWNER.exec(expr.slice(0, at));
	if (match === null) return undefined;
	return match[1] === undefined ? match[2] : match[1].replaceAll('""', '"');
}

function withOwner(at: NameAt, expr: string): NameAt {
	const owner = ownerBefore(expr, at.from);
	return owner === undefined ? at : { ...at, owner };
}

export function nameAt(expr: string, caret: number): NameAt | null {
	let i = 0;
	while (i < caret) {
		const char = expr[i];
		if (char === "'" || char === '"') {
			const close = expr.indexOf(char, i + 1);
			if (close < 0 || close >= caret) {
				return char === '"'
					? withOwner({ from: i, query: expr.slice(i + 1, caret), quoted: true }, expr)
					: null;
			}
			i = close + 1;
		} else if (char === '-' && expr[i + 1] === '-') {
			const end = expr.indexOf('\n', i);
			if (end < 0 || end >= caret) return null;
			i = end + 1;
		} else {
			i += 1;
		}
	}
	const word = /(?<![\p{L}\p{N}_])[\p{L}_][\p{L}\p{N}_]*$/u.exec(expr.slice(0, caret));
	if (word !== null) {
		return withOwner({ from: caret - word[0].length, query: word[0], quoted: false }, expr);
	}
	const owner = ownerBefore(expr, caret);
	return owner === undefined ? null : { from: caret, query: '', quoted: false, owner };
}

/** Names starting with what was typed first, then the ones holding it; a bare word that already names one needs none. */
export function namesFor(at: NameAt, names: string[]): string[] {
	const needle = normal(at.query);
	if (!at.quoted && needle !== '' && names.some((name) => normal(name) === needle)) return [];
	const starting = names.filter((name) => normal(name).startsWith(needle));
	const holding = names.filter(
		(name) => !normal(name).startsWith(needle) && normal(name).includes(needle)
	);
	return [...starting, ...holding];
}

/** The functions whose name starts with a bare word being typed. */
export function functionsFor(at: NameAt): string[] {
	if (at.quoted || at.owner !== undefined || at.query === '') return [];
	const needle = at.query.toUpperCase();
	return FUNCTIONS.map((fn) => fn.name).filter((name) => name.startsWith(needle));
}

export function completeName(
	expr: string,
	caret: number,
	at: NameAt,
	name: string
): { text: string; caret: number } {
	const quoted = `"${name.replaceAll('"', '""')}"`;
	const rest = expr.slice(caret);
	const tail = at.quoted ? rest.replace(/^[^"\n]*"?/u, '') : rest.replace(/^[\p{L}\p{N}_]*/u, '');
	return { text: expr.slice(0, at.from) + quoted + tail, caret: at.from + quoted.length };
}

/** Writes `NAME(` over the word typed, the caret inside the parenthesis. */
export function completeFunction(
	expr: string,
	caret: number,
	at: NameAt,
	name: string
): { text: string; caret: number } {
	const tail = expr.slice(caret).replace(/^[\p{L}\p{N}_]*/u, '');
	const opened = /^\s*\(/u.exec(tail);
	const head = expr.slice(0, at.from) + name;
	return opened === null
		? { text: `${head}(${tail}`, caret: head.length + 1 }
		: { text: head + tail, caret: head.length + opened[0].length };
}

/** The function call holding `caret` and which of its arguments the caret is in. */
export function callAt(expr: string, caret: number): { name: string; arg: number } | null {
	const stack: { name: string; arg: number }[] = [];
	let word = '';
	let i = 0;
	while (i < caret) {
		const char = expr[i];
		if (char === "'" || char === '"' || char === '`') {
			const close = expr.indexOf(char, i + 1);
			if (close < 0 || close >= caret) break;
			i = close + 1;
			word = '';
			continue;
		}
		if (WORD_PART.test(char)) {
			word =
				/\s/u.test(expr[i - 1] ?? '') || !WORD_PART.test(expr[i - 1] ?? '') ? char : word + char;
		} else if (char === '(') {
			stack.push({ name: word.toUpperCase(), arg: 0 });
			word = '';
		} else if (char === ')') {
			stack.pop();
			word = '';
		} else if (char === ',') {
			const top = stack.at(-1);
			if (top !== undefined) top.arg += 1;
			word = '';
		} else if (!/\s/u.test(char)) {
			word = '';
		}
		i += 1;
	}
	return stack.findLast((call) => call.name !== '') ?? null;
}
