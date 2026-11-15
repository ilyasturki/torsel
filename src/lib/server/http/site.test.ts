import { describe, expect, it } from 'vitest';

import { firstVisitRedirect, wantedLocale } from './site.ts';

describe('the language a browser wants', () => {
	it('takes the first of english and french by preference', () => {
		expect(wantedLocale('fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr');
		expect(wantedLocale('de-DE,fr;q=0.7,en;q=0.9')).toBe('en');
		expect(wantedLocale('de-DE,fr-CA;q=0.5')).toBe('fr');
		expect(wantedLocale('en-GB,fr;q=0.9')).toBe('en');
	});

	it('falls back to english for none, nothing or a refusal', () => {
		expect(wantedLocale('de-DE,es')).toBe('en');
		expect(wantedLocale(null)).toBe('en');
		expect(wantedLocale('fr;q=0, en;q=0.1')).toBe('en');
	});
});

describe('the first visit', () => {
	const url = new URL('https://torsel.ilyasturki.com/privacy?x=1');

	it('sends a french browser to the french page with its query', () => {
		expect(firstVisitRedirect(url, false, false, 'fr-FR,fr')).toBe('/fr/privacy?x=1');
		expect(firstVisitRedirect(new URL('https://t.example/'), false, false, 'fr')).toBe('/fr');
	});

	it('leaves a returning visitor, a french address and an english browser where they are', () => {
		expect(firstVisitRedirect(url, false, true, 'fr-FR')).toBeNull();
		expect(firstVisitRedirect(url, true, false, 'fr-FR')).toBeNull();
		expect(firstVisitRedirect(url, false, false, 'en-US')).toBeNull();
		expect(firstVisitRedirect(url, false, false, null)).toBeNull();
	});
});
