import type { DefaultNames } from '../core/actions.ts';
import { area } from './runtime.ts';

const en: DefaultNames = {
	base: 'Tables',
	field: 'Name',
	table: (number) => `Table ${number}`,
	column: (number) => `Column ${number}`,
	views: { grid: 'Grid', entry: 'Entry', list: 'List', chart: 'Chart' }
};

const fr: DefaultNames = {
	base: 'Tables',
	field: 'Nom',
	table: (number) => `Table ${number}`,
	column: (number) => `Colonne ${number}`,
	views: { grid: 'Grille', entry: 'Saisie', list: 'Liste', chart: 'Graphique' }
};

export default { en, fr };

/** Default names written into data, in the language of whoever makes the record. */
export const names = area({ en, fr });
