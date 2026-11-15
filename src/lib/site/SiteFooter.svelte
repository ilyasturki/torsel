<script lang="ts">
	import { page } from '$app/state';

	import { site as t } from '#lib/i18n/site.ts';

	import { LEGAL_NAME, LEGAL_REGISTRATION, REPOSITORY, basePath, localePath } from './site.ts';

	const locale = $derived(page.params.lang ?? 'en');
	const twin = $derived(localePath(locale === 'fr' ? 'en' : 'fr', basePath(page.url.pathname)));

	const item = 'transition-colors motion hover:text-ink';
</script>

<footer
	class="flex flex-wrap justify-between gap-x-5 gap-y-1.5 rounded-panel bg-glass px-4 py-3.5 text-sm text-ink-2 shadow-raised backdrop-blur-glass"
>
	<span>{LEGAL_NAME}, {LEGAL_REGISTRATION}. {t.licensed}</span>
	<nav class="flex gap-4" aria-label={t.footerNav}>
		<a class={item} href={REPOSITORY} rel="me">{t.github}</a>
		<a class={item} href="/llms.txt">{t.llms}</a>
		<a class={item} href={localePath(locale, '/privacy')}>{t.privacy}</a>
		<a class={item} href={localePath(locale, '/terms')}>{t.terms}</a>
		<a
			class={item}
			href={twin}
			hreflang={locale === 'fr' ? 'en' : 'fr'}
			lang={locale === 'fr' ? 'en' : 'fr'}>{t.otherLanguage}</a
		>
	</nav>
</footer>
