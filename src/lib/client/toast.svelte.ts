import { app } from './app.svelte.ts';

export const toast = $state({ text: '', undo: null as number | null, seq: 0 });

let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, undo: number | null = null): void {
	toast.text = text;
	toast.undo = undo;
	toast.seq += 1;
	clearTimeout(timer);
	timer = setTimeout(() => {
		toast.text = '';
		toast.undo = null;
	}, 6000);
}

export function undoToast(): void {
	if (toast.undo !== null) {
		const group = app.undo(toast.undo);
		showToast(group === undefined ? 'Rien à annuler' : `Annulé : ${group.label}`);
	}
}
