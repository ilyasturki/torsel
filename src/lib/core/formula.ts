/**
 * Formulas are SQL expressions over a row's own fields. They are written with field names and
 * stored with field ids (`{{f_…}}`), so renaming a field never breaks one.
 */
export type FormulaProblem =
	| 'unknown-field'
	| 'unclosed-name'
	| 'unclosed-text'
	| 'one-expression'
	| 'empty'
	| 'self-reference';

/** What `formulaProblem` reports, beside SQLite's own errors, for an aggregate without OVER: it folds the table's rows into one. */
export const BARE_AGGREGATE = 'bare-aggregate';

/** `subject` is the field the problem names; whoever shows it words the problem. */
export class FormulaError extends Error {
	public readonly problem: FormulaProblem;

	public readonly subject: string;

	public constructor(problem: FormulaProblem, subject = '') {
		super(subject === '' ? problem : `${problem}: ${subject}`);
		this.name = 'FormulaError';
		this.problem = problem;
		this.subject = subject;
	}
}

type Named = { id: string; name: string };

const TOKEN = /\{\{([a-z]_[0-9a-z]+)\}\}/gu;

function normal(name: string): string {
	return name.trim().toLowerCase();
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

function nextNonSpace(expr: string, from: number): string {
	let i = from;
	while (i < expr.length && /\s/u.test(expr[i])) {
		i += 1;
	}
	return expr[i] ?? '';
}

export function toStored(expr: string, fields: Named[]): string {
	const byName = new Map(fields.map((field) => [normal(field.name), field.id]));
	const ids = new Set(fields.map((field) => field.id));

	let out = '';
	let i = 0;

	while (i < expr.length) {
		const char = expr[i];

		if (char === "'") {
			const { end } = readQuoted(expr, i, "'");
			out += expr.slice(i, end);
			i = end;
		} else if (char === '"' || char === '`' || char === '[') {
			const { text, end } = readQuoted(expr, i, char === '[' ? ']' : char);
			const id = byName.get(normal(text));
			if (id === undefined) {
				throw new FormulaError('unknown-field', text);
			}
			out += `{{${id}}}`;
			i = end;
		} else if (expr.startsWith('{{', i)) {
			const end = expr.indexOf('}}', i);
			const id = end < 0 ? '' : expr.slice(i + 2, end);
			if (!ids.has(id)) {
				throw new FormulaError('unknown-field', id || expr.slice(i));
			}
			out += `{{${id}}}`;
			i = end + 2;
		} else if (char === ';') {
			throw new FormulaError('one-expression');
		} else if (char === '-' && expr[i + 1] === '-') {
			const end = expr.indexOf('\n', i);
			i = end < 0 ? expr.length : end;
		} else if (/[\p{L}_]/u.test(char)) {
			let end = i + 1;
			while (end < expr.length && /[\p{L}\p{N}_]/u.test(expr[end])) {
				end += 1;
			}
			const word = expr.slice(i, end);
			const id = nextNonSpace(expr, end) === '(' ? undefined : byName.get(normal(word));
			out += id === undefined ? word : `{{${id}}}`;
			i = end;
		} else {
			out += char;
			i += 1;
		}
	}

	if (out.trim() === '') {
		throw new FormulaError('empty');
	}

	return out;
}

export function refsOf(stored: string): string[] {
	return [...stored.matchAll(TOKEN)].map((match) => match[1]);
}

export function toDisplay(stored: string, fields: Named[]): string {
	const byId = new Map(fields.map((field) => [field.id, field.name]));

	return stored.replace(TOKEN, (_, id: string) => {
		const name = byId.get(id);
		return name === undefined ? 'NULL' : `"${name.replaceAll('"', '""')}"`;
	});
}

export function toSql(stored: string, columnOf: (fieldId: string) => string): string {
	return stored.replace(TOKEN, (_, id: string) => columnOf(id));
}

export type NameAt = { from: number; query: string; quoted: boolean };

/** The field name being typed before `caret`: an open `"…"` or a bare word, never inside text or a comment. */
export function nameAt(expr: string, caret: number): NameAt | null {
	let i = 0;
	while (i < caret) {
		const char = expr[i];
		if (char === "'" || char === '"') {
			const close = expr.indexOf(char, i + 1);
			if (close < 0 || close >= caret) {
				return char === '"' ? { from: i, query: expr.slice(i + 1, caret), quoted: true } : null;
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
	return word === null ? null : { from: caret - word[0].length, query: word[0], quoted: false };
}

/** Names starting with what was typed first, then the ones holding it; a bare word that already names one needs none. */
export function namesFor(at: NameAt, names: string[]): string[] {
	const needle = normal(at.query);
	if (!at.quoted && names.some((name) => normal(name) === needle)) return [];
	const starting = names.filter((name) => normal(name).startsWith(needle));
	const holding = names.filter(
		(name) => !normal(name).startsWith(needle) && normal(name).includes(needle)
	);
	return [...starting, ...holding];
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
