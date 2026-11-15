import { area } from './runtime.ts';

const en = {
	googleFailed: 'Google sign-in didn’t go through. Try again, or use your email.',
	googleClosed: 'This server doesn’t take new accounts, and this Google address has none.',
	emailCode: 'Email me a code',
	emailLink: 'Email me a sign-in link',
	offline: 'Couldn’t sign in. Check your connection and try again.',
	wrongPassword: 'Wrong email or password.',
	wrongCode: 'That code is wrong or has expired.',
	title: 'Sign in · Torsel',
	otherEmail: 'Use another email',
	google: 'Continue with Google',
	connectServer: 'Connect a server',
	serverIntro: 'Your account lives on a server. Enter its address to sign in.',
	keepOnPhone: 'Keep using Torsel on this phone',
	signInOrUp: 'Sign in or create an account',
	server: (address: string) => `Server: ${address}`,
	change: 'Change',
	email: 'Email',
	continue: 'Continue',
	keepWithout: 'Keep using Torsel without an account',
	consent:
		'By continuing you accept the <terms>terms</terms> and the <privacy>privacy policy</privacy>.',
	checkEmail: 'Check your email',
	noEmailService:
		'This server has no email service set up, so the message went to its log. Find the code there, or ask whoever runs the server.',
	codeSent: (email: string) => `We sent a 6-digit code to ${email}. Enter it here.`,
	mailSent: (email: string) =>
		`We sent an email to ${email}. Enter its 6-digit code here, or open its link on this device.`,
	sentAgain: 'Sent again. Check your spam folder too.',
	lostIt: 'Lost it? <send>Send a new one</send>.',
	nothingYet: 'Nothing after a minute? Check your spam folder, or <send>send it again</send>.',
	confirmEmail: 'Confirm your email',
	notConfirmed: 'This account isn’t confirmed yet. We’ll email you a way in.',
	signIn: 'Sign in',
	password: 'Password',
	createYours: 'Create your account',
	passwordOptional: 'Optional. Without one, you sign in with an emailed code.',
	createAccount: 'Create account',
	noAccount: 'No account for this email',
	noNewAccounts: 'This server doesn’t take new accounts.',
	signingIn: 'Signing you in…',
	signedIn: 'You’re signed in.',
	passwordDropped:
		'This link opened in a different browser from the one that created the account, so its password was removed. Set a new one in Settings.',
	openSettings: 'Open Settings',
	linkExpired: 'This link has expired or was already used.',
	backToSignIn: 'Back to sign in'
};

const fr: typeof en = {
	googleFailed: 'La connexion Google n’a pas abouti. Réessaie, ou utilise ton email.',
	googleClosed: 'Ce serveur n’accepte pas de nouveaux comptes, et cette adresse Google n’en a pas.',
	emailCode: 'M’envoyer un code',
	emailLink: 'M’envoyer un lien de connexion',
	offline: 'Connexion impossible. Vérifie ta connexion et réessaie.',
	wrongPassword: 'Email ou mot de passe incorrect.',
	wrongCode: 'Ce code est faux ou a expiré.',
	title: 'Connexion · Torsel',
	otherEmail: 'Utiliser un autre email',
	google: 'Continuer avec Google',
	connectServer: 'Connecter un serveur',
	serverIntro: 'Ton compte vit sur un serveur. Saisis son adresse pour te connecter.',
	keepOnPhone: 'Continuer sur ce téléphone sans compte',
	signInOrUp: 'Connecte-toi ou crée un compte',
	server: (address) => `Serveur : ${address}`,
	change: 'Changer',
	email: 'Email',
	continue: 'Continuer',
	keepWithout: 'Continuer sans compte',
	consent:
		'En continuant, tu acceptes les <terms>conditions</terms> et la <privacy>politique de confidentialité</privacy>.',
	checkEmail: 'Regarde tes emails',
	noEmailService:
		'Ce serveur n’a pas de service d’email, le message est donc parti dans son journal. Trouve le code là-bas, ou demande à qui gère le serveur.',
	codeSent: (email) => `Code à 6 chiffres envoyé à ${email}. Saisis-le ici.`,
	mailSent: (email) =>
		`Email envoyé à ${email}. Saisis son code à 6 chiffres ici, ou ouvre son lien sur cet appareil.`,
	sentAgain: 'Renvoyé. Regarde aussi dans tes spams.',
	lostIt: 'Perdu ? <send>En envoyer un nouveau</send>.',
	nothingYet: 'Rien après une minute ? Regarde dans tes spams, ou <send>renvoie-le</send>.',
	confirmEmail: 'Confirme ton email',
	notConfirmed: 'Ce compte n’est pas encore confirmé. On t’envoie un moyen d’entrer par email.',
	signIn: 'Se connecter',
	password: 'Mot de passe',
	createYours: 'Crée ton compte',
	passwordOptional: 'Facultatif. Sans mot de passe, tu te connectes avec un code reçu par email.',
	createAccount: 'Créer le compte',
	noAccount: 'Aucun compte pour cet email',
	noNewAccounts: 'Ce serveur n’accepte pas de nouveaux comptes.',
	signingIn: 'Connexion en cours…',
	signedIn: 'Tu es connecté.',
	passwordDropped:
		'Ce lien s’est ouvert dans un autre navigateur que celui qui a créé le compte, donc son mot de passe a été retiré. Choisis-en un nouveau dans les Réglages.',
	openSettings: 'Ouvrir les Réglages',
	linkExpired: 'Ce lien a expiré ou a déjà servi.',
	backToSignIn: 'Retour à la connexion'
};

export default { en, fr };

export const login = area({ en, fr });
