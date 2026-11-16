import type { Change } from '../core/model.ts';
import type { Group } from './app.svelte.ts';
import { shell as words } from '../i18n/shell.ts';
import { app } from './app.svelte.ts';

// An undo is a step of the history, or what takes back a change kept out of it.
type ToastAction =
	{ kind: 'undo'; group: number } | { kind: 'undo'; run: () => void } | { kind: 'redo' };

export const toast = $state({ text: '', action: null as ToastAction | null, seq: 0 });

let timer: ReturnType<typeof setTimeout> | undefined;
let shownAt = 0;

function show(text: string, action: ToastAction | null): void {
	shownAt = Date.now();
	toast.text = text;
	toast.action = action;
	toast.seq += 1;
	clearTimeout(timer);
	timer = setTimeout(() => {
		toast.text = '';
		toast.action = null;
	}, 6000);
}

export function showToast(text: string, undo: number | (() => void) | null = null): void {
	show(
		text,
		undo === null
			? null
			: typeof undo === 'function'
				? { kind: 'undo', run: undo }
				: { kind: 'undo', group: undo }
	);
}

/** A person's change, with its Undo in the toast; typing in a grid cell applies quietly instead. */
export function applyWithUndo(changes: Change[], label: string): Group | null {
	const group = app.apply(changes, label);
	if (group !== null) showToast(label, group.id);
	return group;
}

/** The last change, or the one `id` names. */
export function undoChange(id?: number): void {
	const group = app.undo(id);
	if (group === undefined) show(words.nothingToUndo, null);
	else if (group === null) show(words.syncedRefused, null);
	else show(words.undid(group.label), { kind: 'redo' });
}

export function redoChange(): void {
	const group = app.redo();
	if (group === undefined) show(words.nothingToRedo, null);
	else if (group === null) show(words.syncedRefused, null);
	else show(words.redid(group.label), { kind: 'undo', group: group.id });
}

/** A toast from before a sheet opened would cover its footer; one the sheet's own change raised stays. */
export function dismissEarlierToast(): void {
	if (Date.now() - shownAt > 1000) {
		clearTimeout(timer);
		toast.text = '';
		toast.action = null;
	}
}

export function runToastAction(): void {
	const action = toast.action;
	if (action === null) return;
	if ('run' in action) {
		toast.text = '';
		toast.action = null;
		action.run();
	} else if (action.kind === 'undo') undoChange(action.group);
	else redoChange();
}
