import { goto } from '$app/navigation';

import { blankTable } from '../core/actions.ts';
import { exportOf } from '../core/backup.ts';
import { app } from './app.svelte.ts';
import { tableUrl } from './nav.ts';
import { applyWithUndo } from './toast.svelte.ts';

export type ImportStart = { file?: File; text?: string; into: string | null };

export const shell = $state({
	newRow: false,
	importing: null as ImportStart | null,
	namingTable: null as string | null,
	addingField: false
});

/** The text of a paste holding more than one cell, null for a plain word to type in. */
export function pastedCells(event: ClipboardEvent): string | null {
	const text = event.clipboardData?.getData('text/plain') ?? '';
	return /[\t\n]/u.test(text.trim()) ? text : null;
}

/** A named table goes straight to its fields; an unnamed one asks for its name first. */
export function startTable(baseId?: string, name?: string): void {
	const made = blankTable(app.ws, baseId, name);
	applyWithUndo(made.changes, `Table "${made.name}" created`);
	if (name?.trim()) {
		shell.addingField = true;
	} else {
		shell.namingTable = made.id;
	}
	void goto(tableUrl(made.id, made.viewIds[0]));
}

export function downloadBackup(): void {
	const url = URL.createObjectURL(new Blob([exportOf(app.ws)], { type: 'application/json' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = `torsel-${new Date().toISOString().slice(0, 10)}.json`;
	link.click();
	URL.revokeObjectURL(url);
}
