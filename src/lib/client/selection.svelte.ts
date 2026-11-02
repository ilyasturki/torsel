export const selection = $state({
	table: null as string | null,
	rows: [] as string[],
	fields: [] as string[]
});

export function clearSelection(): void {
	selection.table = null;
	selection.rows = [];
	selection.fields = [];
}
