import { plural } from './locale.ts';
import { area } from './runtime.ts';

const en = {
	ask: 'Ask',
	history: 'History',
	newThread: 'New',
	signIn: 'Sign in to use the assistant',
	threads: 'Threads',
	threadName: 'Thread name',
	renameThread: (title: string) => `Rename ${title}`,
	deleteThread: (title: string) => `Delete ${title}`,
	noThreads: 'No threads yet.',
	edit: 'Edit',
	undoAll: 'Undo all',
	redoAll: 'Redo all',
	working: 'Working…',
	// What the assistant is doing, by the tool it calls.
	steps: {
		list_bases: 'Reading your bases…',
		describe_base: 'Reading the schema…',
		query: 'Reading the data…',
		add_rows: 'Adding rows…',
		update_rows: 'Changing rows…',
		delete_rows: 'Deleting rows…',
		create_base: 'Creating a base…',
		create_table: 'Creating a table…',
		add_field: 'Adding a field…',
		update_field: 'Changing a field…',
		create_view: 'Creating a view…',
		update_view: 'Changing a view…',
		rename: 'Renaming…',
		delete: 'Deleting…',
		import_file: 'Importing the file…',
		open: 'Opening…',
		export: 'Preparing the backup…',
		export_table: 'Exporting the table…',
		move: 'Moving…',
		duplicate: 'Duplicating…',
		read_source: 'Reading the link…',
		connect_source: 'Linking the table…',
		refresh_source: 'Refreshing the table…',
		update_source: 'Changing the source…'
	} as Record<string, string>,
	editingLast: 'Editing your last message',
	attachedFiles: 'Attached files',
	removeFile: (name: string) => `Remove ${name}`,
	prompt: 'Ask about your tables',
	attachFiles: 'Attach files',
	maxFiles: (count: number) => `${count} files at most`,
	stop: 'Stop',
	waitingUploads: 'Waiting for the files to upload',
	send: 'Send',
	uploadFailed: 'Upload failed.',
	kilobytes: (size: string) => `${size} KB`,
	megabytes: (size: string) => `${size} MB`,
	onSettings: 'Settings',
	onHome: 'All tables',
	onTable: (table: string, view: string | null, selected: number) => {
		const on = view === null ? `On ${table}` : `On ${table}, ${view}`;
		if (selected === 0) return on;
		return selected === 1 ? `${on}, 1 row selected` : `${on}, ${selected} rows selected`;
	},
	needsServer: 'The assistant needs a connection to the server.',
	somethingWrong: 'Something went wrong. Try again.',
	stopped: 'Stopped.',
	threadDeleted: 'Thread deleted',
	fileTooBig: 'Files go up to 10 MB.',
	undoSummary: (summary: string) => `Undo: ${summary}`,
	limit: (scope: 'account' | 'instance', time: string, today: boolean) => {
		const reached =
			scope === 'account'
				? 'You’ve reached today’s assistant limit.'
				: 'The assistant has reached today’s limit on this server.';
		return `${reached} Ask again ${today ? 'at' : 'tomorrow at'} ${time}.`;
	},

	busy: 'The assistant is busy. Try again in a moment.',
	keyRefused: 'This server’s API key was refused.',
	unreachable: 'This server can’t reach the assistant.',
	stoppedResponding: 'The assistant stopped responding. Try again.',
	nothingToRetry: 'Nothing to try again.',
	declined: 'The assistant declined this request.',
	outOfRoom: 'The reply ran out of room. Ask again in smaller steps.',
	stoppedAfter: (steps: number) => `Stopped after ${steps} steps. Ask again to carry on.`,
	serverWrong: 'Something went wrong on the server. Try again.',

	noThread: 'no such thread',
	toolThread: 'This conversation belongs to a connected tool. Start a new one to ask.',
	promptTooLong: 'prompt is too long',
	noAssistant: 'this server has no assistant configured',
	alreadyAnswering: 'this thread is already answering',
	titleNeeded: 'a title is needed',
	filesTooBig: 'files go up to 10 MB',
	unreadable: 'this file type can’t be read',
	partOutOfOrder: 'this part doesn’t follow the last one',
	limitReached: 'today’s assistant limit is reached',

	addRows: (count: number, table: string) =>
		count === 1 ? `Add 1 row to ${table}` : `Add ${count} rows to ${table}`,
	changeRows: (count: number, table: string) =>
		count === 1 ? `Change 1 row in ${table}` : `Change ${count} rows in ${table}`,
	deleteRows: (count: number, table: string) =>
		count === 1 ? `Delete 1 row from ${table}` : `Delete ${count} rows from ${table}`,
	importRows: (count: number, table: string) =>
		count === 1 ? `Import 1 row into ${table}` : `Import ${count} rows into ${table}`,
	newBase: (name: string) => `New base "${name}"`,
	newTable: (name: string) => `New table "${name}"`,
	newTableFrom: (name: string, file: string) => `New table "${name}" from ${file}`,
	newField: (name: string, table: string) => `New field "${name}" in ${table}`,
	changeField: (name: string, table: string) => `Change field "${name}" in ${table}`,
	newView: (name: string, table: string) => `New view "${name}" on ${table}`,
	changeView: (name: string, table: string) => `Change view "${name}" on ${table}`,
	deleteBase: (name: string) => `Delete base "${name}"`,
	deleteTable: (name: string) => `Delete table "${name}"`,
	deleteField: (name: string) => `Delete field "${name}"`,
	deleteView: (name: string) => `Delete view "${name}"`,
	renameBase: (before: string, after: string) => `Rename base "${before}" to "${after}"`,
	renameTable: (before: string, after: string) => `Rename table "${before}" to "${after}"`,
	renameView: (before: string, after: string) => `Rename view "${before}" to "${after}"`,
	restore: (name: string) => `Restore ${name}`,
	moveField: (name: string, table: string) => `Move field "${name}" in ${table}`,
	moveView: (name: string, table: string) => `Move view "${name}" on ${table}`
};

const q = (text: string): string => `« ${text} »`;

const fr: typeof en = {
	ask: 'Demander',
	history: 'Historique',
	newThread: 'Nouvelle',
	signIn: 'Connecte-toi pour utiliser l’assistant',
	threads: 'Conversations',
	threadName: 'Nom de la conversation',
	renameThread: (title) => `Renommer ${title}`,
	deleteThread: (title) => `Supprimer ${title}`,
	noThreads: 'Aucune conversation.',
	edit: 'Modifier',
	undoAll: 'Tout annuler',
	redoAll: 'Tout rétablir',
	working: 'En cours…',
	steps: {
		list_bases: 'Lecture de tes bases…',
		describe_base: 'Lecture du schéma…',
		query: 'Lecture des données…',
		add_rows: 'Ajout des lignes…',
		update_rows: 'Modification des lignes…',
		delete_rows: 'Suppression des lignes…',
		create_base: 'Création de la base…',
		create_table: 'Création de la table…',
		add_field: 'Ajout du champ…',
		update_field: 'Modification du champ…',
		create_view: 'Création de la vue…',
		update_view: 'Modification de la vue…',
		rename: 'Renommage…',
		delete: 'Suppression…',
		import_file: 'Import du fichier…',
		open: 'Ouverture…',
		export: 'Préparation de la sauvegarde…',
		export_table: 'Export de la table…',
		move: 'Déplacement…',
		duplicate: 'Duplication…',
		read_source: 'Lecture du lien…',
		connect_source: 'Liaison de la table…',
		refresh_source: 'Actualisation de la table…',
		update_source: 'Modification de la source…'
	},
	editingLast: 'Tu modifies ton dernier message',
	attachedFiles: 'Fichiers joints',
	removeFile: (name) => `Retirer ${name}`,
	prompt: 'Pose une question sur tes tables',
	attachFiles: 'Joindre des fichiers',
	maxFiles: (count) => `${count} fichiers au maximum`,
	stop: 'Arrêter',
	waitingUploads: 'Envoi des fichiers en cours',
	send: 'Envoyer',
	uploadFailed: 'Échec de l’envoi.',
	kilobytes: (size) => `${size} Ko`,
	megabytes: (size) => `${size} Mo`,
	onSettings: 'Réglages',
	onHome: 'Toutes les tables',
	onTable: (table, view, selected) => {
		const on = view === null ? `Sur ${table}` : `Sur ${table}, ${view}`;
		if (selected === 0) return on;
		return plural('fr', selected, {
			one: `${on}, # ligne sélectionnée`,
			other: `${on}, # lignes sélectionnées`
		});
	},
	needsServer: 'L’assistant a besoin d’une connexion au serveur.',
	somethingWrong: 'Un problème est survenu. Réessaie.',
	stopped: 'Arrêté.',
	threadDeleted: 'Conversation supprimée',
	fileTooBig: 'Fichiers limités à 10 Mo.',
	undoSummary: (summary) => `Annulation : ${summary}`,
	limit: (scope, time, today) => {
		const reached =
			scope === 'account'
				? 'Tu as atteint la limite du jour de l’assistant.'
				: 'L’assistant a atteint la limite du jour sur ce serveur.';
		return `${reached} Redemande ${today ? 'à' : 'demain à'} ${time}.`;
	},

	busy: 'L’assistant est occupé. Réessaie dans un instant.',
	keyRefused: 'La clé d’API de ce serveur a été refusée.',
	unreachable: 'Ce serveur n’arrive pas à joindre l’assistant.',
	stoppedResponding: 'L’assistant ne répond plus. Réessaie.',
	nothingToRetry: 'Rien à réessayer.',
	declined: 'L’assistant a refusé cette demande.',
	outOfRoom: 'La réponse a manqué de place. Redemande en plusieurs étapes.',
	stoppedAfter: (steps) =>
		plural('fr', steps, {
			one: 'Arrêté après # étape. Redemande pour continuer.',
			other: 'Arrêté après # étapes. Redemande pour continuer.'
		}),
	serverWrong: 'Un problème est survenu sur le serveur. Réessaie.',

	noThread: 'conversation introuvable',
	toolThread:
		'Cette conversation appartient à un outil connecté. Ouvre-en une nouvelle pour poser ta question.',
	promptTooLong: 'message trop long',
	noAssistant: 'ce serveur n’a pas d’assistant configuré',
	alreadyAnswering: 'cette conversation répond déjà',
	titleNeeded: 'il faut un titre',
	filesTooBig: 'fichiers limités à 10 Mo',
	unreadable: 'ce type de fichier ne peut pas être lu',
	partOutOfOrder: 'cette partie ne suit pas la précédente',
	limitReached: 'la limite du jour de l’assistant est atteinte',

	addRows: (count, table) =>
		plural('fr', count, {
			one: `# ligne ajoutée à ${table}`,
			other: `# lignes ajoutées à ${table}`
		}),
	changeRows: (count, table) =>
		plural('fr', count, {
			one: `# ligne modifiée dans ${table}`,
			other: `# lignes modifiées dans ${table}`
		}),
	deleteRows: (count, table) =>
		plural('fr', count, {
			one: `# ligne supprimée de ${table}`,
			other: `# lignes supprimées de ${table}`
		}),
	importRows: (count, table) =>
		plural('fr', count, {
			one: `# ligne importée dans ${table}`,
			other: `# lignes importées dans ${table}`
		}),
	newBase: (name) => `Nouvelle base ${q(name)}`,
	newTable: (name) => `Nouvelle table ${q(name)}`,
	newTableFrom: (name, file) => `Nouvelle table ${q(name)} depuis ${file}`,
	newField: (name, table) => `Nouveau champ ${q(name)} dans ${table}`,
	changeField: (name, table) => `Champ ${q(name)} modifié dans ${table}`,
	newView: (name, table) => `Nouvelle vue ${q(name)} sur ${table}`,
	changeView: (name, table) => `Vue ${q(name)} modifiée sur ${table}`,
	deleteBase: (name) => `Base ${q(name)} supprimée`,
	deleteTable: (name) => `Table ${q(name)} supprimée`,
	deleteField: (name) => `Champ ${q(name)} supprimé`,
	deleteView: (name) => `Vue ${q(name)} supprimée`,
	renameBase: (before, after) => `Base ${q(before)} renommée en ${q(after)}`,
	renameTable: (before, after) => `Table ${q(before)} renommée en ${q(after)}`,
	renameView: (before, after) => `Vue ${q(before)} renommée en ${q(after)}`,
	restore: (name) => `Restauration de ${name}`,
	moveField: (name, table) => `Champ ${q(name)} déplacé dans ${table}`,
	moveView: (name, table) => `Vue ${q(name)} déplacée sur ${table}`
};

export default { en, fr };

/** The assistant's panel, its events and the change summaries the server writes. */
export const assistant = area({ en, fr });
