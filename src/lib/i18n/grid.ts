import { plural } from './locale.ts';
import { area } from './runtime.ts';

const en = {
	rowAdded: 'Row added',
	invalid: {
		number: (draft: string) => `"${draft}" isn't a number.`,
		currency: (draft: string) => `"${draft}" isn't an amount.`,
		percent: (draft: string) => `"${draft}" isn't a percent.`,
		duration: (draft: string) => `"${draft}" isn't a duration.`,
		date: (draft: string) => `"${draft}" isn't a date.`,
		datetime: (draft: string) => `"${draft}" isn't a date and time.`,
		url: (draft: string) => `"${draft}" isn't a web address.`,
		email: (draft: string) => `"${draft}" isn't an email.`,
		phone: (draft: string) => `"${draft}" isn't a phone number.`,
		rating: (draft: string, min: number, max: number) =>
			`"${draft}" isn't a rating from ${min} to ${max}.`,
		link: (draft: string, table: string) => `"${draft}" isn't a row of ${table}.`,
		other: (draft: string) => `"${draft}" isn't valid.`
	},
	otherCurrency: (currency: string) => `This column is in ${currency}.`,
	cleared: (rows: number) => plural('en', rows, { one: 'Cell cleared', other: '# rows cleared' }),
	cut: (cells: number) => (cells === 1 ? 'Cut 1 cell' : `Cut ${cells} cells`),
	copied: (cells: number) => (cells === 1 ? 'Copied 1 cell' : `Copied ${cells} cells`),
	copyFailed: "Couldn't copy",
	pasteLabel: (cells: number) => (cells === 1 ? 'Cell pasted' : `${cells} cells pasted`),
	pasted: (cells: number, skipped: number, kept = 0) =>
		`Pasted ${cells} ${cells === 1 ? 'cell' : 'cells'}` +
		(skipped === 0 ? '' : `, ${skipped} ${skipped === 1 ? "value doesn't" : "values don't"} fit`) +
		(kept === 0 ? '' : `, ${kept} synced ${kept === 1 ? 'cell' : 'cells'} kept`),
	columnsFitted: 'Columns fitted',
	filled: (cells: number) => (cells === 1 ? 'Filled 1 cell' : `Filled ${cells} cells`),
	rowDeleted: (rows: number) => (rows === 1 ? 'Row deleted' : `${rows} rows deleted`),
	sortCleared: 'Sort cleared',
	sortChanged: 'Sort changed',
	cellChanged: (field: string) => `${field} changed`,
	columnResized: (field: string) => `${field} resized`,
	filterCleared: 'Filter cleared',
	filterChanged: 'Filter changed',
	filterBar: (conditions: string, shown: number, total: number) =>
		`${conditions}: ${shown} of ${total}`,
	clearFilter: 'Clear filter',
	nameOf: (field: string) => `Name of ${field}`,
	openRow: 'Open row',
	addRow: 'Add row',
	newRow: 'New row',
	editFormula: 'Edit formula',
	insertLeft: 'Insert left',
	insertRight: 'Insert right',
	hide: 'Hide',
	hiddenFields: (count: number) => (count === 1 ? '1 hidden field' : `${count} hidden fields`),
	showField: (name: string) => `Show ${name}`,
	showAll: 'Show all',
	fitAll: 'Fit all columns',
	fieldSettings: 'Field settings',
	filter: 'Filter',
	filterOf: (field: string) => `Filter ${field}`,
	sortAscending: 'Sort ascending',
	sortDescending: 'Sort descending',
	clearSort: 'Clear sort',
	addSort: 'Add to sort',
	sum: 'Sum',
	average: 'Average',
	count: 'Count',
	find: 'Find',
	replaceWith: 'Replace with',
	replaceAll: 'Replace all',
	findReplace: 'Find and replace',
	previousMatch: 'Previous match',
	nextMatch: 'Next match',
	matchOf: (at: number, total: number) => (at === 0 ? String(total) : `${at} of ${total}`),
	replaced: (cells: number) => (cells === 1 ? 'Replaced in 1 cell' : `Replaced in ${cells} cells`),
	replacedRefusing: (cells: number, refused: number) =>
		(cells === 1 ? 'Replaced in 1 cell' : `Replaced in ${cells} cells`) +
		(refused === 0 ? '' : refused === 1 ? ', 1 left as it was' : `, ${refused} left as they were`),
	replacedNone: (refused: number): string =>
		refused === 0 ? 'Nothing to replace' : "The new text doesn't fit these fields",
	type: 'Type',
	addOption: (name: string) => `Add "${name}"`,
	noMatch: 'No match',
	row: 'Row',
	rows: (count: number) => (count === 1 ? 'Row' : `${count} rows`),
	deleteRows: (count: number) => (count === 1 ? 'Delete row' : `Delete ${count} rows`),
	copyCells: (count: number) => (count === 1 ? 'Copy' : `Copy ${count} cells`),
	insertAbove: 'Insert row above',
	insertBelow: 'Insert row below',
	duplicate: 'Duplicate',
	duplicateRows: (count: number) => (count === 1 ? 'Duplicate row' : `Duplicate ${count} rows`),
	rowsDuplicated: (count: number) => (count === 1 ? 'Row duplicated' : `${count} rows duplicated`)
};

const fr: typeof en = {
	rowAdded: 'Ligne ajoutée',
	invalid: {
		number: (draft) => `« ${draft} » n’est pas un nombre.`,
		currency: (draft) => `« ${draft} » n’est pas un montant.`,
		percent: (draft) => `« ${draft} » n’est pas un pourcentage.`,
		duration: (draft) => `« ${draft} » n’est pas une durée.`,
		date: (draft) => `« ${draft} » n’est pas une date.`,
		datetime: (draft) => `« ${draft} » n’est pas une date avec heure.`,
		url: (draft) => `« ${draft} » n’est pas une adresse web.`,
		email: (draft) => `« ${draft} » n’est pas un email.`,
		phone: (draft) => `« ${draft} » n’est pas un numéro de téléphone.`,
		rating: (draft, min, max) => `« ${draft} » n’est pas une note de ${min} à ${max}.`,
		link: (draft, table) => `« ${draft} » n’est pas une ligne de ${table}.`,
		other: (draft) => `« ${draft} » n’est pas valide.`
	},
	otherCurrency: (currency) => `Cette colonne est en ${currency}.`,
	cleared: (rows) => plural('fr', rows, { one: 'Cellule effacée', other: '# lignes effacées' }),
	cut: (cells) => plural('fr', cells, { one: '# cellule coupée', other: '# cellules coupées' }),
	copied: (cells) => plural('fr', cells, { one: '# cellule copiée', other: '# cellules copiées' }),
	copyFailed: 'Copie impossible',
	pasteLabel: (cells) =>
		plural('fr', cells, { one: '# cellule collée', other: '# cellules collées' }),
	pasted: (cells, skipped, kept = 0) =>
		plural('fr', cells, { one: '# cellule collée', other: '# cellules collées' }) +
		(skipped === 0
			? ''
			: plural('fr', skipped, {
					one: ', # valeur ne rentre pas',
					other: ', # valeurs ne rentrent pas'
				})) +
		(kept === 0
			? ''
			: plural('fr', kept, {
					one: ', # synchronisée conservée',
					other: ', # synchronisées conservées'
				})),
	columnsFitted: 'Colonnes ajustées',
	filled: (cells) =>
		plural('fr', cells, { one: '# cellule remplie', other: '# cellules remplies' }),
	rowDeleted: (rows) =>
		plural('fr', rows, { one: 'Ligne supprimée', other: '# lignes supprimées' }),
	sortCleared: 'Tri retiré',
	sortChanged: 'Tri modifié',
	cellChanged: (field) => `« ${field} » modifié`,
	columnResized: (field) => `Colonne « ${field} » redimensionnée`,
	filterCleared: 'Filtre retiré',
	filterChanged: 'Filtre modifié',
	filterBar: (conditions, shown, total) => `${conditions} : ${shown} sur ${total}`,
	clearFilter: 'Retirer le filtre',
	nameOf: (field) => `Nom de ${field}`,
	openRow: 'Ouvrir la ligne',
	addRow: 'Ajouter une ligne',
	newRow: 'Nouvelle ligne',
	editFormula: 'Modifier la formule',
	insertLeft: 'Insérer à gauche',
	insertRight: 'Insérer à droite',
	hide: 'Masquer',
	hiddenFields: (count) =>
		plural('fr', count, { one: '# champ masqué', other: '# champs masqués' }),
	showField: (name) => `Afficher ${name}`,
	showAll: 'Tout afficher',
	fitAll: 'Ajuster toutes les colonnes',
	fieldSettings: 'Réglages du champ',
	filter: 'Filtrer',
	filterOf: (field) => `Filtrer ${field}`,
	sortAscending: 'Tri croissant',
	sortDescending: 'Tri décroissant',
	clearSort: 'Retirer le tri',
	addSort: 'Ajouter au tri',
	sum: 'Somme',
	average: 'Moyenne',
	count: 'Nombre',
	find: 'Rechercher',
	replaceWith: 'Remplacer par',
	replaceAll: 'Tout remplacer',
	findReplace: 'Rechercher et remplacer',
	previousMatch: 'Résultat précédent',
	nextMatch: 'Résultat suivant',
	matchOf: (at, total) => (at === 0 ? String(total) : `${at} sur ${total}`),
	replaced: (cells) =>
		plural('fr', cells, { one: '# cellule modifiée', other: '# cellules modifiées' }),
	replacedRefusing: (cells, refused) =>
		plural('fr', cells, { one: '# cellule modifiée', other: '# cellules modifiées' }) +
		(refused === 0
			? ''
			: plural('fr', refused, {
					one: ', # laissée telle quelle',
					other: ', # laissées telles quelles'
				})),
	replacedNone: (refused) =>
		refused === 0 ? 'Rien à remplacer' : 'Le nouveau texte ne va pas dans ces champs',
	type: 'Type',
	addOption: (name) => `Ajouter « ${name} »`,
	noMatch: 'Aucun résultat',
	row: 'Ligne',
	rows: (count) => plural('fr', count, { one: 'Ligne', other: '# lignes' }),
	deleteRows: (count) =>
		plural('fr', count, { one: 'Supprimer la ligne', other: 'Supprimer # lignes' }),
	copyCells: (count) => plural('fr', count, { one: 'Copier', other: 'Copier # cellules' }),
	insertAbove: 'Insérer une ligne au-dessus',
	insertBelow: 'Insérer une ligne en dessous',
	duplicate: 'Dupliquer',
	duplicateRows: (count) =>
		plural('fr', count, { one: 'Dupliquer la ligne', other: 'Dupliquer # lignes' }),
	rowsDuplicated: (count) =>
		plural('fr', count, { one: 'Ligne dupliquée', other: '# lignes dupliquées' })
};

export default { en, fr };

export const grid = area({ en, fr });
