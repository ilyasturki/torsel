import { assistant, markFresh, undoChange } from '#lib/client/assistant.svelte.ts';
import { app } from '#lib/client/app.svelte.ts';
import type { SqlRow } from '#lib/core/sql.ts';
import type { ThreadAction } from '#lib/core/thread.ts';

import type { Cell, Example, Prompt } from './examples.ts';
import type { Sample } from './seed.ts';
import { changesFor } from './seed.ts';

export { default as ChangeCard } from '#lib/views/ChangeCard.svelte';
export { seedExamples } from './seed.ts';

const THREAD = 'landing';

let made = 0;

/** Applies a prompt the way the app applies one of the assistant's changes, so its card and undo are the real ones. */
export function applyPrompt(
	example: Example,
	sample: Sample,
	prompt: Prompt,
	turn: number
): { action: ThreadAction; view?: string } {
	const { summary, changes, view } = changesFor(app.ws, example, sample, prompt);
	const id = `${THREAD}-${(made += 1)}`;
	const group = app.apply(changes, summary, 'ai', { thread: THREAD, id });
	assistant.actions.push({
		id,
		turn,
		summary,
		changes,
		before: group?.inverse ?? [],
		status: 'applied'
	});
	const action = assistant.actions[assistant.actions.length - 1];
	markFresh(action);
	return { action, view };
}

export function undoAll(actions: ThreadAction[]): void {
	for (const action of actions.toReversed()) undoChange(action);
}

/** The formula columns' values from the examples' own arithmetic, so the table reads whole before SQLite loads. */
export function showEarly(example: Example, sample: Sample): void {
	const fields = app.ws.fields(sample.table);
	const rows = new Map<string, SqlRow>();
	for (const row of app.ws.rows(sample.table)) {
		const cells = sample.fields.map((id) => row.data[id] as Cell);
		const values: SqlRow = { id: row.id };
		for (const prompt of example.prompts) {
			if (prompt.kind !== 'formula') continue;
			const field = fields.find((candidate) => candidate.name === prompt.name);
			if (field !== undefined) values[field.id] = prompt.value(cells);
		}
		rows.set(row.id, values);
	}
	app.computedEarly(sample.table, rows);
}
