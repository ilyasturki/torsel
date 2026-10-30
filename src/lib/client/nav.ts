export const HOME = '/app';
export const SETTINGS = '/app/settings';
export const LOGIN = '/app/login';

export function tableUrl(tableId: string, viewId?: string): string {
	return viewId === undefined ? `/app/t/${tableId}` : `/app/t/${tableId}?v=${viewId}`;
}
