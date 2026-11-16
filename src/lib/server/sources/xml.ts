export type XmlNode = {
	name: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	text: string;
};

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// No entity a DOCTYPE declares is expanded: a feed needs only these, and expansion is how XML bombs work.
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, entity: string) => {
		if (entity[0] === '#') {
			const code =
				entity[1] === 'x' || entity[1] === 'X'
					? Number.parseInt(entity.slice(2), 16)
					: Number.parseInt(entity.slice(1), 10);
			return Number.isInteger(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: whole;
		}
		return NAMED[entity.toLowerCase()] ?? whole;
	});
}

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/gu;

function attributes(source: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const match of source.matchAll(ATTR)) {
		attrs[match[1]] = decodeEntities(match[3] ?? match[4] ?? '');
	}
	return attrs;
}

const MAX_DEPTH = 64;

/** A lenient reader for feeds: the document's root element, or null when there is none. */
export function parseXml(source: string): XmlNode | null {
	const root: XmlNode = { name: '', attrs: {}, children: [], text: '' };
	const stack: XmlNode[] = [root];
	let at = 0;

	const top = (): XmlNode => stack[stack.length - 1];

	while (at < source.length) {
		const open = source.indexOf('<', at);
		if (open < 0) {
			top().text += decodeEntities(source.slice(at));
			break;
		}
		if (open > at) {
			top().text += decodeEntities(source.slice(at, open));
		}
		if (source.startsWith('<!--', open)) {
			const end = source.indexOf('-->', open + 4);
			at = end < 0 ? source.length : end + 3;
		} else if (source.startsWith('<![CDATA[', open)) {
			const end = source.indexOf(']]>', open + 9);
			top().text += source.slice(open + 9, end < 0 ? source.length : end);
			at = end < 0 ? source.length : end + 3;
		} else if (source.startsWith('<!', open) || source.startsWith('<?', open)) {
			// An internal DTD subset holds `>` inside its brackets.
			const subset = source.indexOf('[', open);
			const close = source.indexOf('>', open);
			const end = subset >= 0 && subset < close ? source.indexOf(']>', subset) + 1 : close;
			at = end <= 0 ? source.length : end + 1;
		} else {
			const close = source.indexOf('>', open);
			if (close < 0) break;
			const tag = source.slice(open + 1, close);
			at = close + 1;
			if (tag.startsWith('/')) {
				const name = tag.slice(1).trim();
				const index = stack.findLastIndex((node) => node.name === name);
				if (index > 0) stack.length = index;
				continue;
			}
			const selfClosing = tag.endsWith('/');
			const body = selfClosing ? tag.slice(0, -1) : tag;
			const name = body.match(/^[^\s/>]+/u)?.[0] ?? '';
			if (name === '') continue;
			const node: XmlNode = {
				name,
				attrs: attributes(body.slice(name.length)),
				children: [],
				text: ''
			};
			top().children.push(node);
			if (!selfClosing && stack.length <= MAX_DEPTH) {
				stack.push(node);
			}
		}
	}

	return root.children.find((node) => node.name !== '') ?? null;
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
	return node.children.find((candidate) => candidate.name === name);
}
