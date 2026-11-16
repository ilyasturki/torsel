import { json } from '@sveltejs/kit';
import { and, asc, eq, gt, lte } from 'drizzle-orm';

import { assistant as words } from '../../i18n/assistant.ts';
import type { AiLimits } from '../config.ts';
import type { Database } from '../db/client.ts';
import { WRITER } from '../db/client.ts';
import type { User } from '../db/schema.ts';
import { aiUsage } from '../db/schema.ts';
import type { Executor } from '../db/seq.ts';
import type { Usage } from './pricing.ts';
import { costOf } from './pricing.ts';

export const WINDOW_MS = 24 * 60 * 60 * 1000;

/** `until` is when the window has spent less than the budget again, in epoch milliseconds. */
export type PromptRefusal = { scope: 'account' | 'instance'; until: number };

type Asker = Pick<User, 'id' | 'email'>;

const exempt = (user: Asker, limits: AiLimits): boolean =>
	limits.unlimited.has(user.email.toLowerCase());

/** A budget in dollars, as millionths. */
const micros = (dollars: number): number => Math.round(dollars * 1_000_000);

function untilUnder(tx: Executor, budget: number, since: Date, userId?: string): number | null {
	if (budget === 0) {
		return null;
	}
	const inWindow = gt(aiUsage.at, since);
	const scope = userId === undefined ? inWindow : and(eq(aiUsage.userId, userId), inWindow);
	const spent = tx
		.select({ at: aiUsage.at, cost: aiUsage.cost })
		.from(aiUsage)
		.where(scope)
		.orderBy(asc(aiUsage.at))
		.all();
	const cap = micros(budget);
	let total = spent.reduce((sum, entry) => sum + entry.cost, 0);
	if (total < cap) {
		return null;
	}
	// Under the budget again once enough of the oldest spending has left the window.
	for (const entry of spent) {
		total -= entry.cost;
		if (total < cap) {
			return entry.at.getTime() + WINDOW_MS;
		}
	}
	return since.getTime() + WINDOW_MS;
}

/** Whether a call may start: refused once the window's spending reaches the budget. */
export function usageRefusal(
	db: Database,
	user: Asker,
	limits: AiLimits,
	now: Date = new Date()
): PromptRefusal | null {
	if (exempt(user, limits)) {
		return null;
	}
	const since = new Date(now.getTime() - WINDOW_MS);
	const account = untilUnder(db, limits.account, since, user.id);
	if (account !== null) {
		return { scope: 'account', until: account };
	}
	const instance = untilUnder(db, limits.instance, since);
	return instance === null ? null : { scope: 'instance', until: instance };
}

/** What one model response cost, charged to the person it ran for. */
export function recordUsage(
	db: Database,
	user: Asker,
	limits: AiLimits,
	model: string,
	usage: Usage,
	now: Date = new Date()
): void {
	if (exempt(user, limits)) {
		return;
	}
	const cost = costOf(model, usage);
	if (cost === 0) {
		return;
	}
	db.transaction((tx) => {
		tx.delete(aiUsage)
			.where(lte(aiUsage.at, new Date(now.getTime() - WINDOW_MS)))
			.run();
		tx.insert(aiUsage).values({ userId: user.id, at: now, cost }).run();
	}, WRITER);
}

/** Charges each response of one piece of work to the person it ran for. */
export type Meter = (message: { model: string; usage: Usage }) => void;

export function meterFor(db: Database, user: Asker, limits: AiLimits): Meter {
	return (message) => recordUsage(db, user, limits, message.model, message.usage);
}

/** The app words it from `scope` and `until`, in local time; `message` is for any other caller. */
export function refusedResponse(refusal: PromptRefusal): Response {
	return json(
		{ message: words.limitReached, ...refusal },
		{
			status: 429,
			headers: { 'retry-after': String(Math.ceil((refusal.until - Date.now()) / 1000)) }
		}
	);
}
