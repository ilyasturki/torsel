import type Anthropic from '@anthropic-ai/sdk';

import { fitTitle } from '../../core/thread.ts';
import { envText } from '../env.ts';
import type { Meter } from './quota.ts';

export const TITLE_MODEL = 'claude-haiku-5-5';

/** The model of the short calls beside a turn: titles, suggestions, follow-ups, fills without the web. */
export function quickModel(): { model: string } {
	return { model: envText('TORSEL_AI_TITLE_MODEL', TITLE_MODEL) };
}

// Room for the little thinking a short answer takes at low effort, and the answer.
export const QUICK_TOKENS = 2000;

// Past it the reply is long done, and the first message stands in.
const TITLE_MS = 20_000;

const SYSTEM = `Name this conversation for a history list. Reply with the name only: 2 to 4 words, at most 32 characters, a noun phrase for its subject. Write it in the language of the person's message, never the language of their data or of the screen line: an English message gets an English name even when every table on screen is named in French. Copy their own names for tables and things exactly as written, never a near word. Sentence case. No quotes, no final punctuation, no emoji, no verb such as "help with" or "question about".`;

const FORMAT = {
	type: 'json_schema' as const,
	schema: {
		type: 'object',
		properties: { title: { type: 'string' } },
		required: ['title'],
		additionalProperties: false
	}
};

/** The first message as the title call reads it, with the screen that gives "this" its subject. */
export function titlePrompt(prompt: string, where: string): string {
	return `<screen>${where}</screen>\n<message>${prompt}</message>`;
}

/** A short name for the thread from its first message; null when the model gave nothing usable. */
export async function generateTitle(
	client: Anthropic,
	prompt: string,
	where: string,
	meter: Meter
): Promise<string | null> {
	const message = await client.beta.messages.create(
		{
			...quickModel(),
			max_tokens: QUICK_TOKENS,
			system: SYSTEM,
			output_config: { effort: 'low', format: FORMAT },
			messages: [{ role: 'user', content: titlePrompt(prompt, where) }]
		},
		{ timeout: TITLE_MS, maxRetries: 1 }
	);
	meter(message);
	const text = message.content.find((block) => block.type === 'text')?.text ?? '';
	let title: unknown;
	try {
		title = (JSON.parse(text) as { title?: unknown }).title;
	} catch {
		return null;
	}
	if (typeof title !== 'string') return null;
	const fitted = fitTitle(title);
	return fitted === '' ? null : fitted;
}
