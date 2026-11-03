import type { Named } from '../core/slug.ts';
import { resolveSlug, slugsOf } from '../core/slug.ts';
import { createdAt, tableDef, viewDef } from '../core/workspace.ts';
import { app } from './app.svelte.ts';
import { viewToOpen } from './place.ts';

type Level = { items: Named[]; slugs: Map<string, string>; first: string | undefined };

// Slugs this session has handed out: a renamed table or view keeps answering to its old one.
const handed = new Map<string, string>();
const former = new Map<string, string>();

// `ever` holds deleted ones too: a twin keeps its suffix when the older one goes.
function level(scope: string, live: Named[], ever: Named[]): Level {
	const at = (item: Named): number => {
		const rec = app.ws.get(item.id);
		return rec === undefined ? 0 : createdAt(rec);
	};
	const slugs = slugsOf(ever.toSorted((a, b) => at(a) - at(b) || a.id.localeCompare(b.id)));

	for (const [id, slug] of slugs) {
		const old = handed.get(`${scope}/${id}`);
		if (old !== undefined && old !== slug) former.set(`${scope}/${old}`, id);
		handed.set(`${scope}/${id}`, slug);
	}

	return { items: live, slugs, first: live[0]?.id };
}

const tables = $derived.by(() => {
	void app.version;
	return level(
		'',
		app.ws.bases().flatMap((base) => app.ws.tables(base.id)),
		app.ws
			.everChildren('', 'base')
			.flatMap((base) => app.ws.everChildren(base.id, 'table').map(tableDef))
	);
});

const views = $derived.by(() => {
	void app.version;
	return new Map(
		tables.items.map((table) => [
			table.id,
			level(table.id, app.ws.views(table.id), app.ws.everChildren(table.id, 'view').map(viewDef))
		])
	);
});

function resolve(scope: string, segment: string, at: Level | undefined): string | undefined {
	if (at === undefined) return undefined;
	const id = resolveSlug(segment, at.items, at.slugs) ?? former.get(`${scope}/${segment}`);
	return at.items.some((item) => item.id === id) ? id : undefined;
}

export function tableSlug(tableId: string): string | undefined {
	return tables.slugs.get(tableId);
}

export function tableBySlug(segment: string): string | undefined {
	return resolve('', segment, tables);
}

export function viewSlug(tableId: string, viewId: string): string | undefined {
	return views.get(tableId)?.slugs.get(viewId);
}

export function viewBySlug(tableId: string, segment: string): string | undefined {
	return resolve(tableId, segment, views.get(tableId));
}

export function firstView(tableId: string): string | undefined {
	return views.get(tableId)?.first;
}

export function openingView(tableId: string): string | undefined {
	return viewToOpen(app.ws.views(tableId), tableId)?.id ?? firstView(tableId);
}
