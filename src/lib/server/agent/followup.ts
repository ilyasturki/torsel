import type Anthropic from '@anthropic-ai/sdk';

import { MAX_SUGGESTION } from '../../core/thread.ts';
import type { Meter } from './quota.ts';
import { QUICK_TOKENS, quickModel } from './title.ts';

// Past it the reply is long read, and an empty box stands in.
const FOLLOW_UP_MS = 15_000;

const SYSTEM = `Suggest the one request the person is most likely to make next to the assistant of Torsel, a data app, after the exchange given. Write it as they would type it, at most 8 words, in the language of the words in <message>, never that of the table's names or data: an English message gets an English request even when every name on screen is French. Use the table's own names exactly as written. It is something the assistant can do with their tables: a question their data answers, a change, a chart or a view. Never repeat what was just done or asked. Give null when nothing obvious comes next. No quotes, no final period.`;

const FORMAT = {
	type: 'json_schema' as const,
	schema: {
		type: 'object',
		properties: { follow_up: { type: ['string', 'null'] } },
		required: ['follow_up'],
		additionalProperties: false
	}
};

export function followUpPrompt(screen: string[] | null, asked: string, replied: string): string {
	return [
		...(screen === null ? [] : [`<screen>\n${screen.join('\n')}\n</screen>`]),
		`<message>${asked}</message>`,
		`<reply>${replied}</reply>`
	].join('\n');
}

/** The next request worth offering after a reply, on one line, or null. */
export async function followUp(
	client: Anthropic,
	meter: Meter,
	screen: string[] | null,
	asked: string,
	replied: string
): Promise<string | null> {
	const message = await client.beta.messages.create(
		{
			...quickModel(),
			max_tokens: QUICK_TOKENS,
			system: SYSTEM,
			output_config: { effort: 'low', format: FORMAT },
			messages: [{ role: 'user', content: followUpPrompt(screen, asked, replied) }]
		},
		{ timeout: FOLLOW_UP_MS, maxRetries: 1 }
	);
	meter(message);
	const text = message.content.find((block) => block.type === 'text')?.text ?? '';
	let next: unknown;
	try {
		next = (JSON.parse(text) as { follow_up?: unknown }).follow_up;
	} catch {
		return null;
	}
	if (typeof next !== 'string') return null;
	const line = next
		.replace(/\s+/gu, ' ')
		.trim()
		.replace(/^["'«“]+|["'»”]+$/gu, '')
		.replace(/[\s.]+$/u, '');
	return line === '' || line.length > MAX_SUGGESTION ? null : line;
}
