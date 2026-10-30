import { goto } from '$app/navigation';

import type { Change } from '../core/model.ts';
import { ApiError, request } from './api.ts';
import { app } from './app.svelte.ts';
import { HOME, tableUrl } from './nav.ts';
import { syncNow } from './sync.svelte.ts';
import { showToast } from './toast.svelte.ts';

type Tier = 'apply' | 'propose' | 'confirm';

type Action = { tier: Tier; summary: string; changes: Change[] };

export type AssistantContext = { base: string | null; table: string | null; view: string | null };

export type Pending = { prompt: string; tier: Tier; reply: string; actions: Action[] };

export const assistant = $state({
	busy: false,
	reply: '',
	error: '',
	pending: null as Pending | null
});

const RANK: Record<Tier, number> = { apply: 0, propose: 1, confirm: 2 };

function destination(changes: Change[], existed: Set<string>): string | null {
	const fresh = changes.filter((change) => !existed.has(change.id));
	const view = fresh.find((change) => change.kind === 'view');
	if (view !== undefined) {
		return tableUrl(view.parent, view.id);
	}
	const table = fresh.find((change) => change.kind === 'table');
	if (table !== undefined) {
		return tableUrl(table.id);
	}
	return fresh.some((change) => change.kind === 'base') ? HOME : null;
}

export function applyPending(): void {
	const pending = assistant.pending;
	if (pending === null) {
		return;
	}
	assistant.pending = null;

	const changes = pending.actions.flatMap((action) => action.changes);
	const existed = new Set(
		changes.map((change) => change.id).filter((id) => app.ws.get(id) !== undefined)
	);
	const group = app.apply(changes, `Assistant: ${pending.prompt}`, 'ai');

	showToast(
		pending.reply || pending.actions.map((action) => action.summary).join(' · '),
		group?.id ?? null
	);
	assistant.reply = '';

	const to = destination(changes, existed);
	if (to !== null) {
		void goto(to);
	}
}

export function dismissPending(): void {
	assistant.pending = null;
}

export async function ask(prompt: string, context: AssistantContext): Promise<void> {
	assistant.busy = true;
	assistant.error = '';
	assistant.reply = '';

	try {
		await syncNow();
		const result = await request<{ reply: string; actions: Action[] }>('/api/ai', {
			method: 'POST',
			body: { prompt, ...context }
		});

		if (result.actions.length === 0) {
			assistant.reply = result.reply;
			return;
		}

		const tier = result.actions.reduce<Tier>(
			(top, action) => (RANK[action.tier] > RANK[top] ? action.tier : top),
			'apply'
		);
		assistant.pending = { prompt, tier, reply: result.reply, actions: result.actions };

		if (tier === 'apply') {
			applyPending();
		}
	} catch (error) {
		assistant.error =
			error instanceof ApiError
				? error.status <= 0
					? 'The assistant needs a connection to the server.'
					: error.message
				: 'Something went wrong. Try again.';
	} finally {
		assistant.busy = false;
	}
}
