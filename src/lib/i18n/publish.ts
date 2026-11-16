import { area } from './runtime.ts';

const en = {
	publish: 'Publish to web',
	publishNow: 'Publish',
	who: 'Anyone with the link sees this view, read only.',
	link: 'Link',
	copyLink: 'Copy link',
	linkCopied: 'Link copied',
	unpublish: 'Unpublish',
	unpublished: (view: string) => `${view} unpublished`,
	notSynced: 'This view isn’t synced yet',
	failed: 'Couldn’t reach the server',
	madeWith: 'Made with Torsel',
	gone: 'This link no longer works',
	goneWhy: 'Its owner stopped sharing it.',
	toTorsel: 'Go to Torsel',
	loadFailed: 'Couldn’t load this view',
	noSuchLink: 'no such link',
	noSuchView: 'no such view'
};

const fr: typeof en = {
	publish: 'Publier sur le web',
	publishNow: 'Publier',
	who: 'Toute personne qui a le lien voit cette vue, sans pouvoir la modifier.',
	link: 'Lien',
	copyLink: 'Copier le lien',
	linkCopied: 'Lien copié',
	unpublish: 'Retirer du web',
	unpublished: (view) => `Vue « ${view} » retirée du web`,
	notSynced: 'Cette vue n’est pas encore synchronisée',
	failed: 'Serveur injoignable',
	madeWith: 'Fait avec Torsel',
	gone: 'Ce lien ne fonctionne plus',
	goneWhy: 'Son propriétaire a arrêté de le partager.',
	toTorsel: 'Aller sur Torsel',
	loadFailed: 'Impossible de charger cette vue',
	noSuchLink: 'lien introuvable',
	noSuchView: 'vue introuvable'
};

export default { en, fr };

export const publish = area({ en, fr });
