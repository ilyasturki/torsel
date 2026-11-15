import type { FormulaError } from '../core/formula.ts';
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
		formula: 'Formula'
	} satisfies Record<FieldType, string>,
	groups: {
		text: 'Text',
		numbers: 'Numbers',
		dates: 'Dates',
		choices: 'Choices',
		links: 'Links and formulas'
	},
	fromFirstValue: 'From the first value',
	added: (name: string) => `Field "${name}" added`,
	changed: (name: string) => `Field "${name}" changed`,
	deleted: (name: string) => `Field "${name}" deleted`,
	moved: (name: string) => `Field "${name}" moved`,
	renamed: (name: string) => `Field "${name}" renamed`,
	hidden: (name: string) => `${name} hidden`,
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
	nameNeeded: 'Give this field a name.',
	unknownField: (name: string) => `unknown field: "${name}"`,
	unclosedName: 'unclosed name',
	unclosedText: 'unclosed text',
	oneExpression: 'a formula is one expression, with no ";"',
	emptyFormula: 'the formula is empty',
	selfReference: (name: string) => `"${name}" depends on itself`,
	sqliteRefused: (detail: string) => `SQLite refused the formula: ${detail}`,
	formulaOf: (name: string) => `Formula of ${name}`,
	formulaShort: '"Weight" * "Reps"',
	fieldList: 'Fields',
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
		formula: 'Formule'
	},
	groups: {
		text: 'Texte',
		numbers: 'Nombres',
		dates: 'Dates',
		choices: 'Choix',
		links: 'Liens et formules'
	},
	fromFirstValue: 'Automatique',
	added: (name) => `Champ « ${name} » ajouté`,
	changed: (name) => `Champ « ${name} » modifié`,
	deleted: (name) => `Champ « ${name} » supprimé`,
	moved: (name) => `Champ « ${name} » déplacé`,
	renamed: (name) => `Champ « ${name} » renommé`,
	hidden: (name) => `${name} masqué`,
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
	description: 'Description',
	moveLeft: 'Déplacer à gauche',
	moveRight: 'Déplacer à droite',
	formulaTakesOver: 'La formule remplace les valeurs actuelles.',
	pickLinkTable: 'Choisis la table à lier.',
	allCarryOver: 'Toutes les valeurs sont conservées.',
	valuesLost: (count, type) =>
		plural('fr', count, {
			one: `# valeur ne peut pas devenir ${type} et sera effacée.`,
			other: `# valeurs ne peuvent pas devenir ${type} et seront effacées.`
		}),
	nameNeeded: 'Donne un nom à ce champ.',
	unknownField: (name) => `champ inconnu : « ${name} »`,
	unclosedName: 'nom de champ non fermé',
	unclosedText: 'texte non fermé',
	oneExpression: 'une formule est une seule expression, sans « ; »',
	emptyFormula: 'la formule est vide',
	selfReference: (name) => `« ${name} » dépend de lui-même`,
	sqliteRefused: (detail) => `SQLite refuse la formule : ${detail}`,
	formulaOf: (name) => `Formule de ${name}`,
	formulaShort: '"Poids" * "Reps"',
	fieldList: 'Champs',
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
	}
}
