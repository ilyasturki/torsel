import type Anthropic from '@anthropic-ai/sdk';

import type { Suggestion, ThreadContext } from '../../core/thread.ts';
import { fitSuggestions } from '../../core/thread.ts';
import { todayIso } from '../../core/values.ts';
import type { Workspace } from '../../core/workspace.ts';
import { createdAt } from '../../core/workspace.ts';
import type { Locale } from '../../i18n/locale.ts';
import { cellText, tableNote } from './assistant.ts';
import type { Meter } from './quota.ts';
import { quickModel } from './title.ts';

const SUGGEST_MS = 15_000;

// Rows the model reads to know what the table holds and what was logged last.
const LATEST_ROWS = 6;

const LANGUAGES: Record<Locale, string> = { en: 'English', fr: 'French' };

const SYSTEM = `Suggest what the person could ask the assistant of Torsel, a data app, about the table on their screen. Give three requests, written as they would type them to the assistant, each at most 7 words, in the language named in <language>. Use the table's own names and values exactly as written, never a near word, and never a value the table doesn't hold. The first starts logging a new row and stops right before its values, which the person will say: it names the kind of row ("Log a weight", "Add a film", "Add an item") or, when the latest rows repeat one, the thing they repeat ("Log bench press declined"), and never states a value of the new row, an amount or a row that already exists. It has complete false. The other two are questions someone who keeps this table would ask, which its rows answer: a best or a total, when something last happened, how two things compare. Each ends with a question mark, with complete true, and never asks about a period the rows don't reach. No quotes, no final period, no emoji.`;

const FORMAT = {
	type: 'json_schema' as const,
	schema: {
		type: 'object',
		properties: {
			suggestions: {
				type: 'array',
				items: {
					type: 'object',
					properties: { text: { type: 'string' }, complete: { type: 'boolean' } },
					required: ['text', 'complete'],
					additionalProperties: false
				}
			}
		},
		required: ['suggestions'],
		additionalProperties: false
	}
};

export function suggestPrompt(
	ws: Workspace,
	context: ThreadContext,
	locale: Locale
): string | null {
	const note = tableNote(ws, context);
	if (note === null || context.table === null) return null;
	const fields = ws.fields(context.table).filter((field) => field.type !== 'formula');
	const latest = ws
		.rows(context.table)
		.sort((a, b) => createdAt(b) - createdAt(a))
		.slice(0, LATEST_ROWS)
		.map((row) =>
			JSON.stringify(
				Object.fromEntries(
					fields
						.filter((field) => row.data[field.id] != null && row.data[field.id] !== '')
						.map((field) => [field.name, cellText(ws, field, row.data[field.id])])
				)
			)
		);
	return [
		`<language>${LANGUAGES[locale]}</language>`,
		`<today>${context.today ?? todayIso()}</today>`,
		`<screen>\n${note.join('\n')}\n</screen>`,
		`<latest_rows>\n${latest.join('\n') || 'none yet'}\n</latest_rows>`
	].join('\n');
}

const cache = new Map<string, Suggestion[]>();

/** What one screen's state is cached under: a new row, field or view asks again. */
function cacheKey(ws: Workspace, userId: string, context: ThreadContext, locale: Locale): string {
	const table = context.table ?? '';
	const shape = ws
		.fields(table)
		.map((field) => `${field.id}:${field.type}`)
		.join(',');
	const views = ws
		.views(table)
		.map((view) => view.id)
		.join(',');
	return [
		userId,
		locale,
		context.today,
		table,
		context.view,
		ws.rows(table).length,
		shape,
		views
	].join('|');
}

/** Up to three requests for an empty thread on a table; none when the model can't be had. */
export async function suggest(
	client: Anthropic,
	ws: Workspace,
	userId: string,
	context: ThreadContext,
	locale: Locale,
	meter: Meter
): Promise<Suggestion[]> {
	const prompt = suggestPrompt(ws, context, locale);
	if (prompt === null) return [];
	const key = cacheKey(ws, userId, context, locale);
	const cached = cache.get(key);
	if (cached !== undefined) return cached;

	const message = await client.beta.messages.create(
		{
			...quickModel(),
			max_tokens: 400,
			system: SYSTEM,
			output_config: { effort: 'low', format: FORMAT },
			messages: [{ role: 'user', content: prompt }]
		},
		{ timeout: SUGGEST_MS, maxRetries: 1 }
	);
	meter(message);
	const text = message.content.find((block) => block.type === 'text')?.text ?? '';
	let parsed: unknown;
	try {
		parsed = (JSON.parse(text) as { suggestions?: unknown }).suggestions;
	} catch {
		return [];
	}
	const list = fitSuggestions(parsed);
	if (cache.size > 2000) cache.clear();
	cache.set(key, list);
	return list;
}
