import { plural } from './locale.ts';
import { area } from './runtime.ts';

const en = {
	problems: {
		scheme: 'Not a web link',
		url: 'Not a web link',
		address: 'This address can’t be reached',
		timeout: 'The link took too long',
		network: 'Can’t reach this link',
		size: 'Over 10 MB',
		auth: 'Key refused',
		missing: 'Link not found',
		status: 'The site answered with an error',
		limit: 'Too many requests, try later',
		redirects: 'Too many redirects',
		html: 'A web page, not data',
		format: 'Unreadable data',
		rows: 'No rows there',
		cap: (rows: number) => `Over ${rows.toLocaleString('en')} rows`,
		empty: 'The source returned no rows',
		count: (sources: number) =>
			plural('en', sources, { one: '# linked table at most', other: '# linked tables at most' }),
		columns: 'Keep at least one column',
		base: 'No such base',
		gone: 'No such source',
		key: 'Keeping rows needs a column that tells them apart',
		busy: 'Too many links read, wait a minute'
	},
	brands: { letterboxd: 'Letterboxd', sheet: 'Google Sheets', github: 'GitHub' },
	key: 'Key',
	userPassword: 'user:password',
	connect: 'Connect',
	source: 'Source',
	refresh: 'Refresh',
	refreshing: 'Refreshing',
	refreshed: (when: string) => `Refreshed ${when}`,
	never: 'Not refreshed yet',
	every: 'Refresh',
	schedule: { manual: 'Manual', hour: 'Hourly', day: 'Daily' },
	missing: 'Missing at source',
	gone: { remove: 'Remove', keep: 'Keep' },
	save: 'Save',
	stop: 'Stop syncing',
	stopSure: 'Stop syncing for good',
	stopped: 'Syncing stopped',
	authKind: 'Sign in with',
	authKinds: { bearer: 'Bearer token', header: 'Header key', query: 'Query key', basic: 'Basic' },
	authName: { header: 'Header name', query: 'Parameter name' },
	retry: 'Retry',
	letterboxd: {
		title: 'Title',
		year: 'Year',
		watched: 'Date watched',
		rating: 'Rating',
		favorite: 'Favorite',
		rewatch: 'Rewatch',
		link: 'Link'
	},
	github: {
		number: 'Number',
		title: 'Title',
		state: 'State',
		author: 'Author',
		opened: 'Opened',
		closed: 'Closed',
		link: 'Link'
	},
	issues: (repo: string) => `${repo} issues`,
	connected: (table: string, from: string) => `"${table}" linked to ${from}`
};

const fr: typeof en = {
	problems: {
		scheme: 'Ce n’est pas un lien web',
		url: 'Ce n’est pas un lien web',
		address: 'Adresse injoignable',
		timeout: 'Le lien met trop de temps à répondre',
		network: 'Lien injoignable',
		size: 'Plus de 10 Mo',
		auth: 'Clé refusée',
		missing: 'Lien introuvable',
		status: 'Le site a répondu par une erreur',
		limit: 'Trop de requêtes, réessaie plus tard',
		redirects: 'Trop de redirections',
		html: 'Une page web, pas des données',
		format: 'Données illisibles',
		rows: 'Aucune ligne à cet endroit',
		cap: (rows) => `Plus de ${rows.toLocaleString('fr')} lignes`,
		empty: 'La source n’a renvoyé aucune ligne',
		count: (sources) =>
			plural('fr', sources, { one: '# table liée au plus', other: '# tables liées au plus' }),
		columns: 'Garde au moins une colonne',
		base: 'Base introuvable',
		gone: 'Source introuvable',
		key: 'Garder les lignes demande une colonne qui les distingue',
		busy: 'Trop de liens lus, attends une minute'
	},
	brands: { letterboxd: 'Letterboxd', sheet: 'Google Sheets', github: 'GitHub' },
	key: 'Clé',
	userPassword: 'utilisateur:mot de passe',
	connect: 'Connecter',
	source: 'Source',
	refresh: 'Actualiser',
	refreshing: 'Actualisation',
	refreshed: (when) => `Actualisé ${when}`,
	never: 'Pas encore actualisé',
	every: 'Actualiser',
	schedule: { manual: 'À la main', hour: 'Chaque heure', day: 'Chaque jour' },
	missing: 'Absent de la source',
	gone: { remove: 'Supprimer', keep: 'Garder' },
	save: 'Enregistrer',
	stop: 'Arrêter la synchro',
	stopSure: 'Arrêter pour de bon',
	stopped: 'Synchro arrêtée',
	authKind: 'Connexion par',
	authKinds: {
		bearer: 'Jeton Bearer',
		header: 'Clé d’en-tête',
		query: 'Clé dans l’URL',
		basic: 'Basic'
	},
	authName: { header: 'Nom de l’en-tête', query: 'Nom du paramètre' },
	retry: 'Réessayer',
	letterboxd: {
		title: 'Titre',
		year: 'Année',
		watched: 'Vu le',
		rating: 'Note',
		favorite: 'Coup de cœur',
		rewatch: 'Revu',
		link: 'Lien'
	},
	github: {
		number: 'Numéro',
		title: 'Titre',
		state: 'État',
		author: 'Auteur',
		opened: 'Ouvert le',
		closed: 'Fermé le',
		link: 'Lien'
	},
	issues: (repo) => `Tickets ${repo}`,
	connected: (table, from) => `« ${table} » liée à ${from}`
};

export default { en, fr };

export const sources = area({ en, fr });

export type SourceWords = typeof en;
