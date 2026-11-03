import { app } from './app.svelte.ts';

// An undo is a step of the history, or what takes back a change kept out of it.
export const toast = $state({ text: '', undo: null as number | (() => void) | null, seq: 0 });

let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, undo: number | (() => void) | null = null): void {
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
	if (typeof toast.undo === 'function') {
		const undo = toast.undo;
		toast.text = '';
		toast.undo = null;
		undo();
	} else if (toast.undo !== null) {
		const group = app.undo(toast.undo);
		showToast(group === undefined ? 'Nothing to undo' : `Undid: ${group.label}`);
	}
}
