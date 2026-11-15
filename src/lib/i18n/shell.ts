import { plural } from './locale.ts';
import { area } from './runtime.ts';

const en = {
	unreachable: 'Can’t reach this server.',
	notTorsel: 'This address isn’t a Torsel server.',
	serverProblem: 'This server is up but reports a problem.',
	sessionEnded: 'Your session has ended. Sign in again.',
	requestFailed: (status: number) => `Request failed (${status})`,
	noServer: 'No server connected.',
	nothingToUndo: 'Nothing to undo',
	nothingToRedo: 'Nothing to redo',
	undid: (label: string) => `Undid: ${label}`,
	redid: (label: string) => `Redid: ${label}`,
	tableCreated: (name: string) => `Table "${name}" created`,
	androidToken: 'Torsel on Android',
	tables: 'Tables',
	settings: 'Settings',
	allTables: 'All tables',
	ask: 'Ask',
	newRow: 'New row',
	rowCount: (count: number) => (count === 1 ? '1 row' : `${count} rows`),
	badAddress: 'That address doesn’t work.',
	serverAddress: 'Server address',
	connect: 'Connect',
	saveFailed: 'Couldn’t save on this device, <retry>retry</retry>',
	offline: (count: number) =>
		count === 1 ? 'Offline, 1 change waiting' : `Offline, ${count} changes waiting`,
	signedOut: (count: number) =>
		count === 0
			? 'Session expired, your data stays here, <signin>sign in again</signin>'
			: count === 1
				? 'Session expired, 1 waiting edit stays here until you <signin>sign in again</signin>'
				: `Session expired, ${count} waiting edits stay here until you <signin>sign in again</signin>`,
	syncFailed: 'Sync failed, <retry>retry</retry>',
	otherAccount: 'This device holds another account’s data, <erase>erase it</erase>'
};

const fr: typeof en = {
	unreachable: 'Impossible de joindre ce serveur.',
	notTorsel: 'Cette adresse n’est pas un serveur Torsel.',
	serverProblem: 'Ce serveur répond mais signale un problème.',
	sessionEnded: 'Ta session a expiré. Reconnecte-toi.',
	requestFailed: (status) => `La requête a échoué (${status})`,
	noServer: 'Aucun serveur connecté.',
	nothingToUndo: 'Rien à annuler',
	nothingToRedo: 'Rien à rétablir',
	undid: (label) => `Annulé : ${label}`,
	redid: (label) => `Rétabli : ${label}`,
	tableCreated: (name) => `Table « ${name} » créée`,
	androidToken: 'Torsel sur Android',
	tables: 'Tables',
	settings: 'Réglages',
	allTables: 'Toutes les tables',
	ask: 'Demander',
	newRow: 'Nouvelle ligne',
	rowCount: (count) => plural('fr', count, { one: '# ligne', other: '# lignes' }),
	badAddress: 'Cette adresse ne marche pas.',
	serverAddress: 'Adresse du serveur',
	connect: 'Connecter',
	saveFailed: 'Échec de l’enregistrement sur cet appareil, <retry>réessayer</retry>',
	offline: (count) =>
		plural('fr', count, {
			one: 'Hors ligne, # modification en attente',
			other: 'Hors ligne, # modifications en attente'
		}),
	signedOut: (count) =>
		count === 0
			? 'Session expirée, tes données restent ici, <signin>reconnecte-toi</signin>'
			: plural('fr', count, {
					one: 'Session expirée, # modification attend ici jusqu’à ce que tu te <signin>reconnectes</signin>',
					other:
						'Session expirée, # modifications attendent ici jusqu’à ce que tu te <signin>reconnectes</signin>'
				}),
	syncFailed: 'Échec de la synchro, <retry>réessayer</retry>',
	otherAccount: 'Cet appareil contient les données d’un autre compte, <erase>les effacer</erase>'
};

export default { en, fr };

export const shell = area({ en, fr });
