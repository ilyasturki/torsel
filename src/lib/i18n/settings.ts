import { area } from './runtime.ts';

const en = {
	signedOut: 'Signed out. Your data stays on this device.',
	stillSignedIn: 'Couldn’t reach the server, so you’re still signed in.',
	passwordSaved: 'Password saved.',
	passwordFailed: 'Couldn’t save the password. Try again.',
	tokenFailed: 'Couldn’t create the token. Try again.',
	revokeFailed: 'Couldn’t revoke the token. Try again.',
	server: (address: string) => (address === '' ? 'Server' : `Server: ${address}`),
	account: 'Account',
	signOut: 'Sign out',
	newPassword: 'New password',
	password: 'Password',
	changeHint: 'Changing it signs out your other devices and revokes your MCP tokens and apps.',
	setHint: 'You sign in with an emailed code. A password makes it one step.',
	changePassword: 'Change password',
	setPassword: 'Set password',
	signIn: 'Sign in',
	serverUnreachable: 'Can’t reach the server right now.',
	agents: 'Agents (MCP)',
	apiDocs: 'API docs',
	tokenName: 'Token name',
	createToken: 'Create token',
	copyNow: 'Copy it now. It won’t be shown again.',
	copyCommand: 'Copy command',
	access: 'Access',
	expiry: 'Expiry',
	readWrite: 'Read and write',
	readOnly: 'Read only',
	noExpiry: 'No expiry',
	days: (count: number) => `${count} days`,
	oneYear: '1 year',
	tokenDetails: (
		prefix: string,
		access: 'read' | 'write',
		lastUsed: string | null,
		expires: { date: string; past: boolean } | null
	) =>
		[
			`${prefix}…`,
			access === 'read' ? 'read only' : 'read and write',
			lastUsed === null ? 'never used' : `last used ${lastUsed}`,
			...(expires === null ? [] : [`${expires.past ? 'expired' : 'expires'} ${expires.date}`])
		].join(', '),
	revoke: 'Revoke',
	connectedApps: 'Connected apps',
	appDetails: (host: string | null, access: 'read' | 'write', lastUsed: string | null) =>
		[
			...(host === null ? [] : [host]),
			access === 'read' ? 'read only' : 'read and write',
			lastUsed === null ? 'never used' : `last used ${lastUsed}`
		].join(', '),
	appRevokeFailed: 'Couldn’t revoke the app. Try again.',
	allData: 'All data on this device',
	import: 'Import',
	export: 'Export',
	cantUndo: 'This can’t be undone.',
	leavingDevice: 'Leaving this device for good?',
	leavingBrowser: 'Leaving this browser for good?',
	eraseForGood: 'Erase for good',
	eraseDevice: 'Erase this device',
	webToken: 'Web'
};

const fr: typeof en = {
	signedOut: 'Déconnecté. Tes données restent sur cet appareil.',
	stillSignedIn: 'Serveur injoignable, ta session reste ouverte.',
	passwordSaved: 'Mot de passe enregistré.',
	passwordFailed: 'Impossible d’enregistrer le mot de passe. Réessaie.',
	tokenFailed: 'Impossible de créer le jeton. Réessaie.',
	revokeFailed: 'Impossible de révoquer le jeton. Réessaie.',
	server: (address) => (address === '' ? 'Serveur' : `Serveur : ${address}`),
	account: 'Compte',
	signOut: 'Se déconnecter',
	newPassword: 'Nouveau mot de passe',
	password: 'Mot de passe',
	changeHint: 'Le changer déconnecte tes autres appareils et révoque tes jetons et apps MCP.',
	setHint:
		'Tu te connectes avec un code reçu par email. Avec un mot de passe, c’est une seule étape.',
	changePassword: 'Changer le mot de passe',
	setPassword: 'Définir un mot de passe',
	signIn: 'Se connecter',
	serverUnreachable: 'Serveur injoignable pour le moment.',
	agents: 'Agents (MCP)',
	apiDocs: 'Doc de l’API',
	tokenName: 'Nom du jeton',
	createToken: 'Créer un jeton',
	copyNow: 'Copie-le maintenant. Il ne sera plus affiché.',
	copyCommand: 'Copier la commande',
	access: 'Accès',
	expiry: 'Expiration',
	readWrite: 'Lecture et écriture',
	readOnly: 'Lecture seule',
	noExpiry: 'Sans expiration',
	days: (count) => `${count} jours`,
	oneYear: '1 an',
	tokenDetails: (prefix, access, lastUsed, expires) =>
		[
			`${prefix}…`,
			access === 'read' ? 'lecture seule' : 'lecture et écriture',
			lastUsed === null ? 'jamais utilisé' : `utilisé le ${lastUsed}`,
			...(expires === null ? [] : [`${expires.past ? 'a expiré le' : 'expire le'} ${expires.date}`])
		].join(', '),
	revoke: 'Révoquer',
	connectedApps: 'Apps connectées',
	appDetails: (host, access, lastUsed) =>
		[
			...(host === null ? [] : [host]),
			access === 'read' ? 'lecture seule' : 'lecture et écriture',
			lastUsed === null ? 'jamais utilisée' : `utilisée le ${lastUsed}`
		].join(', '),
	appRevokeFailed: 'Impossible de révoquer l’app. Réessaie.',
	allData: 'Toutes les données de cet appareil',
	import: 'Importer',
	export: 'Exporter',
	cantUndo: 'Impossible de revenir en arrière.',
	leavingDevice: 'Tu quittes cet appareil pour de bon ?',
	leavingBrowser: 'Tu quittes ce navigateur pour de bon ?',
	eraseForGood: 'Tout effacer',
	eraseDevice: 'Effacer cet appareil',
	webToken: 'Navigateur'
};

export default { en, fr };

export const settings = area({ en, fr });
