import { area } from './runtime.ts';

const en = {
	add: 'Add',
	back: 'Back',
	cancel: 'Cancel',
	clear: 'Clear',
	close: 'Close',
	create: 'Create',
	delete: 'Delete',
	done: 'Done',
	duplicate: 'Duplicate',
	more: 'More',
	redo: 'Redo',
	remove: 'Remove',
	rename: 'Rename',
	retry: 'Retry',
	save: 'Save',
	search: 'Search',
	undo: 'Undo',
	keyShift: 'Shift',
	keyTab: 'Tab'
};

const fr: typeof en = {
	add: 'Ajouter',
	back: 'Retour',
	cancel: 'Annuler',
	clear: 'Effacer',
	close: 'Fermer',
	create: 'Créer',
	delete: 'Supprimer',
	done: 'OK',
	duplicate: 'Dupliquer',
	more: 'Plus',
	redo: 'Rétablir',
	remove: 'Retirer',
	rename: 'Renommer',
	retry: 'Réessayer',
	save: 'Enregistrer',
	search: 'Rechercher',
	undo: 'Annuler',
	keyShift: 'Maj',
	keyTab: 'Tab'
};

export default { en, fr };

export const common = area({ en, fr });
