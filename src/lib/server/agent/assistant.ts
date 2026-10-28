import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { Hlc } from '../../core/clock.ts';
import { todayIso } from '../../core/values.ts';
import { anthropicKey } from '../config.ts';
import type { Database } from '../db/client.ts';
import { loadWorkspace } from '../db/records.ts';
import { envText } from '../env.ts';
import type { Action, ToolContext } from './toolkit.ts';
import { TOOLS, closeEngines, runTool, toolNamed } from './toolkit.ts';

const MAX_TURNS = 12;

const SYSTEM = `Tu es l'assistant intégré de Torsel, une application de données : des bases de tables typées (champs text, number, date, choice, check, link, formula) affichées par des vues (grid, entry, list, chart). La personne te parle depuis l'application, souvent sur son téléphone, parfois en dictant.

Agis avec les outils plutôt que d'expliquer comment faire. Saisir des données (add_rows, update_rows) s'applique tout de suite et la personne peut annuler. Créer ou modifier une base, une table, un champ ou une vue lui est proposé avant d'être appliqué. Une suppression lui est toujours confirmée. Tu n'as donc pas à demander la permission : fais ce qu'elle demande, l'application s'occupe du reste.

Lis le schéma avant d'écrire. Les noms de champs, les choix existants et les liens viennent de là : réutilise un choix existant plutôt que d'en créer un presque identique (« bench press » et non « Bench Press » si c'est ce que la table contient). Une valeur absente se laisse vide, jamais inventée. Pour lire des données, utilise query : du SQL SQLite en lecture seule sur des vues nommées comme les tables et les champs.

Une demande comme « 3×8 à 80 au développé couché » veut dire trois lignes de 8 répétitions à 80 kg, sur l'exercice existant qui correspond, à la date du jour. « La même chose que la dernière fois » se lit dans l'historique avec query.

Pour un champ calculé, écris une expression SQLite sur les champs de la ligne, noms entre guillemets doubles, et donne-lui une description d'une phrase en français. Pour une vue, choisis le type qui répond à la demande : chart pour une progression, entry pour saisir vite, list pour parcourir.

Réponds en une ou deux phrases courtes, dans la langue de la personne, sans markdown : ta réponse s'affiche dans une petite bulle. Dis ce que tu as fait ou proposé, pas comment.`;

function inputSchema(schema: z.ZodObject): Anthropic.Beta.BetaTool.InputSchema {
	const { $schema: _, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
	return json as Anthropic.Beta.BetaTool.InputSchema;
}

const TOOL_DEFS: Anthropic.Beta.BetaTool[] = TOOLS.map((tool) => ({
	name: tool.name,
	description: tool.description,
	input_schema: inputSchema(tool.input)
}));

export type AssistantContext = {
	base?: string | null;
	table?: string | null;
	view?: string | null;
};

export type AssistantResult = { reply: string; actions: Action[] };

export class AssistantUnavailable extends Error {}

function contextNote(ws: ReturnType<typeof loadWorkspace>, context: AssistantContext): string {
	const lines = [`Aujourd'hui : ${todayIso()}.`];

	const base = context.base ? ws.base(context.base) : undefined;
	if (base !== undefined) {
		lines.push(`Base ouverte : « ${base.name} » (${base.id}).`);
		const table = context.table ? ws.table(context.table) : undefined;
		if (table !== undefined) {
			lines.push(`Table ouverte : « ${table.name} ».`);
			const view = context.view ? ws.view(context.view) : undefined;
			if (view !== undefined) {
				lines.push(`Vue ouverte : « ${view.name} » (${view.type}).`);
			}
		}
	} else {
		lines.push(
			`Bases : ${
				ws
					.bases()
					.map((candidate) => `« ${candidate.name} »`)
					.join(', ') || 'aucune'
			}.`
		);
	}

	return lines.join('\n');
}

export async function runAssistant(
	db: Database,
	userId: string,
	prompt: string,
	context: AssistantContext
): Promise<AssistantResult> {
	const apiKey = anthropicKey();
	if (apiKey === undefined) {
		throw new AssistantUnavailable('ANTHROPIC_API_KEY manquante sur le serveur');
	}

	const client = new Anthropic({ apiKey });
	const model = envText('TORSEL_AI_MODEL', 'claude-opus-5-5');

	const ws = loadWorkspace(db, userId);
	const hlc = new Hlc('ai');
	const actions: Action[] = [];
	const ctx: ToolContext = {
		ws,
		commit(action) {
			for (const change of action.changes) {
				ws.stamp(change, hlc.tick());
			}
			actions.push(action);
		}
	};

	const messages: Anthropic.Beta.BetaMessageParam[] = [
		{ role: 'user', content: `${contextNote(ws, context)}\n\n${prompt}` }
	];

	try {
		for (let turn = 0; turn < MAX_TURNS; turn += 1) {
			const response = await client.beta.messages.create({
				model,
				max_tokens: 16000,
				betas: ['server-side-fallback-2026-07-01'],
				fallbacks: 'default',
				output_config: { effort: 'medium' },
				cache_control: { type: 'ephemeral' },
				system: SYSTEM,
				tools: TOOL_DEFS,
				messages
			});

			if (response.stop_reason === 'refusal') {
				return { reply: 'Je ne peux pas faire ça.', actions: [] };
			}

			const toolUses = response.content.filter(
				(block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use'
			);

			if (response.stop_reason === 'max_tokens' && toolUses.length > 0) {
				break;
			}

			if (toolUses.length === 0) {
				const reply = response.content
					.filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
					.map((block) => block.text)
					.join('\n')
					.trim();
				return { reply: reply || 'C’est fait.', actions };
			}

			messages.push({ role: 'assistant', content: response.content });

			const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
			for (const use of toolUses) {
				const tool = toolNamed(use.name);
				const outcome =
					tool === undefined
						? { ok: false as const, error: `outil inconnu : ${use.name}` }
						: await runTool(ctx, tool, use.input);

				results.push({
					type: 'tool_result',
					tool_use_id: use.id,
					is_error: !outcome.ok,
					content: JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error })
				});
			}

			messages.push({ role: 'user', content: results });
		}

		return { reply: 'Je me suis arrêté avant d’avoir fini ; reformule plus simplement.', actions };
	} finally {
		closeEngines(ws);
	}
}
