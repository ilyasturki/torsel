import { plural } from './locale.ts';
import { area } from './runtime.ts';

const en = {
	weekOf: (label: string, date: string) => `${label}, week of ${date}`,
	rolling: (label: string, days: number) => `${label}, ${days}-day rolling average`,
	empty: 'Empty',
	rows: (count: number, shown: string) => (count === 1 ? `${shown} row` : `${shown} rows`),
	baseDeleted: (name: string) => `Base "${name}" deleted`,
	noTables: 'No tables yet. Drop a CSV here or paste cells.',
	newTable: 'New table',
	importFile: 'Import',
	table: 'Table',
	figure: 'Figure',
	trend: 'Trend',
	lastEntry: 'Last entry',
	rowsHeading: 'Rows',
	ofTotal: (total: number) => `of ${total}`,
	newBase: 'New base',
	basePlaceholder: 'Gym, Money, Reading',
	baseCreated: (name: string) => `Base "${name}" created`,
	renameBase: 'Rename base',
	baseRenamed: 'Base renamed',
	notFound: 'Nothing at this address',
	screenBroke: 'Something broke on this screen',
	backToTables: 'Back to your tables',
	pageMissing: 'This page does not exist',
	pageBroke: 'Something broke on our side',
	pageMissingBody: 'The link may be old, or the address has a typo. Your data is not affected.',
	pageBrokeBody:
		'The error is ours, not yours. Your data is safe on this device. Try again in a moment.',
	torselHome: 'Torsel home',
	openTorsel: 'Open Torsel',
	backHome: 'Back to the home page'
};

const fr: typeof en = {
	weekOf: (label, date) => `${label}, semaine du ${date}`,
	rolling: (label, days) => `${label}, moyenne glissante sur ${days} jours`,
	empty: 'Vide',
	rows: (count, shown) => plural('fr', count, { one: `${shown} ligne`, other: `${shown} lignes` }),
	baseDeleted: (name) => `Base « ${name} » supprimée`,
	noTables: 'Aucune table. Dépose un CSV ici ou colle des cellules.',
	newTable: 'Nouvelle table',
	importFile: 'Importer',
	table: 'Table',
	figure: 'Chiffre',
	trend: 'Tendance',
	lastEntry: 'Dernière saisie',
	rowsHeading: 'Lignes',
	ofTotal: (total) => `sur ${total}`,
	newBase: 'Nouvelle base',
	basePlaceholder: 'Sport, Argent, Lecture',
	baseCreated: (name) => `Base « ${name} » créée`,
	renameBase: 'Renommer la base',
	baseRenamed: 'Base renommée',
	notFound: 'Rien à cette adresse',
	screenBroke: 'Cet écran a planté',
	backToTables: 'Retour à tes tables',
	pageMissing: 'Cette page n’existe pas',
	pageBroke: 'Quelque chose a cassé de notre côté',
	pageMissingBody:
		'Le lien est peut-être ancien, ou l’adresse contient une faute de frappe. Tes données ne sont pas touchées.',
	pageBrokeBody:
		'L’erreur vient de nous, pas de toi. Tes données sont en sécurité sur cet appareil. Réessaie dans un instant.',
	torselHome: 'Accueil de Torsel',
	openTorsel: 'Ouvrir Torsel',
	backHome: 'Retour à l’accueil'
};

export default { en, fr };

export const home = area({ en, fr });
