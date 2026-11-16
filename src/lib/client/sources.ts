import { SvelteSet } from 'svelte/reactivity';

import type { Column, Every, Missing, RunOutcome, SourceState } from '../core/source.ts';
import type { PresetId } from '../core/presets.ts';
import { request } from './api.ts';
import { syncNow } from './sync.svelte.ts';

export type LinkAuth = { kind: SourceState['auth']; name: string | null };

export type LinkPreview = {
	format: string;
	url: string;
	columns: Column[];
	items: Record<string, string>[];
	count: number;
	more: boolean;
	rowPaths: string[];
	rows: string;
	key: string | null;
	suggested: {
		label: string;
		name: string;
		key: string | null;
		filter: string | null;
		every: Every;
		missing: Missing;
		auth: LinkAuth;
	};
};

export type PreviewRequest =
	| { url: string; auth?: LinkAuth; secret?: string | null; rows?: string | null }
	| { preset: PresetId; value: string; auth?: LinkAuth; secret?: string | null };

export type CreateRequest = {
	base: string | null;
	name: string;
	label: string;
	url: string;
	auth: LinkAuth;
	secret: string | null;
	rows: string | null;
	key: string | null;
	filter: string | null;
	every: Every;
	missing: Missing;
	columns: Column[];
};

type Ran = { outcome: RunOutcome | null; source: SourceState | null };

const path = (table: string): string => `/api/sources/${encodeURIComponent(table)}`;

export function previewLink(body: PreviewRequest): Promise<LinkPreview> {
	return request('/api/sources/preview', { method: 'POST', body });
}

/** Creates the table on the server, then pulls it so it opens with its rows. */
export async function createLinked(body: CreateRequest): Promise<Ran & { table: string }> {
	const made = await request<Ran & { table: string }>('/api/sources', { method: 'POST', body });
	await syncNow();
	return made;
}

export function readLinked(table: string): Promise<SourceState> {
	return request(path(table));
}

/** Tables whose refresh this device started and hasn't heard back from. */
export const refreshing = new SvelteSet<string>();

export async function refreshLinked(table: string): Promise<Ran> {
	refreshing.add(table);
	try {
		const ran = await request<Ran>(`${path(table)}/refresh`, { method: 'POST' });
		await syncNow();
		return ran;
	} finally {
		refreshing.delete(table);
	}
}

/** A new key runs the source at once. */
export async function changeLinked(
	table: string,
	patch: { every?: Every; missing?: Missing; secret?: string; url?: string }
): Promise<Ran> {
	const runs = patch.secret !== undefined || patch.url !== undefined;
	if (runs) refreshing.add(table);
	try {
		const ran = await request<Ran>(path(table), { method: 'PATCH', body: patch });
		if (runs) await syncNow();
		return ran;
	} finally {
		if (runs) refreshing.delete(table);
	}
}

/** Stops syncing: the rows stay, every field editable again. */
export async function unlink(table: string): Promise<void> {
	await request(path(table), { method: 'DELETE' });
	await syncNow();
}
