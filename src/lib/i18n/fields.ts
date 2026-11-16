import { BARE_AGGREGATE, type FormulaError } from '../core/formula.ts';
import type { ArgName } from '../core/functions.ts';
import type { FieldType } from '../core/model.ts';
import { plural } from './locale.ts';
import { area } from './runtime.ts';

const en = {
	types: {
		text: 'Text',
		longtext: 'Long text',
		url: 'URL',
		email: 'Email',
		phone: 'Phone',
		number: 'Number',
		currency: 'Currency',
		percent: 'Percent',
		rating: 'Rating',
		duration: 'Duration',
		date: 'Date',
		datetime: 'Date and time',
		choice: 'Choice',
		choices: 'Multiple choice',
		check: 'Checkbox',
		link: 'Link to a table',
		image: 'Image',
		formula: 'Formula'
	} satisfies Record<FieldType, string>,
	groups: {
		text: 'Text',
		numbers: 'Numbers',
		dates: 'Dates',
		choices: 'Choices',
		links: 'Links and formulas',
		files: 'Files'
	},
	fromFirstValue: 'From the first value',
	added: (name: string) => `Field "${name}" added`,
	changed: (name: string) => `Field "${name}" changed`,
	deleted: (name: string) => `Field "${name}" deleted`,
	duplicated: (name: string) => `Field "${name}" added`,
	moved: (name: string) => `Field "${name}" moved`,
	renamed: (name: string) => `Field "${name}" renamed`,
	hidden: (name: string) => `${name} hidden`,
	shown: (count: number) => (count === 1 ? 'Field shown' : `${count} fields shown`),
	refitted: (name: string) => `${name} refitted`,
	shifted: (name: string) => `${name} moved`,
	retyped: (name: string) => `${name} retyped`,
	retypedLosing: (name: string, lost: number) =>
		lost === 1 ? `${name} retyped, 1 value cleared` : `${name} retyped, ${lost} values cleared`,
	formulaChanged: (name: string) => `${name} formula changed`,
	choiceAdded: (name: string) => `Choice "${name}" added`,
	addField: 'Add a field',
	fieldName: 'Field name',
	fieldType: 'Field type',
	newField: 'New field',
	field: 'Field',
	name: 'Name',
	namePlaceholder: 'Weight, Exercise, Amount',
	type: 'Type',
	choiceList: 'Choices',
	removeChoice: (name: string) => `Remove ${name}`,
	addChoice: 'Add a choice',
	addThisChoice: 'Add this choice',
	linkedTable: 'Linked table',
	pickTable: 'Pick a table',
	formula: 'Formula',
	formulaExample: '"Weight" * (1 + "Reps" / 30.0)',
	decimals: 'Decimals',
	auto: 'Auto',
	unit: 'Unit',
	step: 'Step',
	groupThousands: 'Group thousands',
	currency: 'Currency',
	lowest: 'Lowest',
	highest: 'Highest',
	halfPoints: 'Half points',
	format: 'Format',
	shownAs: 'Shown as',
	description: 'Description',
	moveLeft: 'Move left',
	moveRight: 'Move right',
	formulaTakesOver: 'The values here give way to the formula.',
	pickLinkTable: 'Pick the table to link to.',
	allCarryOver: 'Every value carries over.',
	valuesLost: (count: number, type: string) =>
		count === 1
			? `1 value can't become ${type} and will be cleared.`
			: `${count} values can't become ${type} and will be cleared.`,
	fetchesImages: (count: number) =>
		count === 1
			? '1 link will be fetched as an image.'
			: `${count} links will be fetched as images.`,
	noImagesFetched: (why: string) => `No image could be fetched. ${why}`.trim(),
	fetchingImages: (count: number) =>
		count === 1 ? 'Fetching 1 image…' : `Fetching ${count} images…`,
	nameNeeded: 'Give this field a name.',
	nameTaken: (name: string) => `A field named "${name}" already exists.`,
	unknownField: (name: string) => `unknown field: "${name}"`,
	unclosedName: 'unclosed name',
	unclosedText: 'unclosed text',
	oneExpression: 'a formula is one expression, with no ";"',
	emptyFormula: 'the formula is empty',
	selfReference: (name: string) => `"${name}" depends on itself`,
	sqliteRefused: (detail: string) => `SQLite refused the formula: ${detail}`,
	columnTotal: 'a column total goes in the totals row, at the foot of the grid',
	notALink: (name: string) => `"${name}" isn't a link`,
	needsAggregate: (table: string) => `"${table}" holds several rows: wrap it in SUM, COUNT…`,
	twoLinks: (table: string, links: string[]) =>
		`"${table}" links here through ${links.map((link) => `"${link}"`).join(' and ')}: there's no telling which to follow`,
	twoReadings: (name: string) => `"${name}" is both a field here and a table: rename one`,
	suggestions: 'Suggestions',
	args: {
		value: 'value',
		text: 'text',
		count: 'count',
		start: 'start',
		length: 'length',
		search: 'search_for',
		replacement: 'replace_with',
		occurrence: 'occurrence',
		times: 'times',
		delimiter: 'delimiter',
		skipEmpty: 'skip_empty',
		pattern: 'pattern',
		date: 'date',
		startDate: 'start_date',
		endDate: 'end_date',
		unit: 'unit',
		months: 'months',
		type: 'type',
		places: 'places',
		number: 'number',
		divisor: 'divisor',
		power: 'power',
		low: 'low',
		high: 'high',
		condition: 'condition',
		ifTrue: 'if_true',
		ifFalse: 'if_false',
		fallback: 'if_blank',
		expression: 'expression',
		case: 'case',
		range: 'range',
		criterion: 'criterion',
		sumRange: 'sum_range'
	} satisfies Record<ArgName, string>,
	formulaOf: (name: string) => `Formula of ${name}`,
	formulaShort: '"Weight" * "Reps"',
	wholeColumn: 'Applies to the whole column',
	openLink: 'Open link',
	writeEmail: 'Write an email',
	call: 'Call',
	checked: 'Yes',
	yes: 'yes',
	no: 'no'
};

const fr: typeof en = {
	types: {
		text: 'Texte',
		longtext: 'Texte long',
		url: 'URL',
		email: 'Email',
		phone: 'Téléphone',
		number: 'Nombre',
		currency: 'Montant',
		percent: 'Pourcentage',
		rating: 'Note',
		duration: 'Durée',
		date: 'Date',
		datetime: 'Date et heure',
		choice: 'Choix',
		choices: 'Choix multiple',
		check: 'Case à cocher',
		link: 'Lien vers une table',
		image: 'Image',
		formula: 'Formule'
	},
	groups: {
		text: 'Texte',
		numbers: 'Nombres',
		dates: 'Dates',
		choices: 'Choix',
		links: 'Liens et formules',
		files: 'Fichiers'
	},
	fromFirstValue: 'Automatique',
	added: (name) => `Champ « ${name} » ajouté`,
	changed: (name) => `Champ « ${name} » modifié`,
	deleted: (name) => `Champ « ${name} » supprimé`,
	moved: (name) => `Champ « ${name} » déplacé`,
	duplicated: (name) => `Champ « ${name} » ajouté`,
	renamed: (name) => `Champ « ${name} » renommé`,
	hidden: (name) => `${name} masqué`,
	shown: (count) => plural('fr', count, { one: 'Champ affiché', other: '# champs affichés' }),
	refitted: (name) => `${name} ajusté`,
	shifted: (name) => `${name} déplacé`,
	retyped: (name) => `Type de ${name} changé`,
	retypedLosing: (name, lost) =>
		plural('fr', lost, {
			one: `Type de ${name} changé, # valeur effacée`,
			other: `Type de ${name} changé, # valeurs effacées`
		}),
	formulaChanged: (name) => `Formule de ${name} modifiée`,
	choiceAdded: (name) => `Choix « ${name} » ajouté`,
	addField: 'Ajouter un champ',
	fieldName: 'Nom du champ',
	fieldType: 'Type du champ',
	newField: 'Nouveau champ',
	field: 'Champ',
	name: 'Nom',
	namePlaceholder: 'Poids, Exercice, Montant',
	type: 'Type',
	choiceList: 'Choix',
	removeChoice: (name) => `Retirer ${name}`,
	addChoice: 'Ajouter un choix',
	addThisChoice: 'Ajouter ce choix',
	linkedTable: 'Table liée',
	pickTable: 'Choisir une table',
	formula: 'Formule',
	formulaExample: '"Poids" * (1 + "Reps" / 30.0)',
	decimals: 'Décimales',
	auto: 'Auto',
	unit: 'Unité',
	step: 'Pas',
	groupThousands: 'Séparer les milliers',
	currency: 'Devise',
	lowest: 'Minimum',
	highest: 'Maximum',
	halfPoints: 'Demi-points',
	format: 'Format',
	shownAs: 'Afficher en',
	description: 'Description',
	moveLeft: 'Déplacer à gauche',
	moveRight: 'Déplacer à droite',
	formulaTakesOver: 'La formule remplace les valeurs actuelles.',
	pickLinkTable: 'Choisis la table à lier.',
	allCarryOver: 'Toutes les valeurs sont conservées.',
	fetchesImages: (count) =>
		plural('fr', count, {
			one: '# lien sera récupéré en image.',
			other: '# liens seront récupérés en images.'
		}),
	noImagesFetched: (why) => `Aucune image n’a pu être récupérée. ${why}`.trim(),
	fetchingImages: (count) =>
		plural('fr', count, { one: 'Récupération de # image…', other: 'Récupération de # images…' }),
	valuesLost: (count, type) =>
		plural('fr', count, {
			one: `# valeur ne peut pas devenir ${type} et sera effacée.`,
			other: `# valeurs ne peuvent pas devenir ${type} et seront effacées.`
		}),
	nameNeeded: 'Donne un nom à ce champ.',
	nameTaken: (name) => `Un champ « ${name} » existe déjà.`,
	unknownField: (name) => `champ inconnu : « ${name} »`,
	unclosedName: 'nom de champ non fermé',
	unclosedText: 'texte non fermé',
	oneExpression: 'une formule est une seule expression, sans « ; »',
	emptyFormula: 'la formule est vide',
	selfReference: (name) => `« ${name} » dépend de lui-même`,
	sqliteRefused: (detail) => `SQLite refuse la formule : ${detail}`,
	columnTotal: 'un total de colonne se met dans la ligne des totaux, en bas de la grille',
	notALink: (name) => `« ${name} » n’est pas un lien`,
	needsAggregate: (table) => `« ${table} » a plusieurs lignes : mets-le dans SUM, COUNT…`,
	twoLinks: (table, links) =>
		`« ${table} » est lié ici par ${links.map((link) => `« ${link} »`).join(' et ')} : impossible de savoir lequel suivre`,
	twoReadings: (name) =>
		`« ${name} » est à la fois un champ d’ici et une table : renomme l’un des deux`,
	suggestions: 'Suggestions',
	args: {
		value: 'valeur',
		text: 'texte',
		count: 'nb',
		start: 'début',
		length: 'longueur',
		search: 'à_chercher',
		replacement: 'remplacer_par',
		occurrence: 'occurrence',
		times: 'fois',
		delimiter: 'séparateur',
		skipEmpty: 'ignorer_vides',
		pattern: 'motif',
		date: 'date',
		startDate: 'date_début',
		endDate: 'date_fin',
		unit: 'unité',
		months: 'mois',
		type: 'type',
		places: 'décimales',
		number: 'nombre',
		divisor: 'diviseur',
		power: 'puissance',
		low: 'min',
		high: 'max',
		condition: 'condition',
		ifTrue: 'si_vrai',
		ifFalse: 'si_faux',
		fallback: 'si_vide',
		expression: 'expression',
		case: 'cas',
		range: 'plage',
		criterion: 'critère',
		sumRange: 'plage_somme'
	},
	formulaOf: (name) => `Formule de ${name}`,
	formulaShort: '"Poids" * "Reps"',
	wholeColumn: 'S’applique à toute la colonne',
	openLink: 'Ouvrir le lien',
	writeEmail: 'Écrire un email',
	call: 'Appeler',
	checked: 'Oui',
	yes: 'oui',
	no: 'non'
};

export default { en, fr };

export const fields = area({ en, fr });

export function refusalText(words: typeof en, problem: string): string {
	return problem === BARE_AGGREGATE ? words.columnTotal : words.sqliteRefused(problem);
}

/** A formula's problem in `words`' language. */
export function formulaProblem(words: typeof en, error: FormulaError): string {
	switch (error.problem) {
		case 'unknown-field':
			return words.unknownField(error.subject);
		case 'unclosed-name':
			return words.unclosedName;
		case 'unclosed-text':
			return words.unclosedText;
		case 'one-expression':
			return words.oneExpression;
		case 'empty':
			return words.emptyFormula;
		case 'self-reference':
			return words.selfReference(error.subject);
		case 'not-a-link':
			return words.notALink(error.subject);
		case 'needs-aggregate':
			return words.needsAggregate(error.subject);
		case 'two-links':
			return words.twoLinks(error.subject, error.others);
		case 'two-readings':
			return words.twoReadings(error.subject);
	}
}
