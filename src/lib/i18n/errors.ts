import { area } from './runtime.ts';

// The client capitalises these and ends them with a period.
const en = {
	authRequired: 'authentication required',
	databaseUnavailable: 'database unavailable',
	required: (field: string) => `${field} is required`,
	tooMany: 'Too many tries. Wait a moment and try again.',
	busy: 'too many sign-in attempts in flight, try again',
	passwordTooShort: (min: number) => `password must be at least ${min} characters`,
	emailInvalid: 'email is not a valid address',
	emailNotSent: 'the email could not be sent',
	wrongLogin: 'invalid email or password',
	confirmFirst: 'confirm your email first',
	tokenCannotChangePassword: 'an API token cannot change the password',
	noNewAccounts: 'this server does not take new accounts',
	noSuchCredential: 'no such credential',
	badCode: 'invalid or expired code',
	badLink: 'invalid or expired link'
};

const fr: typeof en = {
	authRequired: 'connexion requise',
	databaseUnavailable: 'base de données indisponible',
	required: (field) => `champ requis : ${field}`,
	tooMany: 'Trop d’essais. Attends un peu et réessaie.',
	busy: 'trop de connexions en cours, réessaie',
	passwordTooShort: (min) => `le mot de passe doit faire au moins ${min} caractères`,
	emailInvalid: 'cette adresse email n’est pas valide',
	emailNotSent: 'l’email n’a pas pu être envoyé',
	wrongLogin: 'email ou mot de passe incorrect',
	confirmFirst: 'confirme d’abord ton email',
	tokenCannotChangePassword: 'un jeton d’API ne peut pas changer le mot de passe',
	noNewAccounts: 'ce serveur n’accepte pas de nouveaux comptes',
	noSuchCredential: 'identifiant introuvable',
	badCode: 'code invalide ou expiré',
	badLink: 'lien invalide ou expiré'
};

export default { en, fr };

export const errors = area({ en, fr });
