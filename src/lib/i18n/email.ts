import { area } from './runtime.ts';

const en = {
	ignore: 'If this wasn’t you, ignore this email. Nothing changes.',
	verifySubject: 'Confirm your email for Torsel',
	loginSubject: 'Your Torsel sign-in code',
	verifyIntro:
		'Enter this code in Torsel to finish creating your account. It works once, for 24 hours.',
	loginIntro: 'Enter this code in Torsel to sign in. It works once, for 30 minutes.',
	verifyAction: 'Confirm my email',
	loginAction: 'Sign in',
	orLink: (link: string) => `Or open this link on this device: ${link}`,
	passwordSet:
		'The password on your Torsel account was just set or changed. If this wasn’t you, sign in with an emailed code and set a new one.',
	passwordDropped:
		'You confirmed your Torsel account from a different browser than the one that created it, so its password was removed. Set a new one in Settings, or keep signing in with an emailed code.',
	passwordSubject: 'Your Torsel password changed'
};

const fr: typeof en = {
	ignore: 'Si ce n’était pas toi, ignore cet email. Rien ne change.',
	verifySubject: 'Confirme ton email pour Torsel',
	loginSubject: 'Ton code de connexion Torsel',
	verifyIntro:
		'Saisis ce code dans Torsel pour finir de créer ton compte. Il ne sert qu’une fois, pendant 24 heures.',
	loginIntro:
		'Saisis ce code dans Torsel pour te connecter. Il ne sert qu’une fois, pendant 30 minutes.',
	verifyAction: 'Confirmer mon email',
	loginAction: 'Se connecter',
	orLink: (link) => `Ou ouvre ce lien sur cet appareil : ${link}`,
	passwordSet:
		'Le mot de passe de ton compte Torsel vient d’être défini ou changé. Si ce n’était pas toi, connecte-toi avec un code reçu par email et choisis-en un nouveau.',
	passwordDropped:
		'Tu as confirmé ton compte Torsel depuis un autre navigateur que celui qui l’a créé, donc son mot de passe a été retiré. Choisis-en un nouveau dans les Réglages, ou continue à te connecter avec un code reçu par email.',
	passwordSubject: 'Ton mot de passe Torsel a changé'
};

export default { en, fr };

export const email = area({ en, fr });
