import { area } from './runtime.ts';

const en = {
	searchIn: (label: string) => `Search ${label}`,
	newChoice: 'New choice',
	new: 'New',
	signInCode: 'Sign-in code',
	digit: (index: number, length: number) => `Digit ${index} of ${length}`,
	showPassword: 'Show password',
	hidePassword: 'Hide password',
	discardChanges: 'Discard changes',
	discardYours: 'Discard your changes?',
	keepEditing: 'Keep editing',
	discard: 'Discard',
	noMatch: 'No match',
	noRating: 'None',
	rating: (value: number, max: number) => `${value} out of ${max}`,
	minus: (label: string) => `${label} minus`,
	plus: (label: string) => `${label} plus`,
	tally: (done: number, total: number) => `${done} of ${total}`,
	yesterday: 'Yesterday',
	today: 'Today',
	tomorrow: 'Tomorrow',
	previousMonth: 'Previous month',
	nextMonth: 'Next month'
};

const fr: typeof en = {
	searchIn: (label) => `Rechercher dans ${label}`,
	newChoice: 'Nouveau choix',
	new: 'Nouveau',
	signInCode: 'Code de connexion',
	digit: (index, length) => `Chiffre ${index} sur ${length}`,
	showPassword: 'Afficher le mot de passe',
	hidePassword: 'Masquer le mot de passe',
	discardChanges: 'Abandonner les modifications',
	discardYours: 'Abandonner tes modifications ?',
	keepEditing: 'Continuer',
	discard: 'Abandonner',
	noMatch: 'Aucun résultat',
	noRating: 'Aucune',
	rating: (value, max) => `${value} sur ${max}`,
	minus: (label) => `Diminuer ${label}`,
	plus: (label) => `Augmenter ${label}`,
	tally: (done, total) => `${done} sur ${total}`,
	yesterday: 'Hier',
	today: 'Aujourd’hui',
	tomorrow: 'Demain',
	previousMonth: 'Mois précédent',
	nextMonth: 'Mois suivant'
};

export default { en, fr };

export const ui = area({ en, fr });
