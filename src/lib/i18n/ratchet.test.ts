import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { parse } from 'svelte/compiler';
import ts from 'typescript';
import { expect, it } from 'vitest';

type Literal = { file: string; line: number; text: string };

// Attributes whose value never reads as prose.
const CODE_ATTRS = new Set([
	'class',
	'href',
	'src',
	'type',
	'name',
	'id',
	'for',
	'rel',
	'role',
	'autocomplete',
	'inputmode',
	'enterkeyhint',
	'method',
	'action',
	'target',
	'd',
	'viewBox',
	'fill',
	'stroke',
	'xmlns',
	'style',
	'as',
	'content',
	'media',
	'sizes',
	'lang',
	'side',
	'align',
	'variant',
	'size',
	'tone',
	'icon',
	'kind',
	'mode',
	'accept',
	'spellcheck',
	'dir',
	'pattern'
]);

// Calls whose string arguments are for developers or the model, never a person.
const CODE_CALLS = new Set([
	'Error',
	'TypeError',
	'RangeError',
	'SyntaxError',
	'describe',
	'console',
	'ToolError',
	'QueryError',
	'SqlRefusal',
	'FetchRefused',
	'ApiError'
]);

// Object keys whose string values are for the model or the protocol.
const CODE_KEYS = new Set(['description', 'instructions', 'reason', 'mimeType', 'media_type']);

function prose(text: string): boolean {
	const value = text.trim();
	if (!/\p{L}{2}/u.test(value)) return false;
	if (/^(https?:|\/|#|\.\/|\.\.\/|@|\$|data:|mailto:|tel:)/u.test(value)) return false;
	if (!/\s/u.test(value) && /^[\w.:/@-]+$/u.test(value) && !/^[A-Z][a-z]+$/u.test(value)) {
		return false;
	}
	if (/^M[\d.]/u.test(value)) return false;
	const tokens = value.split(/\s+/u);
	const classes = tokens.filter(
		(token) => /[-:[/]/u.test(token) && !/^\p{Lu}\p{Ll}+-\p{Ll}/u.test(token)
	).length;
	if (
		tokens.every((token) => /^[\w:[\]/.%!()&>*+#,-]+$/u.test(token)) &&
		classes * 2 >= tokens.length
	) {
		return false;
	}
	if (/^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|PRAGMA|WITH|ALTER|DROP)\b/u.test(value)) return false;
	return true;
}

function calledName(node: ts.Node): string | undefined {
	const call = node.parent;
	if (call === undefined || !(ts.isCallExpression(call) || ts.isNewExpression(call)))
		return undefined;
	const callee = call.expression;
	if (ts.isIdentifier(callee)) return callee.text;
	if (ts.isPropertyAccessExpression(callee)) {
		return ts.isIdentifier(callee.expression) && callee.expression.text === 'console'
			? 'console'
			: callee.name.text;
	}
	return undefined;
}

function scanScript(file: string, code: string, offset: number, out: Literal[]): void {
	const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const push = (node: ts.Node, text: string): void => {
		const { line } = source.getLineAndCharacterOfPosition(node.getStart());
		out.push({ file, line: line + 1 + offset, text: text.replace(/\s+/gu, ' ').trim() });
	};
	const skipped = (node: ts.Node): boolean => {
		const { parent } = node;
		if (ts.isCaseClause(parent) || ts.isLiteralTypeNode(parent)) return true;
		if (
			ts.isBinaryExpression(parent) &&
			[ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(
				parent.operatorToken.kind
			)
		) {
			return true;
		}
		if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
			const key = parent.name.getText().replace(/['"]/gu, '');
			if (CODE_KEYS.has(key)) return true;
		}
		const name = calledName(node);
		return name !== undefined && CODE_CALLS.has(name);
	};
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
		if (ts.isElementAccessExpression(node)) {
			visit(node.expression);
			return;
		}
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
			if (!skipped(node) && prose(node.text)) push(node, node.text);
			return;
		}
		if (ts.isTemplateExpression(node)) {
			const fixed = node.head.text + node.templateSpans.map((span) => span.literal.text).join('');
			// A placeholder for each value, so `${name} hidden` reads as the sentence it is.
			const shaped =
				node.head.text + node.templateSpans.map((span) => `0${span.literal.text}`).join('');
			if (!skipped(node) && /\p{L}{2}/u.test(fixed) && prose(shaped)) {
				push(
					node,
					node.head.text +
						node.templateSpans
							.map((span) => `{${span.expression.getText()}}${span.literal.text}`)
							.join('')
				);
			}
			node.templateSpans.forEach((span) => visit(span.expression));
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
}

type SvelteNode = { type?: string; start?: number; end?: number; [key: string]: unknown };

function lineAt(code: string, at: number): number {
	return code.slice(0, at).split('\n').length;
}

function scanComponent(file: string, code: string, out: Literal[]): void {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const ast = parse(code, { modern: true }) as unknown as Record<string, SvelteNode | null>;
	for (const script of [ast.instance, ast.module]) {
		if (script === null || script === undefined) continue;
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		const content = script.content as { start: number; end: number };
		scanScript(file, code.slice(content.start, content.end), lineAt(code, content.start) - 1, out);
	}
	const expression = (node: SvelteNode): void => {
		if (node.start === undefined || node.end === undefined) return;
		scanScript(file, `(${code.slice(node.start, node.end)})`, lineAt(code, node.start) - 1, out);
	};
	const walk = (node: unknown): void => {
		if (node === null || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			node.forEach(walk);
			return;
		}
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		const svelte = node as SvelteNode;
		if (svelte.type === 'Script' || svelte.type === 'StyleSheet') return;
		if (svelte.type === 'Text') {
			const text = String(svelte.data).trim();
			if (/\p{L}{2}/u.test(text)) {
				out.push({ file, line: lineAt(code, svelte.start ?? 0), text: text.replace(/\s+/gu, ' ') });
			}
			return;
		}
		if (svelte.type === 'Attribute') {
			const name = String(svelte.name);
			if (name === 'class') return;
			const value = svelte.value;
			const parts = Array.isArray(value) ? value : value === true ? [] : [value];
			for (const part of parts as SvelteNode[]) {
				if (part.type === 'Text') {
					if (!CODE_ATTRS.has(name) && !name.startsWith('data-') && prose(String(part.data))) {
						out.push({ file, line: lineAt(code, part.start ?? 0), text: String(part.data).trim() });
					}
				} else if (part.type === 'ExpressionTag') {
					expression(part.expression as SvelteNode);
				}
			}
			return;
		}
		if (svelte.type === 'ExpressionTag' || svelte.type === 'HtmlTag') {
			expression(svelte.expression as SvelteNode);
			return;
		}
		for (const [key, value] of Object.entries(svelte)) {
			if (key === 'parent' || key === 'metadata' || value === null || typeof value !== 'object') {
				continue;
			}
			const child = value as SvelteNode;
			if (
				['expression', 'test', 'key', 'context', 'index'].includes(key) &&
				child.start !== undefined &&
				child.type !== 'Fragment'
			) {
				expression(child);
				continue;
			}
			walk(child);
		}
	};
	walk(ast.fragment);
}

// The dev page and text for crawlers and the model stay English; the legal pages and the demo's tables are written once per locale.
const OUTSIDE = new Set([
	'src/lib/dev',
	'src/routes/dev',
	'src/lib/site/legal',
	'src/lib/site/landing/examples.ts',
	'src/lib/site/landing/examples-fr.ts',
	'src/lib/site/seo.ts',
	'src/lib/site/site.ts',
	'src/lib/i18n',
	'src/routes/llms.txt',
	'src/routes/robots.txt',
	'src/routes/sitemap.xml'
]);

function sources(root: string, dir: string): string[] {
	return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (OUTSIDE.has(path)) return [];
		if (entry.isDirectory()) return sources(root, path);
		return /\.(svelte|ts)$/u.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
	});
}

function literals(root: string, dirs: string[]): Literal[] {
	const out: Literal[] = [];
	for (const file of dirs.flatMap((dir) => sources(root, dir))) {
		const code = readFileSync(join(root, file), 'utf8');
		const name = relative(root, join(root, file));
		if (file.endsWith('.svelte')) scanComponent(name, code, out);
		else scanScript(name, code, 0, out);
	}
	return out;
}

const ROOT = join(import.meta.dirname, '../../..');

// Literals that stay English on purpose: text for the model, protocol values. Only ever shrinks.
const ALLOWED = join(import.meta.dirname, 'english.json');

it('leaves no text a person reads outside the catalog', () => {
	const found = literals(ROOT, ['src/lib', 'src/routes']);
	const keys = [...new Set(found.map((literal) => `${literal.file}\t${literal.text}`))].sort();
	const only = process.env.TORSEL_RATCHET_FILES;
	if (only !== undefined) {
		const pattern = new RegExp(only, 'u');
		for (const literal of found.filter((item) => pattern.test(item.file))) {
			console.log(`${literal.file}:${literal.line}  ${literal.text}`);
		}
		return;
	}
	if (process.env.TORSEL_RATCHET === 'write') {
		writeFileSync(ALLOWED, `${JSON.stringify(keys, null, '\t')}\n`);
	}
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const allowed = new Set(
		existsSync(ALLOWED) ? (JSON.parse(readFileSync(ALLOWED, 'utf8')) as string[]) : []
	);
	const fresh = found
		.filter((literal) => !allowed.has(`${literal.file}\t${literal.text}`))
		.map((literal) => `${literal.file}:${literal.line}  ${literal.text}`);
	expect(fresh, 'move these into src/lib/i18n').toEqual([]);
	expect(
		[...allowed].filter((key) => !keys.includes(key)),
		'gone from the code: drop them from english.json'
	).toEqual([]);
});
