export const LOCALES = ['en', 'fr'] as const;

export type Locale = (typeof LOCALES)[number];

export const BASE_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** The first tag whose language is supported: `fr-CA` gives `fr`, `de-DE` is skipped. */
export function pickLocale(tags: readonly string[]): Locale {
	for (const tag of tags) {
		const primary = tag.trim().split(/[-_]/u)[0].toLowerCase();
		if (isLocale(primary)) return primary;
	}
	return BASE_LOCALE;
}

/** An `Accept-Language` header's tags, most wanted first, without `q=0`. */
export function acceptedLanguages(header: string | null): string[] {
	return (header ?? '')
		.split(',')
		.map((part) => {
			const [tag, ...params] = part.trim().split(';');
			const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
			return { tag: tag.trim(), q: q === undefined ? 1 : Number(q.slice(2)) };
		})
		.filter(({ tag, q }) => tag !== '' && tag !== '*' && q > 0)
		.sort((a, b) => b.q - a.q)
		.map(({ tag }) => tag);
}

/** `#` in a form stands for the count. French `one` covers 0 and 1. */
export function plural(
	locale: Locale,
	count: number,
	forms: { one: string; other: string }
): string {
	const form = new Intl.PluralRules(locale).select(count) === 'one' ? forms.one : forms.other;
	return form.replaceAll('#', String(count));
}
