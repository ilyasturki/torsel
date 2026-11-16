import type { DefaultNames } from '../core/actions.ts';
import type { ViewType } from '../core/model.ts';
import { area } from './runtime.ts';

const en: DefaultNames = {
	base: 'Tables',
	field: 'Name',
	table: (number) => `Table ${number}`,
	column: (number) => `Column ${number}`,
	views: { grid: 'Grid', entry: 'Entry', list: 'List', chart: 'Chart' },
	copy: (name) => `${name} copy`
};

const fr: DefaultNames = {
	base: 'Tables',
	field: 'Nom',
	table: (number) => `Table ${number}`,
	column: (number) => `Colonne ${number}`,
	views: { grid: 'Grille', entry: 'Saisie', list: 'Liste', chart: 'Graphique' },
	copy: (name) => `${name} (copie)`
};

export default { en, fr };

/** Default names written into data, in the language of whoever makes the record. */
export const names = area({ en, fr });

/** A view still called by its type's default name, in any language and numbered or not, shows it in the current one; the stored name stays. */
export function viewName(view: { name: string; type: ViewType }): string {
	const [, stem = view.name, number] = /^(.*?)(?: (\d+))?$/u.exec(view.name) ?? [];
	if (![en, fr].some((set) => set.views[view.type] === stem)) return view.name;
	const shown = names.views[view.type];
	return number === undefined ? shown : `${shown} ${number}`;
}
