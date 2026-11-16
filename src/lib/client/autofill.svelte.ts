import { SvelteSet } from 'svelte/reactivity';

import {
	FILL_BATCH,
	canFill,
	fillChanges,
	fillInputs,
	promptToDisplay,
	typeText,
	waitingRows
} from '../core/autofill.ts';
import type { Change, FieldDef, FillSpec, Rec } from '../core/model.ts';
import { createdAt } from '../core/workspace.ts';
import { assistant as words } from '../i18n/assistant.ts';
import { ApiError, request } from './api.ts';
import { app } from './app.svelte.ts';
import { assistant } from './assistant.svelte.ts';
import { limitMessage, limitOf } from './limit.ts';
import { me } from './session.svelte.ts';
import { applyWithUndo, showToast } from './toast.svelte.ts';

type Filled = { row: string; value: string | null };

export const filling = new SvelteSet<string>();

async function ask(field: FieldDef, spec: FillSpec, rows: Rec[]): Promise<Filled[]> {
	const fields = app.ws.fields(field.table);
	const values: Filled[] = [];
	for (let from = 0; from < rows.length; from += FILL_BATCH) {
		const batch = rows.slice(from, from + FILL_BATCH);
		const answer = await request<{ values: Filled[]; failed?: boolean }>('/api/ai/fill', {
			method: 'POST',
			body: {
				field: field.name,
				type: typeText(field),
				prompt: promptToDisplay(spec.prompt, fields),
				web: spec.web,
				rows: batch.map((row) => ({ row: row.id, inputs: fillInputs(app.ws, field, spec, row) }))
			}
		});
		values.push(...answer.values);
	}
	return values;
}

function writable(field: FieldDef, values: Filled[]): Change[] {
	return fillChanges(app.ws, field, values).filter((change) => app.canWrite(change, [field.id]));
}

export async function fillColumn(fieldId: string): Promise<void> {
	const field = app.ws.field(fieldId);
	const spec = field?.fill ?? null;
	if (field === undefined || spec === null || !canFill(field.type) || filling.has(field.id)) return;
	const rows = waitingRows(app.ws, field, spec, app.ws.rows(field.table));
	if (rows.length === 0) {
		showToast(words.fillNothing);
		return;
	}
	filling.add(field.id);
	showToast(words.filling(rows.length));
	try {
		const changes = writable(field, await ask(field, spec, rows));
		if (changes.length === 0) showToast(words.fillFailed);
		else applyWithUndo(changes, words.filled(changes.length));
	} catch (error) {
		const limit = error instanceof ApiError && error.status === 429 ? limitOf(error.payload) : null;
		showToast(limit === null ? words.fillFailed : limitMessage(limit));
	} finally {
		filling.delete(field.id);
	}
}

// A row still being typed is left alone until nothing has changed for this long.
const QUIET_MS = 4000;

// Rows this device already asked about, so a row the model can't fill is asked once a session.
const asked = new Set<string>();

async function fillNewRows(): Promise<void> {
	if (!me.account || assistant.available !== true || !navigator.onLine) return;
	for (const table of app.ws.bases().flatMap((base) => app.ws.tables(base.id))) {
		for (const field of app.ws.fields(table.id)) {
			const spec = field.fill;
			if (spec === null || !spec.auto || !canFill(field.type) || filling.has(field.id)) continue;
			const rows = waitingRows(
				app.ws,
				field,
				spec,
				app.ws.rows(table.id).filter((row) => createdAt(row) >= spec.since)
			)
				.filter((row) => !asked.has(`${field.id}:${row.id}`))
				.slice(0, FILL_BATCH);
			if (rows.length === 0) continue;
			for (const row of rows) asked.add(`${field.id}:${row.id}`);
			filling.add(field.id);
			try {
				const changes = writable(field, await ask(field, spec, rows));
				// Background work stays quiet: the change is undoable with Ctrl+Z, and no toast says it.
				if (changes.length > 0) app.apply(changes, words.filled(changes.length));
			} catch {
			} finally {
				filling.delete(field.id);
			}
		}
	}
}

export function watchNewRows(): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return $effect.root(() => {
		$effect(() => {
			void app.version;
			clearTimeout(timer);
			timer = setTimeout(() => void fillNewRows(), QUIET_MS);
		});
		return () => clearTimeout(timer);
	});
}
