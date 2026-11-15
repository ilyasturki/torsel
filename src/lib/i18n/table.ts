import { area } from './runtime.ts';

const en = {
	tableDeleted: (name: string) => `Table "${name}" deleted`,
	renameTable: 'Rename table',
	fitAll: 'Fit all columns',
	importHere: 'Import into this table',
	exportCsv: 'Export as CSV',
	deleteTable: 'Delete table',
	newTable: 'New table',
	jump: 'Jump to a table',
	tableRenamed: 'Table renamed',
	tableName: 'Table name',
	rowChanged: 'Row changed',
	rowAdded: 'Row added',
	rowDeleted: 'Row deleted',
	row: 'Row',
	addRow: 'Add row',
	position: (at: number, total: number) => `${at} of ${total}`,
	previousRow: 'Previous row',
	nextRow: 'Next row',
	deleteRow: 'Delete row',
	notFound: 'Table not found',
	gone: 'This table no longer exists.',
	seeTables: 'See your tables',
	cantCalculate: (field: string, problem: string) => `${field} can't be calculated: ${problem}`,
	empty: 'This table is empty.',
	addField: 'Add a field',
	importFile: 'Import a file',
	noView: 'This table has no view yet. Add one with the plus above.'
};

const fr: typeof en = {
	tableDeleted: (name) => `Table « ${name} » supprimée`,
	renameTable: 'Renommer la table',
	fitAll: 'Ajuster toutes les colonnes',
	importHere: 'Importer dans cette table',
	exportCsv: 'Exporter en CSV',
	deleteTable: 'Supprimer la table',
	newTable: 'Nouvelle table',
	jump: 'Aller à une table',
	tableRenamed: 'Table renommée',
	tableName: 'Nom de la table',
	rowChanged: 'Ligne modifiée',
	rowAdded: 'Ligne ajoutée',
	rowDeleted: 'Ligne supprimée',
	row: 'Ligne',
	addRow: 'Ajouter la ligne',
	position: (at, total) => `${at} sur ${total}`,
	previousRow: 'Ligne précédente',
	nextRow: 'Ligne suivante',
	deleteRow: 'Supprimer la ligne',
	notFound: 'Table introuvable',
	gone: 'Cette table n’existe plus.',
	seeTables: 'Voir tes tables',
	cantCalculate: (field, problem) => `Impossible de calculer ${field} : ${problem}`,
	empty: 'Cette table est vide.',
	addField: 'Ajouter un champ',
	importFile: 'Importer un fichier',
	noView: 'Cette table n’a pas encore de vue. Ajoutes-en une avec le +, en haut.'
};

export default { en, fr };

export const table = area({ en, fr });
