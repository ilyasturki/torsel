import { plural } from './locale.ts';
import { area } from './runtime.ts';

const en = {
	title: 'Import',
	notExport: 'This file isn’t a Torsel export.',
	noRows: 'This has no rows to import.',
	nothingRestored: 'Nothing to restore',
	restored: 'Export restored',
	imported: (count: number, table: string) =>
		plural('en', count, {
			one: `# row imported into "${table}"`,
			other: `# rows imported into "${table}"`
		}),
	leftEmpty: (done: string, unread: number) =>
		plural('en', unread, {
			one: `${done}, # value left empty`,
			other: `${done}, # values left empty`
		}),
	import: 'Import',
	restore: 'Restore',
	fileToImport: 'File to import',
	chooseFile: 'Choose a file',
	holds: (tables: number, rows: number) =>
		`This export holds ${plural('en', tables, { one: '# table', other: '# tables' })}, ${plural('en', rows, { one: '# row', other: '# rows' })}.`,
	replaces:
		'Everything in it comes back over what this device holds now, in one step you can undo.',
	into: 'Into',
	newTable: 'A new table',
	base: 'Base',
	size: (columns: number, rows: number) =>
		`${plural('en', columns, { one: '# column', other: '# columns' })}, ${plural('en', rows, { one: '# row', other: '# rows' })}`,
	columnName: (at: number) => `Name of column ${at}`,
	typeOf: (column: string) => `Type of ${column}`,
	newField: 'New field',
	skip: 'Skip',
	fieldFor: (column: string) => `Field for ${column}`,
	fileOrLink: 'File or link',
	continue: 'Continue',
	keyNeeded: 'Key needed',
	keepInSync: 'Keep in sync',
	found: (format: string, rows: number, more: boolean) =>
		`${format} · ${plural('en', rows, { one: '# row', other: '# rows' })}${more ? ' +' : ''}`
};

const fr: typeof en = {
	title: 'Importer',
	notExport: 'Ce fichier n’est pas un export Torsel.',
	noRows: 'Aucune ligne à importer.',
	nothingRestored: 'Rien à restaurer',
	restored: 'Export restauré',
	imported: (count, table) =>
		plural('fr', count, {
			one: `# ligne importée dans « ${table} »`,
			other: `# lignes importées dans « ${table} »`
		}),
	leftEmpty: (done, unread) =>
		plural('fr', unread, {
			one: `${done}, # valeur laissée vide`,
			other: `${done}, # valeurs laissées vides`
		}),
	import: 'Importer',
	restore: 'Restaurer',
	fileToImport: 'Fichier à importer',
	chooseFile: 'Choisir un fichier',
	holds: (tables, rows) =>
		`Cet export contient ${plural('fr', tables, { one: '# table', other: '# tables' })} et ${plural('fr', rows, { one: '# ligne', other: '# lignes' })}.`,
	replaces:
		'Tout son contenu remplace ce que cet appareil contient, en une seule étape que tu peux annuler.',
	into: 'Dans',
	newTable: 'Une nouvelle table',
	base: 'Base',
	size: (columns, rows) =>
		`${plural('fr', columns, { one: '# colonne', other: '# colonnes' })}, ${plural('fr', rows, { one: '# ligne', other: '# lignes' })}`,
	columnName: (at) => `Nom de la colonne ${at}`,
	typeOf: (column) => `Type de ${column}`,
	newField: 'Nouveau champ',
	skip: 'Ignorer',
	fieldFor: (column) => `Champ pour ${column}`,
	fileOrLink: 'Fichier ou lien',
	continue: 'Continuer',
	keyNeeded: 'Clé requise',
	keepInSync: 'Synchroniser',
	found: (format, rows, more) =>
		`${format} · ${plural('fr', rows, { one: '# ligne', other: '# lignes' })}${more ? ' +' : ''}`
};

export default { en, fr };

export const importing = area({ en, fr });
