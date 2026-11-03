export type Theme = 'light' | 'dark' | null;

const SHEET_ID = 'dev-theme';

function rules(): CSSRule[] {
	return [...document.styleSheets].flatMap((sheet) => {
		try {
			return [...sheet.cssRules];
		} catch {
			return [];
		}
	});
}

function declarations(rule: CSSStyleRule, names: string[]): string {
	return names
		.map((name) => [name, rule.style.getPropertyValue(name)] as const)
		.filter(([, value]) => value !== '')
		.map(([name, value]) => `${name}: ${value};`)
		.join(' ');
}

/**
 * Copies app.css's two colour sets onto `[data-theme]`, so this page can show either scheme
 * whatever the system's: app.css only switches them on `prefers-color-scheme`.
 */
function install(): void {
	if (document.getElementById(SHEET_ID) !== null) return;

	const all = rules();
	const dark = all
		.filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule)
		.filter((rule) => rule.media.mediaText.includes('prefers-color-scheme: dark'))
		.flatMap((rule) => [...rule.cssRules])
		.find(
			(rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ':root'
		);
	const light = all.find(
		(rule): rule is CSSStyleRule =>
			rule instanceof CSSStyleRule &&
			rule.selectorText === ':root' &&
			rule.style.getPropertyValue('--canvas') !== ''
	);
	if (dark === undefined || light === undefined) return;

	const names = [...dark.style].filter((name) => name.startsWith('--'));
	const sheet = document.createElement('style');
	sheet.id = SHEET_ID;
	sheet.textContent = [
		`:root[data-theme='light'] { color-scheme: light; ${declarations(light, names)} }`,
		`:root[data-theme='dark'] { color-scheme: dark; ${declarations(dark, names)} }`
	].join('\n');
	document.head.append(sheet);
}

export function forceTheme(theme: Theme): void {
	install();
	if (theme === null) delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = theme;
}
