import { plural } from './locale.ts';
import { area } from './runtime.ts';

const en = {
	home: 'Torsel home',
	github: 'GitHub',
	llms: 'llms.txt',
	signIn: 'Sign in',
	start: 'Start now',
	open: 'Open Torsel',
	siteNav: 'Site',
	footerNav: 'Footer',
	sampleBase: 'Sample',
	licensed: 'MIT licensed.',
	privacy: 'Privacy',
	terms: 'Terms',
	otherLanguage: 'Français',
	description:
		'A spreadsheet you just ask. Say what you need and Torsel writes the formula, adds the rows and draws the chart. It works offline and its code is open.',
	tagline: 'A spreadsheet you just ask.',
	cardLead: 'It writes the formula, adds the rows, draws the chart.',
	headline: 'Your numbers, taking shape.',
	lead: 'A spreadsheet you talk to. Log a line, ask for the rest.',
	tryTitle: 'Go ahead, it’s yours.',
	tryLead:
		'This is Torsel on sample tables. Edit a cell, ask for a chart. Nothing leaves your browser.',
	keepTitle: 'One table for each thing you keep track of.',
	weighIns: (count: number) => (count === 1 ? '1 weigh-in' : `${count} weigh-ins`),
	sets: (count: number) => (count === 1 ? '1 set' : `${count} sets`),
	movies: (count: number) => (count === 1 ? '1 movie' : `${count} movies`),
	closeTitle: 'Free and open source.',
	closeLead:
		'No account needed to start, and your tables stay in your browser until you sync them.',
	code: 'The code is on GitHub.',
	demo: 'The app on sample tables',
	examples: 'Examples',
	views: 'Views',
	prompts: 'Prompts',
	startOver: 'Start over',
	logoAlt: 'The Torsel logo',
	privacyDescription:
		'What stays on your device when you use Torsel, what leaves it, and who receives it.',
	termsDescription: 'The terms for using Torsel at torsel.ilyasturki.com, and who runs it.',
	updated: 'Last updated',
	api: 'API',
	apiDescription: 'Read and change your Torsel tables from any script or service, with a token.',
	apiAuth: 'Send a token from Settings, or one from an OAuth sign-in, in this header:',
	apiNames: 'Bases, tables and fields go by name or by id. A refusal says what to change.',
	apiSpec: 'OpenAPI document',
	apiOperations: 'Operations',
	apiParameters: 'Parameters',
	apiBody: 'Body',
	apiAnswer: 'Answer',
	apiRequired: 'required',
	apiWrite: 'read and write token'
};

const fr: typeof en = {
	home: 'Accueil de Torsel',
	github: 'GitHub',
	llms: 'llms.txt',
	signIn: 'Se connecter',
	start: 'Commencer',
	open: 'Ouvrir Torsel',
	siteNav: 'Navigation du site',
	footerNav: 'Pied de page',
	sampleBase: 'Exemple',
	licensed: 'Sous licence MIT.',
	privacy: 'Confidentialité',
	terms: 'Conditions',
	otherLanguage: 'English',
	description:
		'Le tableur qui fait ce que tu demandes. Dis ce qu’il te faut et Torsel écrit la formule, ajoute les lignes et trace le graphique. Il marche hors ligne et son code est ouvert.',
	tagline: 'Le tableur qui fait ce que tu demandes.',
	cardLead: 'Il écrit la formule, ajoute les lignes, trace le graphique.',
	headline: 'Tes chiffres prennent forme.',
	lead: 'Un tableur à qui tu parles. Tu notes une ligne, tu demandes le reste.',
	tryTitle: 'Vas-y, il est à toi.',
	tryLead:
		'Voici Torsel, sur des tables d’exemple. Modifie une cellule, demande un graphique. Rien ne sort de ton navigateur.',
	keepTitle: 'Une table pour chaque chose que tu notes.',
	weighIns: (count) => plural('fr', count, { one: '# pesée', other: '# pesées' }),
	sets: (count) => plural('fr', count, { one: '# série', other: '# séries' }),
	movies: (count) => plural('fr', count, { one: '# film', other: '# films' }),
	closeTitle: 'Gratuit et open source.',
	closeLead:
		'Pas besoin de compte pour commencer, et tes tables restent dans ton navigateur tant que tu ne les synchronises pas.',
	code: 'Le code est sur GitHub.',
	demo: 'L’app sur des tables d’exemple',
	examples: 'Exemples',
	views: 'Vues',
	prompts: 'Demandes',
	startOver: 'Recommencer',
	logoAlt: 'Le logo de Torsel',
	privacyDescription:
		'Ce qui reste sur ton appareil quand tu utilises Torsel, ce qui en sort et qui le reçoit.',
	termsDescription:
		'Les conditions d’utilisation de Torsel sur torsel.ilyasturki.com et qui l’édite.',
	updated: 'Mis à jour le',
	api: 'API',
	apiDescription:
		'Lis et modifie tes tables Torsel depuis n’importe quel script ou service, avec un jeton.',
	apiAuth: 'Envoie un jeton créé dans les Réglages, ou obtenu par OAuth, dans cet en-tête :',
	apiNames:
		'Bases, tables et champs se désignent par leur nom ou leur id. Un refus dit quoi corriger.',
	apiSpec: 'Document OpenAPI',
	apiOperations: 'Opérations',
	apiParameters: 'Paramètres',
	apiBody: 'Corps',
	apiAnswer: 'Réponse',
	apiRequired: 'requis',
	apiWrite: 'jeton en lecture et écriture'
};

export default { en, fr };

export const site = area({ en, fr });
