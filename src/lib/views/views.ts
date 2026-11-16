import { goto } from '$app/navigation';

import { app } from '#lib/client/app.svelte.ts';
import { tableUrl } from '#lib/client/nav.ts';
import { applyWithUndo } from '#lib/client/toast.svelte.ts';
import { createView, reorder, shifted } from '#lib/core/actions.ts';
import type { ViewType } from '#lib/core/model.ts';
import { names } from '#lib/i18n/names.ts';
import { views as words } from '#lib/i18n/views.ts';
import type { IconName } from '#lib/ui/Icon.svelte';

import { pin } from './pin.svelte.ts';

export const VIEW_TYPES: { id: ViewType; icon: IconName }[] = [
	{ id: 'grid', icon: 'view-grid' },
	{ id: 'entry', icon: 'view-entry' },
	{ id: 'list', icon: 'view-list' },
	{ id: 'chart', icon: 'view-chart' }
];

/** A view type's name, which is also what a new view of it is called. */
export const viewLabel = (type: ViewType): string => names.views[type];

export function unusedName(tableId: string, label: string): string {
	const taken = new Set(app.ws.views(tableId).map((view) => view.name));
	let unused = label;
	for (let n = 2; taken.has(unused); n += 1) unused = `${label} ${n}`;
	return unused;
}

export function addView(tableId: string, type: ViewType): void {
	const name = unusedName(tableId, viewLabel(type));
	const cover = app.ws.fields(tableId).find((field) => field.type === 'image');
	const config = type === 'list' && cover !== undefined ? { cover: cover.id } : {};
	const { id, changes } = createView(app.ws, tableId, { name, type, config });
	applyWithUndo(changes, words.viewAdded(name));
	void goto(tableUrl(tableId, id));
}

/** Moves a view in the tab order; the one on screen stays there, its address naming it once it is no longer first. */
export async function moveView(
	tableId: string,
	viewId: string,
	to: number,
	shown: string | undefined
): Promise<void> {
	const views = app.ws.views(tableId);
	const from = views.findIndex((view) => view.id === viewId);
	if (from === -1 || to === from || to < 0 || to >= views.length) return;
	const ids = shifted(
		views.map((view) => view.id),
		viewId,
		to - from
	);
	pin.table = tableId;
	pin.view = shown ?? null;
	applyWithUndo(reorder(app.ws, ids), words.viewMoved(views[from].name));
	if (shown !== undefined) {
		await goto(tableUrl(tableId, shown), { replaceState: true, reset: false });
	}
	pin.table = null;
	pin.view = null;
}
