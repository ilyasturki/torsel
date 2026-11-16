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

function canonical(tag: string): string | undefined {
	try {
		return Intl.getCanonicalLocales(tag.trim().replaceAll('_', '-'))[0];
	} catch {
		return undefined;
	}
}

/**
 * The formats' locale: the system's first tag in the words' language (`fr-CA` keeps Canada), else
 * its first tag when the words fell back to English, else the language's own region.
 */
export function formatTag(tags: readonly string[], language: Locale): string {
	const valid = tags.flatMap((tag) => canonical(tag) ?? []);
	const own = valid.find((tag) => tag.split('-')[0].toLowerCase() === language);
	if (own !== undefined) return own;
	if (language === BASE_LOCALE && valid.length > 0) return valid[0];
	const region = new Intl.Locale(language).maximize().region;
	return region === undefined ? language : `${language}-${region}`;
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
