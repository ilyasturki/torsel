import { SOURCE } from './access.ts';
import type { Rec, Value } from './model.ts';

export const EVERY = ['manual', 'hour', 'day'] as const;

export type Every = (typeof EVERY)[number];

export const MISSING = ['remove', 'keep'] as const;

export type Missing = (typeof MISSING)[number];

/** What a source table shows on every device, offline too: who fills it, what went wrong, when it last read. */
export type SourceMark = { name: string; problem: string | null; at: number | null };

export function sourceMark(table: Rec | undefined): SourceMark | null {
	const value = table?.kind === 'table' ? table.data[SOURCE] : undefined;
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const { name, problem, at } = value as Record<string, Value>;
	return {
		name: typeof name === 'string' ? name : '',
		problem: typeof problem === 'string' ? problem : null,
		at: typeof at === 'number' ? at : null
	};
}

export function markValue(mark: SourceMark): Value {
	return { name: mark.name, problem: mark.problem, at: mark.at };
}

/** The name a source goes by: its preset, else the host it reads. */
export function sourceName(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./u, '');
	} catch {
		return url;
	}
}
