import { assistant, markFresh, undoChange } from '#lib/client/assistant.svelte.ts';
import { app } from '#lib/client/app.svelte.ts';
import type { ThreadAction } from '#lib/core/thread.ts';

import type { Example, Prompt } from './examples.ts';
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
