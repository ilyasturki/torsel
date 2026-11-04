import type { ViewDef } from '#lib/core/model.ts';

/** The view a bare table address keeps showing while a reorder moves another one first. */
export const pin = $state<{ table: string | null; view: string | null }>({
	table: null,
	view: null
});

export function shownView(
	tableId: string,
	views: ViewDef[],
	requested: string | undefined
): ViewDef | undefined {
	const pinned = pin.table === tableId ? pin.view : null;
	return (
		views.find((item) => item.id === requested) ??
		(requested === undefined ? views.find((item) => item.id === pinned) : undefined) ??
		views[0]
	);
}
