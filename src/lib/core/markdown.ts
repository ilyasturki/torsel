export type Inline = { kind: 'text' | 'strong' | 'em' | 'code'; text: string };

export type MarkdownBlock =
	| { kind: 'paragraph'; inline: Inline[] }
	| { kind: 'heading'; inline: Inline[] }
	| { kind: 'list'; ordered: boolean; items: Inline[][] }
	| { kind: 'code'; text: string }
	| { kind: 'table'; head: Inline[][]; rows: Inline[][][] };

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\s][^*\n]*\*)/u;

export function parseInline(text: string): Inline[] {
	return text
		.split(INLINE)
		.filter((part) => part !== '')
		.map((part): Inline => {
			if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
				return { kind: 'strong', text: part.slice(2, -2) };
			}
			if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
				return { kind: 'code', text: part.slice(1, -1) };
			}
			if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
				return { kind: 'em', text: part.slice(1, -1) };
			}
			return { kind: 'text', text: part };
		});
}

const BULLET = /^\s*[-*+]\s+(.*)$/u;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/u;
const HEADING = /^#{1,6}\s+(.*)$/u;
const FENCE = /^\s*```/u;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/u;

function cells(line: string): Inline[][] {
	return line
		.trim()
		.replace(/^\|/u, '')
		.replace(/\|$/u, '')
		.split('|')
		.map((cell) => parseInline(cell.trim()));
}

/** The subset a short assistant reply uses; everything else stays readable as text. */
export function parseMarkdown(source: string): MarkdownBlock[] {
	const lines = source.split('\n');
	const out: MarkdownBlock[] = [];
	let at = 0;

	while (at < lines.length) {
		const line = lines[at];

		if (line.trim() === '') {
			at += 1;
		} else if (FENCE.test(line)) {
			const code: string[] = [];
			at += 1;
			while (at < lines.length && !FENCE.test(lines[at])) {
				code.push(lines[at]);
				at += 1;
			}
			at += 1;
			out.push({ kind: 'code', text: code.join('\n') });
		} else if (HEADING.test(line)) {
			out.push({ kind: 'heading', inline: parseInline(line.replace(HEADING, '$1')) });
			at += 1;
		} else if (line.includes('|') && TABLE_RULE.test(lines[at + 1] ?? '')) {
			const rows: Inline[][][] = [];
			const head = cells(line);
			at += 2;
			while (at < lines.length && lines[at].includes('|')) {
				rows.push(cells(lines[at]));
				at += 1;
			}
			out.push({ kind: 'table', head, rows });
		} else if (BULLET.test(line) || NUMBERED.test(line)) {
			const ordered = NUMBERED.test(line);
			const marker = ordered ? NUMBERED : BULLET;
			const items: Inline[][] = [];
			while (at < lines.length && marker.test(lines[at])) {
				items.push(parseInline(lines[at].replace(marker, '$1')));
				at += 1;
			}
			out.push({ kind: 'list', ordered, items });
		} else {
			const paragraph: string[] = [];
			while (
				at < lines.length &&
				lines[at].trim() !== '' &&
				!FENCE.test(lines[at]) &&
				!HEADING.test(lines[at]) &&
				!BULLET.test(lines[at]) &&
				!NUMBERED.test(lines[at])
			) {
				paragraph.push(lines[at].trim());
				at += 1;
			}
			out.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) });
		}
	}

	return out;
}
