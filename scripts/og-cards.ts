import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The browser suite's own Playwright: it stays out of the app's dependencies and the Nix closure.
import playwright from '../tests/e2e/node_modules/playwright/index.js';

import siteCopy from '../src/lib/i18n/site.ts';

const root = join(import.meta.dirname, '..');
const logo = readFileSync(join(root, 'src/lib/ui/Logo.svelte'), 'utf8');
const [mark, word] = [...logo.matchAll(/\sd="([^"]+)"/gu)].map((match) => match[1]);
const font = (subset: string): string =>
	`data:font/woff2;base64,${readFileSync(
		join(
			root,
			`node_modules/@fontsource-variable/funnel-sans/files/funnel-sans-${subset}-wght-normal.woff2`
		)
	).toString('base64')}`;

const cards = { 'og.png': 'en', 'og-fr.png': 'fr' } as const;

const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [file, locale] of Object.entries(cards)) {
	const t = siteCopy[locale];
	await page.setContent(`<!doctype html><html lang="${locale}"><head><style>
@font-face { font-family: F; src: url(${font('latin')}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: F; src: url(${font('latin-ext')}) format('woff2'); font-weight: 100 900; unicode-range: U+0100-024F; }
html, body { margin: 0; width: 1200px; height: 630px; background: #000; color: #fff; font-family: F; }
body { display: grid; place-content: center; justify-items: center; }
svg { width: 528px; height: auto; display: block; }
h1 { font-size: 44px; font-weight: 600; letter-spacing: -0.01em; margin: 80px 0 0; }
p { font-size: 26px; color: #a3a5ad; margin: 14px 0 0; }
</style></head><body>
<svg viewBox="0 0 65.74 16" fill="#fff"><path fill-rule="evenodd" d="${mark}"/><path transform="translate(22)" d="${word}"/></svg>
<h1>${t.headline}</h1><p>${t.cardLead}</p></body></html>`);
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({ path: join(root, 'static', file) });
}
await browser.close();
