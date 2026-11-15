const en = {
	home: 'Torsel home',
	github: 'GitHub',
	signIn: 'Sign in',
	start: 'Start now',
	open: 'Open Torsel',
	siteNav: 'Site',
	footerNav: 'Footer',
	licensed: 'MIT licensed.',
	privacy: 'Privacy',
	terms: 'Terms',
	otherLanguage: 'Français',
	description:
		'A spreadsheet you just ask. Say what you need and Torsel writes the formula, adds the rows and draws the chart. It works offline and its code is open.',
	headline: 'A spreadsheet you just ask.',
	lead: 'Say what you need. Torsel writes the formula, adds the rows, draws the chart.',
	cardLead: 'It writes the formula, adds the rows, draws the chart.',
	formTitle: 'A form on your phone, for every table.',
	formLead: 'Log a row in two taps, even with no network. It lands in the table above.',
	closeTitle: 'Free and open source.',
	closeLead:
		'No account needed to start, and your tables stay in your browser until you sync them.',
	code: 'The code is on GitHub.',
	demo: 'The app on sample tables',
	examples: 'Examples',
	views: 'Views',
	prompts: 'Prompts',
	startOver: 'Start over',
	ask: 'Ask',
	askPlaceholder: 'Ask about your tables',
	send: 'Send',
	working: 'Working…',
	rows: (count: number) => (count === 1 ? '1 row' : `${count} rows`),
	logoAlt: 'The Torsel logo',
	privacyDescription:
		'What stays on your device when you use Torsel, what leaves it, and who receives it.',
	termsDescription: 'The terms for using Torsel at torsel.ilyasturki.com, and who runs it.',
	updated: 'Last updated'
};

const fr: typeof en = {
	home: 'Accueil de Torsel',
	github: 'GitHub',
	signIn: 'Se connecter',
	start: 'Commencer',
	open: 'Ouvrir Torsel',
	siteNav: 'Site',
	footerNav: 'Pied de page',
	licensed: 'Sous licence MIT.',
	privacy: 'Confidentialité',
	terms: 'Conditions',
	otherLanguage: 'English',
	description:
		'Le tableur qui fait ce que tu demandes. Dis ce qu’il te faut et Torsel écrit la formule, ajoute les lignes et trace le graphique. Il marche hors ligne et son code est ouvert.',
	headline: 'Le tableur qui fait ce que tu demandes.',
	lead: 'Dis ce qu’il te faut. Torsel écrit la formule, ajoute les lignes, trace le graphique.',
	cardLead: 'Il écrit la formule, ajoute les lignes, trace le graphique.',
	formTitle: 'Un formulaire sur ton téléphone, pour chaque table.',
	formLead:
		'Ajoute une ligne en deux gestes, même sans réseau. Elle arrive dans la table au-dessus.',
	closeTitle: 'Gratuit et open source.',
	closeLead:
		'Pas besoin de compte pour commencer, et tes tables restent dans ton navigateur tant que tu ne les synchronises pas.',
	code: 'Le code est sur GitHub.',
	demo: 'L’app sur des tables d’exemple',
	examples: 'Exemples',
	views: 'Vues',
	prompts: 'Demandes',
	startOver: 'Recommencer',
	ask: 'Demander',
	askPlaceholder: 'Pose une question sur tes tables',
	send: 'Envoyer',
	working: 'En cours…',
	rows: (count: number) => (count <= 1 ? `${count} ligne` : `${count} lignes`),
	logoAlt: 'Le logo de Torsel',
	privacyDescription:
		'Ce qui reste sur ton appareil quand tu utilises Torsel, ce qui en sort, et qui le reçoit.',
	termsDescription:
		'Les conditions d’utilisation de Torsel sur torsel.ilyasturki.com, et qui l’édite.',
	updated: 'Mis à jour le'
};

export const siteCopy = { en, fr };
