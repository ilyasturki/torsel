import { json } from '@sveltejs/kit';
import { and, count, desc, eq, gt, lte } from 'drizzle-orm';

import type { AiLimits } from '../config.ts';
import type { Database } from '../db/client.ts';
import { WRITER } from '../db/client.ts';
import type { User } from '../db/schema.ts';
import { aiPrompts } from '../db/schema.ts';
import type { Executor } from '../db/seq.ts';

export const WINDOW_MS = 24 * 60 * 60 * 1000;

/** `until` is when the window next frees a prompt, in epoch milliseconds. */
export type PromptRefusal = { scope: 'account' | 'instance'; until: number };

type Asker = Pick<User, 'id' | 'email'>;

const exempt = (user: Asker, limits: AiLimits): boolean =>
	limits.unlimited.has(user.email.toLowerCase());

function untilFree(tx: Executor, cap: number, since: Date, userId?: string): number | null {
	if (cap === 0) {
		return null;
	}
	const inWindow = gt(aiPrompts.at, since);
	const scope = userId === undefined ? inWindow : and(eq(aiPrompts.userId, userId), inWindow);
	const taken = tx.select({ n: count() }).from(aiPrompts).where(scope).get()?.n ?? 0;
	if (taken < cap) {
		return null;
	}
	// Once this one leaves the window, fewer than `cap` remain.
	const freeing = tx
		.select({ at: aiPrompts.at })
		.from(aiPrompts)
		.where(scope)
		.orderBy(desc(aiPrompts.at))
		.limit(1)
		.offset(cap - 1)
		.get();
	return (freeing?.at.getTime() ?? since.getTime()) + WINDOW_MS;
}

function refusalIn(tx: Executor, user: Asker, limits: AiLimits, now: Date): PromptRefusal | null {
	const since = new Date(now.getTime() - WINDOW_MS);
	const account = untilFree(tx, limits.account, since, user.id);
	if (account !== null) {
		return { scope: 'account', until: account };
	}
	const instance = untilFree(tx, limits.instance, since);
	return instance === null ? null : { scope: 'instance', until: instance };
}

/** Whether the next prompt would be refused, without taking it. */
export function promptRefusal(
	db: Database,
	user: Asker,
	limits: AiLimits,
	now: Date = new Date()
): PromptRefusal | null {
	return exempt(user, limits) ? null : refusalIn(db, user, limits, now);
}

/** Counts the prompt against both caps, unless one of them refuses it. */
export function takePrompt(
	db: Database,
	user: Asker,
	limits: AiLimits,
	now: Date = new Date()
): PromptRefusal | null {
	if (exempt(user, limits)) {
		return null;
	}
	return db.transaction((tx) => {
		tx.delete(aiPrompts)
			.where(lte(aiPrompts.at, new Date(now.getTime() - WINDOW_MS)))
			.run();
		const refusal = refusalIn(tx, user, limits, now);
		if (refusal === null) {
			tx.insert(aiPrompts).values({ userId: user.id, at: now }).run();
		}
		return refusal;
	}, WRITER);
}

/** The app words it from `scope` and `until`, in local time; `message` is for any other caller. */
export function refusedResponse(refusal: PromptRefusal): Response {
	return json(
		{ message: 'today’s assistant limit is reached', ...refusal },
		{
			status: 429,
			headers: { 'retry-after': String(Math.ceil((refusal.until - Date.now()) / 1000)) }
		}
	);
}
