import { plural } from './locale.ts';
import { area } from './runtime.ts';

const labels: Record<string, string> = {
	name: 'Name',
	type: 'Type',
	description: 'Description',
	expr: 'Formula',
	target: 'Links to',
	step: 'Step',
	hidden: 'Hidden',
	sort: 'Sort',
	filters: 'Filter',
	colors: 'Colours',
	totals: 'Totals',
	fields: 'Fields',
	match: 'Prefilled from',
	group: 'Grouped by',
	title: 'Title',
	show: 'Shown',
	kind: 'Chart',
	x: 'X axis',
	y: 'Y axis',
	bucket: 'Grouped by',
	agg: 'Value',
	color: 'Split by',
	rolling: 'Rolling average',
	newChoices: 'New choices',
	removedChoices: 'Removed choices'
};

const en = {
	labels,
	none: 'none',
	sorted: (field: string, ascending: boolean) =>
		`${field} ${ascending ? 'ascending' : 'descending'}`,
	rows: (count: number) => (count === 1 ? '1 row' : `${count} rows`),
	type: (type: string) => type,
	show: 'Show',
	undoChange: (summary: string) => `Undo ${summary}`,
	redoChange: (summary: string) => `Redo ${summary}`,
	row: 'Row',
	empty: 'empty',
	showLess: 'Show less',
	showAll: (count: number) => `Show all ${count}`
};

const FRENCH_TYPES: Record<string, string> = {
	text: 'texte',
	longtext: 'texte long',
	number: 'nombre',
	currency: 'montant',
	percent: 'pourcentage',
	rating: 'note',
	duration: 'durée',
	date: 'date',
	datetime: 'date et heure',
	choice: 'choix',
	choices: 'choix multiple',
	check: 'case à cocher',
	link: 'lien',
	url: 'URL',
	email: 'email',
	phone: 'téléphone',
	formula: 'formule',
	grid: 'grille',
	entry: 'saisie',
	list: 'liste',
	chart: 'graphique'
};

const fr: typeof en = {
	labels: {
		name: 'Nom',
		type: 'Type',
		description: 'Description',
		expr: 'Formule',
		target: 'Lié à',
		step: 'Pas',
		hidden: 'Masqués',
		sort: 'Tri',
		filters: 'Filtre',
		colors: 'Couleurs',
		totals: 'Totaux',
		fields: 'Champs',
		match: 'Prérempli depuis',
		group: 'Groupé par',
		title: 'Titre',
		show: 'Affichés',
		kind: 'Graphique',
		x: 'Axe X',
		y: 'Axe Y',
		bucket: 'Groupé par',
		agg: 'Valeur',
		color: 'Réparti par',
		rolling: 'Moyenne mobile',
		newChoices: 'Nouveaux choix',
		removedChoices: 'Choix retirés'
	},
	none: 'aucun',
	sorted: (field, ascending) => `${field} ${ascending ? 'croissant' : 'décroissant'}`,
	rows: (count) => plural('fr', count, { one: '# ligne', other: '# lignes' }),
	type: (type) => FRENCH_TYPES[type] ?? type,
	show: 'Afficher',
	undoChange: (summary) => `Annuler ${summary}`,
	redoChange: (summary) => `Rétablir ${summary}`,
	row: 'Ligne',
	empty: 'vide',
	showLess: 'Afficher moins',
	showAll: (count) => `Tout afficher (${count})`
};

export default { en, fr };

/** The words of an assistant change card. */
export const changes = area({ en, fr });
