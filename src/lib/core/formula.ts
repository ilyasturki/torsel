/**
 * Formulas are SQL expressions over a row's own fields. They are written with field names and
 * stored with field ids (`{{f_…}}`), so renaming a field never breaks one.
 */
export class FormulaError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'FormulaError';
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

	throw new FormulaError(`unclosed ${close === "'" ? 'text' : 'name'}`);
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
				throw new FormulaError(`unknown field: "${text}"`);
			}
			out += `{{${id}}}`;
			i = end;
		} else if (expr.startsWith('{{', i)) {
			const end = expr.indexOf('}}', i);
			const id = end < 0 ? '' : expr.slice(i + 2, end);
			if (!ids.has(id)) {
				throw new FormulaError(`champ inconnu : ${id || expr.slice(i)}`);
			}
			out += `{{${id}}}`;
			i = end + 2;
		} else if (char === ';') {
			throw new FormulaError('a formula is one expression, with no ";"');
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
		throw new FormulaError('la formule est vide');
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
