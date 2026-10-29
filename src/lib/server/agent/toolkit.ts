import { z } from 'zod';

import type { FieldSpec } from '../../core/actions.ts';
import {
	addField,
	createBase,
	createTable,
	createView,
	deleteRecords,
	insertRows,
	updateRecord,
	updateRow
} from '../../core/actions.ts';
import type { MemoryEngine } from '../../core/engine.ts';
import { openEngine } from '../../core/engine.ts';
import { FormulaError, toDisplay, toStored } from '../../core/formula.ts';
import type { Change, Choice, FieldDef, TableDef, Value, ViewConfig } from '../../core/model.ts';
import { FIELD_TYPES, VIEW_TYPES } from '../../core/model.ts';
import { formulaProblem, materializeBase, readQuery } from '../../core/sql.ts';
import type { Workspace } from '../../core/workspace.ts';

export type Tier = 'apply' | 'propose' | 'confirm';

export type Action = { tier: Tier; summary: string; changes: Change[] };

export type ToolContext = {
	ws: Workspace;
	commit(action: Action): void;
};

export type Tool = {
	name: string;
	title: string;
	description: string;
	input: z.ZodObject;
	readOnly?: boolean;
	destructive?: boolean;
	run(ctx: ToolContext, input: never): Promise<unknown> | unknown;
};

export class ToolError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'ToolError';
	}
}

function same(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function findBase(ws: Workspace, ref: string): { id: string; name: string } {
	const base = ws.base(ref) ?? ws.bases().find((candidate) => same(candidate.name, ref));
	if (base === undefined) {
		throw new ToolError(`aucune base « ${ref} » ; list_bases donne les noms`);
	}
	return base;
}

export function findTable(ws: Workspace, baseId: string, ref: string): TableDef {
	const table = ws
		.tables(baseId)
		.find((candidate) => candidate.id === ref || same(candidate.name, ref));
	if (table === undefined) {
		throw new ToolError(`aucune table « ${ref} » dans cette base ; describe_base donne les noms`);
	}
	return table;
}

export function findField(ws: Workspace, tableId: string, ref: string): FieldDef {
	const field = ws
		.fields(tableId)
		.find((candidate) => candidate.id === ref || same(candidate.name, ref));
	if (field === undefined) {
		throw new ToolError(`aucun champ « ${ref} » dans cette table`);
	}
	return field;
}

function choicesOf(names: string[] | undefined, previous: Choice[] = []): Choice[] {
	return (names ?? []).map((name) => ({
		name,
		color: previous.find((choice) => choice.name === name)?.color ?? null
	}));
}

function storedFormula(
	ws: Workspace,
	tableId: string,
	formula: string,
	fields?: FieldDef[]
): string {
	try {
		return toStored(formula, fields ?? ws.fields(tableId));
	} catch (error) {
		throw new ToolError(error instanceof FormulaError ? error.message : String(error));
	}
}

const engines = new WeakMap<Workspace, Map<string, { version: number; engine: MemoryEngine }>>();
const versions = new WeakMap<Workspace, number>();

function bump(ws: Workspace): void {
	versions.set(ws, (versions.get(ws) ?? 0) + 1);
}

async function engineFor(ws: Workspace, baseId: string): Promise<MemoryEngine> {
	const version = versions.get(ws) ?? 0;
	let perBase = engines.get(ws);
	if (perBase === undefined) {
		perBase = new Map();
		engines.set(ws, perBase);
	}

	const cached = perBase.get(baseId);
	if (cached !== undefined && cached.version === version) {
		return cached.engine;
	}
	cached?.engine.close();

	const engine = await openEngine();
	materializeBase(engine, ws, baseId, true);
	engine.readOnly();
	perBase.set(baseId, { version, engine });

	return engine;
}

async function validateFormula(ws: Workspace, tableId: string, stored: string): Promise<void> {
	const table = ws.table(tableId);
	if (table === undefined) {
		return;
	}
	const problem = formulaProblem(await engineFor(ws, table.base), ws, tableId, stored);
	if (problem !== null) {
		throw new ToolError(`SQLite refuse la formule : ${problem}`);
	}
}

export function closeEngines(ws: Workspace): void {
	for (const { engine } of engines.get(ws)?.values() ?? []) {
		engine.close();
	}
	engines.delete(ws);
}

function commit(ctx: ToolContext, action: Action): void {
	ctx.commit(action);
	bump(ctx.ws);
}

const BASE = z.string().describe('nom ou id de la base');
const TABLE = z.string().describe('nom ou id de la table');
const ROW_VALUES = z
	.record(z.string(), z.unknown())
	.describe(
		'valeurs par nom de champ ; nombre, texte, date AAAA-MM-JJ, booléen pour une case, texte du choix, texte principal de la ligne liée'
	);

const FIELD = z.object({
	name: z.string().min(1),
	type: z.enum(FIELD_TYPES),
	choices: z.array(z.string()).optional().describe('pour un champ choice'),
	target: z.string().optional().describe('pour un champ link : la table liée'),
	formula: z
		.string()
		.optional()
		.describe(
			'pour un champ formula : une expression SQLite sur les champs de la ligne, noms entre guillemets doubles, ex. "Poids" * (1 + "Reps" / 30.0). Divise par 30.0 et non 30 : SQLite fait la division entière.'
		),
	description: z
		.string()
		.optional()
		.describe('une phrase en français qui dit ce que le champ contient')
});

type FieldInput = z.infer<typeof FIELD>;

function fieldSpec(ws: Workspace, baseId: string, input: FieldInput, tableId?: string): FieldSpec {
	const spec: FieldSpec = {
		name: input.name,
		type: input.type,
		description: input.description ?? null
	};

	if (input.type === 'choice') {
		spec.choices = choicesOf(input.choices);
	}
	if (input.type === 'link') {
		if (input.target === undefined) {
			throw new ToolError('un champ link a besoin de target');
		}
		spec.target = findTable(ws, baseId, input.target).id;
	}
	if (input.type === 'formula') {
		if (input.formula === undefined || tableId === undefined) {
			throw new ToolError('un champ formula a besoin de formula');
		}
		spec.expr = storedFormula(ws, tableId, input.formula);
	}

	return spec;
}

const VIEW_CONFIG = z
	.object({
		hidden: z.array(z.string()).optional().describe('grid : champs masqués'),
		sort: z
			.object({ field: z.string(), dir: z.enum(['asc', 'desc']) })
			.optional()
			.describe('grid'),
		fields: z.array(z.string()).optional().describe('entry : champs à saisir, dans l’ordre'),
		match: z
			.array(z.string())
			.optional()
			.describe(
				'entry : champs qui identifient « la dernière fois » pour pré-remplir, ex. ["Exercice"]'
			),
		group: z.string().optional().describe('list : champ de regroupement'),
		title: z.string().optional().describe('list : champ affiché en titre'),
		show: z.array(z.string()).optional().describe('list : champs affichés sous le titre'),
		kind: z.enum(['bar', 'line']).optional().describe('chart'),
		x: z.string().optional().describe('chart : champ en abscisse, souvent une date'),
		bucket: z.enum(['day', 'week', 'month']).optional().describe('chart : regroupement des dates'),
		agg: z.enum(['count', 'sum', 'avg', 'max', 'min']).optional().describe('chart'),
		y: z.string().optional().describe('chart : champ agrégé, sauf pour count'),
		color: z.string().optional().describe('chart : un champ choice qui sépare les séries'),
		rolling: z
			.number()
			.int()
			.min(2)
			.max(90)
			.optional()
			.describe('chart line : moyenne glissante sur N jours')
	})
	.describe('réglages de la vue, champs désignés par leur nom');

function viewConfig(
	ws: Workspace,
	tableId: string,
	input: z.infer<typeof VIEW_CONFIG>
): ViewConfig {
	const id = (name: string | undefined): string | null =>
		name === undefined ? null : findField(ws, tableId, name).id;
	const ids = (names: string[] | undefined): string[] | undefined =>
		names?.map((name) => findField(ws, tableId, name).id);

	const config: ViewConfig = {};
	if (input.hidden !== undefined) config.hidden = ids(input.hidden);
	if (input.sort !== undefined)
		config.sort = { field: findField(ws, tableId, input.sort.field).id, dir: input.sort.dir };
	if (input.fields !== undefined) config.fields = ids(input.fields);
	if (input.match !== undefined) config.match = ids(input.match);
	if (input.group !== undefined) config.group = id(input.group);
	if (input.title !== undefined) config.title = id(input.title);
	if (input.show !== undefined) config.show = ids(input.show);
	if (input.kind !== undefined) config.kind = input.kind;
	if (input.x !== undefined) config.x = id(input.x);
	if (input.bucket !== undefined) config.bucket = input.bucket;
	if (input.agg !== undefined) config.agg = input.agg;
	if (input.y !== undefined) config.y = id(input.y);
	if (input.color !== undefined) config.color = id(input.color);
	if (input.rolling !== undefined) config.rolling = input.rolling;

	return config;
}

function linkValue(ws: Workspace, field: FieldDef, value: unknown): unknown {
	if (field.type !== 'link' || field.target === null || typeof value !== 'string') {
		return value;
	}
	if (ws.live(value)?.kind === 'row') {
		return value;
	}

	const primary = ws.fields(field.target).find((candidate) => candidate.type === 'text');
	const match = ws
		.rows(field.target)
		.find(
			(row) =>
				primary !== undefined &&
				typeof row.data[primary.id] === 'string' &&
				same(String(row.data[primary.id]), value)
		);

	if (match === undefined) {
		throw new ToolError(`aucune ligne « ${value} » dans la table liée de « ${field.name} »`);
	}
	return match.id;
}

/** Field names to ids, link texts to row ids, unseen choices added to their field. */
function rowsByName(
	ws: Workspace,
	tableId: string,
	rows: Record<string, unknown>[]
): { rows: Record<string, unknown>[]; fieldChanges: Change[] } {
	const fields = ws.fields(tableId);
	const added = new Map<string, Set<string>>();

	const out = rows.map((values) => {
		const row: Record<string, unknown> = {};
		for (const [name, value] of Object.entries(values)) {
			const field = findField(ws, tableId, name);
			if (field.type === 'formula') {
				continue;
			}
			if (field.type === 'choice' && typeof value === 'string' && value.trim() !== '') {
				if (!field.choices.some((choice) => choice.name === value.trim())) {
					let names = added.get(field.id);
					if (names === undefined) {
						names = new Set();
						added.set(field.id, names);
					}
					names.add(value.trim());
				}
			}
			row[field.id] = linkValue(ws, field, value);
		}
		return row;
	});

	const fieldChanges = [...added].flatMap(([fieldId, names]) => {
		const field = fields.find((candidate) => candidate.id === fieldId) as FieldDef;
		const choices: Value = [...field.choices, ...[...names].map((name) => ({ name, color: null }))];
		return updateRecord(ws, fieldId, { choices });
	});

	return { rows: out, fieldChanges };
}

function describeField(ws: Workspace, field: FieldDef): Record<string, unknown> {
	const out: Record<string, unknown> = { id: field.id, name: field.name, type: field.type };

	if (field.type === 'choice') out.choices = field.choices.map((choice) => choice.name);
	if (field.type === 'link' && field.target !== null)
		out.target = ws.table(field.target)?.name ?? null;
	if (field.type === 'formula' && field.expr !== null)
		out.formula = toDisplay(field.expr, ws.fields(field.table));
	if (field.description !== null) out.description = field.description;

	return out;
}

function named(ws: Workspace, tableId: string, ids: string[] | undefined): string[] | undefined {
	return ids?.map((id) => ws.field(id)?.name ?? id);
}

function describeView(
	ws: Workspace,
	tableId: string,
	view: ReturnType<Workspace['views']>[number]
): Record<string, unknown> {
	const config: Record<string, unknown> = { ...view.config };
	for (const key of ['hidden', 'fields', 'match', 'show'] as const) {
		if (view.config[key] !== undefined) config[key] = named(ws, tableId, view.config[key]);
	}
	for (const key of ['group', 'title', 'x', 'y', 'color'] as const) {
		const id = view.config[key];
		if (typeof id === 'string') config[key] = ws.field(id)?.name ?? id;
	}
	return { id: view.id, name: view.name, type: view.type, config };
}

export const TOOLS: Tool[] = [
	{
		name: 'list_bases',
		title: 'Lister les bases',
		description: 'Les bases de la personne, avec leurs tables et le nombre de lignes de chacune.',
		input: z.object({}),
		readOnly: true,
		run: ({ ws }) =>
			ws.bases().map((base) => ({
				id: base.id,
				name: base.name,
				tables: ws
					.tables(base.id)
					.map((table) => ({ id: table.id, name: table.name, rows: ws.rows(table.id).length }))
			}))
	},
	{
		name: 'describe_base',
		title: 'Décrire une base',
		description:
			'Le schéma d’une base : ses tables, leurs champs (type, choix, formule, description) et leurs vues. À lire avant d’écrire une requête ou de modifier quoi que ce soit.',
		input: z.object({ base: BASE }),
		readOnly: true,
		run: ({ ws }, { base }: { base: string }) => {
			const found = findBase(ws, base);
			return {
				id: found.id,
				name: found.name,
				tables: ws.tables(found.id).map((table) => ({
					id: table.id,
					name: table.name,
					rows: ws.rows(table.id).length,
					fields: ws.fields(table.id).map((field) => describeField(ws, field)),
					views: ws.views(table.id).map((view) => describeView(ws, table.id, view))
				}))
			};
		}
	},
	{
		name: 'query',
		title: 'Lire avec SQL',
		description:
			'Une requête SELECT SQLite en lecture seule sur une base. Chaque table est une vue nommée comme la table, ses colonnes nommées comme ses champs : select "Exercice", max("Poids") from "Séries" group by 1. Les colonnes "_id" et "_créé" (ms) existent aussi. Dates en texte AAAA-MM-JJ, cases en 0/1, un lien se lit comme le texte de la ligne liée. 200 lignes au plus.',
		input: z.object({ base: BASE, sql: z.string().min(1) }),
		readOnly: true,
		run: async ({ ws }, { base, sql }: { base: string; sql: string }) => {
			const found = findBase(ws, base);
			try {
				const rows = readQuery(await engineFor(ws, found.id), sql);
				return { rows, count: rows.length };
			} catch (error) {
				throw new ToolError(error instanceof Error ? error.message : String(error));
			}
		}
	},
	{
		name: 'add_rows',
		title: 'Ajouter des lignes',
		description:
			'Ajoute des lignes à une table. Les valeurs se donnent par nom de champ ; un choix encore inconnu est ajouté au champ. S’applique tout de suite, la personne peut annuler.',
		input: z.object({ base: BASE, table: TABLE, rows: z.array(ROW_VALUES).min(1).max(500) }),
		run: (ctx, input: { base: string; table: string; rows: Record<string, unknown>[] }) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const { rows, fieldChanges } = rowsByName(ctx.ws, table.id, input.rows);
			const inserted = insertRows(ctx.ws, table.id, rows);
			commit(ctx, {
				tier: 'apply',
				summary: `${rows.length} ligne${rows.length > 1 ? 's' : ''} ajoutée${rows.length > 1 ? 's' : ''} à ${table.name}`,
				changes: [...fieldChanges, ...inserted.changes]
			});
			return { added: inserted.ids };
		}
	},
	{
		name: 'update_rows',
		title: 'Modifier des lignes',
		description:
			'Modifie des lignes existantes, désignées par leur "_id". Seuls les champs donnés changent. S’applique tout de suite.',
		input: z.object({
			base: BASE,
			table: TABLE,
			updates: z
				.array(z.object({ id: z.string(), values: ROW_VALUES }))
				.min(1)
				.max(500)
		}),
		run: (
			ctx,
			input: {
				base: string;
				table: string;
				updates: { id: string; values: Record<string, unknown> }[];
			}
		) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const { rows, fieldChanges } = rowsByName(
				ctx.ws,
				table.id,
				input.updates.map((update) => update.values)
			);
			const changes = input.updates.flatMap((update, index) => {
				if (ctx.ws.live(update.id)?.parent !== table.id) {
					throw new ToolError(`aucune ligne ${update.id} dans ${table.name}`);
				}
				return updateRow(ctx.ws, update.id, rows[index]);
			});
			commit(ctx, {
				tier: 'apply',
				summary: `${changes.length} ligne(s) modifiée(s) dans ${table.name}`,
				changes: [...fieldChanges, ...changes]
			});
			return { updated: changes.length };
		}
	},
	{
		name: 'delete_rows',
		title: 'Supprimer des lignes',
		description:
			'Supprime des lignes désignées par leur "_id". La personne confirme avant que rien ne disparaisse.',
		input: z.object({ base: BASE, table: TABLE, ids: z.array(z.string()).min(1).max(1000) }),
		destructive: true,
		run: (ctx, input: { base: string; table: string; ids: string[] }) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			for (const id of input.ids) {
				if (ctx.ws.live(id)?.parent !== table.id) {
					throw new ToolError(`aucune ligne ${id} dans ${table.name}`);
				}
			}
			commit(ctx, {
				tier: 'confirm',
				summary: `${input.ids.length} ligne(s) supprimée(s) de ${table.name}`,
				changes: deleteRecords(ctx.ws, input.ids)
			});
			return { deleted: input.ids.length };
		}
	},
	{
		name: 'create_base',
		title: 'Créer une base',
		description:
			'Crée une base vide, à remplir ensuite avec create_table. Proposé à la personne avant d’être appliqué.',
		input: z.object({ name: z.string().min(1) }),
		run: (ctx, { name }: { name: string }) => {
			const made = createBase(ctx.ws, name);
			commit(ctx, { tier: 'propose', summary: `Nouvelle base « ${name} »`, changes: made.changes });
			return { id: made.id };
		}
	},
	{
		name: 'create_table',
		title: 'Créer une table',
		description:
			'Crée une table avec ses champs, et ses vues Grille et Saisie. Les formules se créent ensuite avec add_field, une fois les champs qu’elles lisent en place. Proposé à la personne avant d’être appliqué.',
		input: z.object({
			base: BASE,
			name: z.string().min(1),
			fields: z
				.array(
					FIELD.omit({ formula: true }).extend({
						type: z.enum(['text', 'number', 'date', 'choice', 'check', 'link'])
					})
				)
				.min(1)
		}),
		run: (ctx, input: { base: string; name: string; fields: FieldInput[] }) => {
			const base = findBase(ctx.ws, input.base);
			const specs = input.fields.map((field) => fieldSpec(ctx.ws, base.id, field));
			const made = createTable(ctx.ws, base.id, input.name, specs);
			commit(ctx, {
				tier: 'propose',
				summary: `Nouvelle table « ${input.name} » dans ${base.name}`,
				changes: made.changes
			});
			return { id: made.id };
		}
	},
	{
		name: 'add_field',
		title: 'Ajouter un champ',
		description:
			'Ajoute un champ à une table, y compris un champ calculé (formula). Une formule est vérifiée par SQLite avant d’être proposée. Proposé à la personne avant d’être appliqué.',
		input: FIELD.extend({ base: BASE, table: TABLE }),
		run: async (ctx, input: FieldInput & { base: string; table: string }) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const spec = fieldSpec(ctx.ws, base.id, input, table.id);
			if (spec.expr != null) {
				await validateFormula(ctx.ws, table.id, spec.expr);
			}
			const made = addField(ctx.ws, table.id, spec);
			commit(ctx, {
				tier: 'propose',
				summary: `Nouveau champ « ${input.name} » dans ${table.name}`,
				changes: made.changes
			});
			return { id: made.id };
		}
	},
	{
		name: 'update_field',
		title: 'Modifier un champ',
		description:
			'Renomme un champ, change ses choix, sa formule ou sa description. Proposé à la personne avant d’être appliqué.',
		input: z.object({
			base: BASE,
			table: TABLE,
			field: z.string(),
			name: z.string().min(1).optional(),
			choices: z.array(z.string()).optional(),
			formula: z.string().optional(),
			description: z.string().optional()
		}),
		run: async (
			ctx,
			input: {
				base: string;
				table: string;
				field: string;
				name?: string;
				choices?: string[];
				formula?: string;
				description?: string;
			}
		) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const field = findField(ctx.ws, table.id, input.field);
			const set: Record<string, Value> = {};
			if (input.name !== undefined) set.name = input.name.trim();
			if (input.choices !== undefined) set.choices = choicesOf(input.choices, field.choices);
			if (input.description !== undefined) set.description = input.description;
			if (input.formula !== undefined) {
				if (field.type !== 'formula')
					throw new ToolError(`« ${field.name} » n'est pas un champ calculé`);
				set.expr = storedFormula(ctx.ws, table.id, input.formula);
				await validateFormula(ctx.ws, table.id, set.expr);
			}
			commit(ctx, {
				tier: 'propose',
				summary: `Champ « ${field.name} » modifié`,
				changes: updateRecord(ctx.ws, field.id, set)
			});
			return { updated: field.id };
		}
	},
	{
		name: 'create_view',
		title: 'Créer une vue',
		description:
			'Ajoute une vue à une table : grid (le tableur), entry (saisie rapide sur téléphone, pré-remplie depuis la dernière ligne qui a les mêmes valeurs de match), list (cartes regroupées) ou chart (barres ou courbe d’un agrégat). Proposé à la personne avant d’être appliqué.',
		input: z.object({
			base: BASE,
			table: TABLE,
			name: z.string().min(1),
			type: z.enum(VIEW_TYPES),
			config: VIEW_CONFIG
		}),
		run: (
			ctx,
			input: {
				base: string;
				table: string;
				name: string;
				type: (typeof VIEW_TYPES)[number];
				config: z.infer<typeof VIEW_CONFIG>;
			}
		) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const made = createView(ctx.ws, table.id, {
				name: input.name,
				type: input.type,
				config: viewConfig(ctx.ws, table.id, input.config)
			});
			commit(ctx, {
				tier: 'propose',
				summary: `Nouvelle vue « ${input.name} » sur ${table.name}`,
				changes: made.changes
			});
			return { id: made.id };
		}
	},
	{
		name: 'delete',
		title: 'Supprimer une table, un champ ou une vue',
		description:
			'Supprime une table, un champ ou une vue par son id (describe_base les donne). La personne confirme avant.',
		input: z.object({ base: BASE, id: z.string() }),
		destructive: true,
		run: (ctx, input: { base: string; id: string }) => {
			const base = findBase(ctx.ws, input.base);
			const rec = ctx.ws.live(input.id);
			if (
				rec === undefined ||
				rec.base !== base.id ||
				!['table', 'field', 'view'].includes(rec.kind)
			) {
				throw new ToolError(
					`aucune table, aucun champ ni aucune vue ${input.id} dans ${base.name}`
				);
			}
			const name = typeof rec.data.name === 'string' ? rec.data.name : rec.id;
			commit(ctx, {
				tier: 'confirm',
				summary: `« ${name} » supprimé`,
				changes: deleteRecords(ctx.ws, [rec.id])
			});
			return { deleted: rec.id };
		}
	}
];

export function toolNamed(name: string): Tool | undefined {
	return TOOLS.find((tool) => tool.name === name);
}

export async function runTool(
	ctx: ToolContext,
	tool: Tool,
	raw: unknown
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
	const parsed = tool.input.safeParse(raw);
	if (!parsed.success) {
		return { ok: false, error: z.prettifyError(parsed.error) };
	}

	try {
		return { ok: true, result: await tool.run(ctx, parsed.data as never) };
	} catch (error) {
		if (error instanceof ToolError) {
			return { ok: false, error: error.message };
		}
		throw error;
	}
}
