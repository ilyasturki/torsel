import { SvelteSet } from 'svelte/reactivity';

import type { PresetId } from '../core/presets.ts';
import type { Column, Every, Missing } from '../core/source.ts';
import { ApiError } from './api.ts';
import type { LinkAuth, LinkPreview } from './sources.ts';
import { createLinked, previewLink, unlink } from './sources.ts';

/** A link's refresh as the import offers it: never means a one-time import, the table the person's own. */
export type Refresh = Every | 'never';

/** One import from a link: read it (asking for a key when it refuses), choose columns, make the table. */
export class LinkImport {
	link = $state('');
	preset = $state<PresetId | null>(null);
	auth = $state<LinkAuth>({ kind: 'bearer', name: null });
	secret = $state('');
	needsKey = $state(false);
	preview = $state.raw<LinkPreview | null>(null);
	columns = $state<Column[]>([]);
	// By path: the columns the person unticked.
	dropped = new SvelteSet<string>();
	name = $state('');
	refresh = $state<Refresh>('hour');
	missing = $state<Missing>('remove');
	busy = $state(false);
	problem = $state('');

	reset(): void {
		this.link = '';
		this.preset = null;
		this.auth = { kind: 'bearer', name: null };
		this.secret = '';
		this.needsKey = false;
		this.preview = null;
		this.columns = [];
		this.dropped.clear();
		this.name = '';
		this.refresh = 'hour';
		this.missing = 'remove';
		this.problem = '';
	}

	/** Another link: the key typed for the last one is never sent to it. */
	retyped(): void {
		this.needsKey = false;
		this.secret = '';
		this.problem = '';
	}

	private body() {
		const keyed = this.needsKey && this.secret.trim() !== '';
		const auth = keyed ? { auth: this.auth, secret: this.secret.trim() } : {};
		return this.preset === null
			? { url: this.link.trim(), ...auth }
			: { preset: this.preset, value: this.link.trim(), ...auth };
	}

	/** Reads the link; a refusal for want of a key opens the key field rather than failing. */
	async read(): Promise<boolean> {
		if (this.link.trim() === '' || this.busy) return false;
		this.busy = true;
		this.problem = '';
		try {
			const preview = await previewLink(this.body());
			this.preview = preview;
			this.columns = preview.columns;
			this.dropped.clear();
			this.name = preview.suggested.name;
			this.refresh = preview.suggested.every;
			this.missing = preview.suggested.missing;
			return true;
		} catch (error) {
			const code = problemOf(error);
			if (code === 'auth') {
				// A key typed and refused stays on screen to be corrected.
				this.needsKey = true;
				if (this.secret.trim() !== '') this.problem = messageOf(error);
			} else {
				this.problem = messageOf(error);
			}
			return false;
		} finally {
			this.busy = false;
		}
	}

	/** Makes the table on the server and pulls it; a one-time import then stops syncing at once. */
	async create(base: string | null): Promise<{ table: string; added: number } | null> {
		const preview = this.preview;
		const columns = this.columns.filter((column) => !this.dropped.has(column.path));
		if (preview === null || this.busy) return null;
		this.busy = true;
		this.problem = '';
		try {
			const keyed = this.needsKey && this.secret.trim() !== '';
			const made = await createLinked({
				base,
				name: this.name.trim() || preview.suggested.name,
				label: preview.suggested.label,
				url: preview.url,
				auth: keyed ? this.auth : { kind: 'none', name: null },
				secret: keyed ? this.secret.trim() : null,
				rows: preview.rows === '' ? null : preview.rows,
				key: preview.suggested.key,
				filter: preview.suggested.filter,
				every: this.refresh === 'never' ? 'manual' : this.refresh,
				missing: this.missing,
				columns
			});
			if (this.refresh === 'never') await unlink(made.table);
			return { table: made.table, added: made.outcome?.ok === true ? made.outcome.added : 0 };
		} catch (error) {
			this.problem = messageOf(error);
			return null;
		} finally {
			this.busy = false;
		}
	}
}

function problemOf(error: unknown): string | null {
	if (!(error instanceof ApiError)) return null;
	const payload = error.payload;
	return typeof payload === 'object' && payload !== null && 'problem' in payload
		? String(payload.problem)
		: null;
}

function messageOf(error: unknown): string {
	return error instanceof ApiError ? error.message : '';
}
