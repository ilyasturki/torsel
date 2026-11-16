import type { Window } from '../auth/rate-limit.ts';
import { slidingWindow } from '../auth/rate-limit.ts';

const MINUTE_MS = 60_000;

// Each fetch a person starts costs the server and reaches someone else's: a few a minute, by hand or through a tool.
const windows = {
	preview: slidingWindow(30, MINUTE_MS),
	create: slidingWindow(10, MINUTE_MS),
	refresh: slidingWindow(20, MINUTE_MS)
} satisfies Record<string, Window>;

export type Limited = keyof typeof windows;

export function overLimit(kind: Limited, userId: string): boolean {
	return windows[kind].hit(userId);
}
