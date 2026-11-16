import { plural } from './locale.ts';
import { area } from './runtime.ts';

const en = {
	tooBig: 'images go up to 10 MB',
	notAnImage: 'this file isn’t a JPEG, PNG, WebP, GIF or AVIF image',
	tooManyPixels: 'this image has too many pixels',
	damaged: 'this image arrived damaged',
	storageFull: 'this account’s image storage is full',
	partOutOfOrder: 'this part doesn’t follow the last one',
	unreadable: 'Can’t read this image',
	notKept: (name: string, why: string) => `Couldn’t add ${name}. ${why}`,
	add: 'Add',
	addImage: 'Add an image',
	takePhoto: 'Take a photo',
	chooseImage: 'Choose an image',
	remove: (name: string) => `Remove ${name}`,
	added: (count: number) => plural('en', count, { one: 'Image added', other: '# images added' }),
	image: (at: number, of: number) => `Image ${at} of ${of}`,
	position: (at: number, of: number) => `${at} of ${of}`,
	previous: 'Previous image',
	next: 'Next image',
	close: 'Close',
	missing: 'Image not here yet',
	more: (count: number) => `+${count}`,
	cellFull: (max: number) => `A cell holds up to ${max} images`
};

const fr: typeof en = {
	tooBig: 'images limitées à 10 Mo',
	notAnImage: 'ce fichier n’est pas une image JPEG, PNG, WebP, GIF ou AVIF',
	tooManyPixels: 'cette image a trop de pixels',
	damaged: 'cette image est arrivée abîmée',
	storageFull: 'l’espace d’images de ce compte est plein',
	partOutOfOrder: 'cette partie ne suit pas la précédente',
	unreadable: 'Impossible de lire cette image',
	notKept: (name, why) => `Impossible d’ajouter ${name}. ${why}`,
	add: 'Ajouter',
	addImage: 'Ajouter une image',
	takePhoto: 'Prendre une photo',
	chooseImage: 'Choisir une image',
	remove: (name) => `Retirer ${name}`,
	added: (count) => plural('fr', count, { one: 'Image ajoutée', other: '# images ajoutées' }),
	image: (at, of) => `Image ${at} sur ${of}`,
	position: (at, of) => `${at} sur ${of}`,
	previous: 'Image précédente',
	next: 'Image suivante',
	close: 'Fermer',
	missing: 'Image pas encore arrivée',
	more: (count) => `+${count}`,
	cellFull: (max) => `Une cellule contient ${max} images au plus`
};

export default { en, fr };

export const images = area({ en, fr });
