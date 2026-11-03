import { firstView, openingView, tableSlug, viewSlug } from './directory.svelte.ts';

export { HOME, LOGIN, SETTINGS } from './paths.ts';

/** With no view, the one this person would come back to; the table's first view sits at the bare URL. */
export function tableUrl(tableId: string, viewId?: string): string {
	const view = viewId ?? openingView(tableId);
	const table = `/app/t/${encodeURIComponent(tableSlug(tableId) ?? tableId)}`;
	return view === undefined || view === firstView(tableId)
		? table
		: `${table}/${encodeURIComponent(viewSlug(tableId, view) ?? view)}`;
}
