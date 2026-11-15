import { area } from './runtime.ts';

const en = {
	searchIn: (label: string) => `Search ${label}`,
	newChoice: 'New choice',
	new: 'New',
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
	tally: (done: number, total: number) => `${done} of ${total}`
};

const fr: typeof en = {
	searchIn: (label) => `Rechercher dans ${label}`,
	newChoice: 'Nouveau choix',
	new: 'Nouveau',
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
	minus: (label) => `${label} moins`,
	plus: (label) => `${label} plus`,
	tally: (done, total) => `${done} sur ${total}`
};

export default { en, fr };

export const ui = area({ en, fr });
