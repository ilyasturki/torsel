export type Named = { id: string; name: string };

const LONGEST = 60;
const SUFFIX = 4;

export function slugify(name: string): string {
	return name
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.slice(0, LONGEST)
		.replace(/^-+|-+$/gu, '');
}

function body(id: string): string {
	return id.slice(id.indexOf('_') + 1);
}

/** Items oldest first: the oldest keeps the plain slug, each later twin takes a piece of its own id. */
export function slugsOf(items: Named[]): Map<string, string> {
	const taken = new Set<string>();
	const out = new Map<string, string>();

	for (const item of items) {
		const plain = slugify(item.name);
		let slug = plain === '' ? item.id : plain;
		for (let length = SUFFIX; taken.has(slug) && length <= body(item.id).length; length += 1) {
			slug = `${plain}-${body(item.id).slice(0, length)}`;
		}
		if (taken.has(slug)) slug = item.id;
		taken.add(slug);
		out.set(item.id, slug);
	}

	return out;
}

/** An id, a current slug, or a twin's suffixed slug once the other twin is gone. */
export function resolveSlug(
	segment: string,
	items: Named[],
	slugs: Map<string, string>
): string | undefined {
	const exact = items.find((item) => item.id === segment || slugs.get(item.id) === segment);
	if (exact !== undefined) return exact.id;

	const suffixed = /^(.+)-([0-9a-z]{4,})$/u.exec(segment);
	return suffixed === null
		? undefined
		: items.find(
				(item) => slugify(item.name) === suffixed[1] && body(item.id).startsWith(suffixed[2])
			)?.id;
}
