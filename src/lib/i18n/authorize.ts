import { area } from './runtime.ts';

const en = {
	title: 'Connect an app to Torsel',
	wantsWrite: (app: string) => `${app} wants to read and change your bases`,
	wantsRead: (app: string) => `${app} wants to read your bases`,
	publisher: 'Publisher',
	returnsTo: 'Returns to',
	account: 'Account',
	readOnly: 'Read only',
	loopback: 'Allow it only if you just started it on this computer.',
	allow: 'Allow',
	deny: 'Deny',
	failed: 'Couldn’t send your answer. Try again.',
	expired: 'This request expired',
	startAgain: 'Start again from the app.',
	unknownApp: 'Torsel doesn’t know this app',
	unreachable: 'Couldn’t reach this app',
	tryAgain: 'Try again in a moment.',
	badReturn: 'This app asked to return somewhere it didn’t declare',
	openTorsel: 'Open Torsel'
};

const fr: typeof en = {
	title: 'Connecter une app à Torsel',
	wantsWrite: (app) => `${app} veut lire et modifier tes bases`,
	wantsRead: (app) => `${app} veut lire tes bases`,
	publisher: 'Éditeur',
	returnsTo: 'Retour vers',
	account: 'Compte',
	readOnly: 'Lecture seule',
	loopback: 'Autorise-la seulement si tu viens de la lancer sur cet ordinateur.',
	allow: 'Autoriser',
	deny: 'Refuser',
	failed: 'Impossible d’envoyer ta réponse. Réessaie.',
	expired: 'Cette demande a expiré',
	startAgain: 'Recommence depuis l’app.',
	unknownApp: 'Torsel ne connaît pas cette app',
	unreachable: 'App injoignable',
	tryAgain: 'Réessaie dans un instant.',
	badReturn: 'Cette app demande un retour vers une adresse qu’elle n’a pas déclarée',
	openTorsel: 'Ouvrir Torsel'
};

export default { en, fr };

export const authorize = area({ en, fr });
