import { PATH, SOURCE } from '../../core/access.ts';
import type { FieldSpec } from '../../core/actions.ts';
import { createTable, homeBase, updateRecord } from '../../core/actions.ts';
import { guessColumns } from '../../core/csv.ts';
import type { Change } from '../../core/model.ts';
import { FORMAT_KEYS, hasChoices } from '../../core/model.ts';
import { numberedName } from '../../core/names.ts';
import type { Column, Every, Missing, SourceState } from '../../core/source.ts';
import { EVERY, MISSING, SOURCE_TYPES, markValue } from '../../core/source.ts';
import { names } from '../../i18n/names.ts';
import { sourceLimits } from '../config.ts';
import type { Database } from '../db/client.ts';
import { loadWorkspace, writeChanges } from '../db/records.ts';
import type { Source } from '../db/schema.ts';
import { serially } from '../db/serial.ts';
import type { Auth } from './fetch.ts';
import { AUTH_KINDS, RUN_CAPS, pull, redact } from './fetch.ts';
import type { Format, Item } from './read.ts';
import { cellsOf, guessKey, pathName } from './read.ts';
import { CONNECTOR, authOf, bound, nextRun } from './run.ts';
import { hintOf, seal } from './secrets.ts';
import { deleteSource, insertSource, readSource, sourceTables, updateSource } from './store.ts';

export type SourceSpec = {
	base: string | null;
	// The table's name; the source's own name when left out.
	name: string | null;
	label: string;
	url: string;
	auth: Auth;
	secret: string | null;
	rows: string | null;
	key: string | null;
	filter: string | null;
	every: Every;
	missing: Missing;
	columns: Column[];
};

export type Refusal = 'url' | 'columns' | 'base' | 'count' | 'auth' | 'gone' | 'key';

export class SourceRefused extends Error {
	constructor(readonly reason: Refusal) {
		super(`source refused: ${reason}`);
		this.name = 'SourceRefused';
	}
}

const MAX_COLUMNS = 100;
const PREVIEW_ROWS = 20;
const PREVIEW_MS = 20_000;

/** The URL to store and the key to seal: a query key pasted inside the link moves to the secret. */
export function splitKey(
	url: string,
	auth: Auth,
	secret: string | null
): { url: string; secret: string | null } {
	let parsed: URL;
	try {
		parsed = new URL(url.trim());
	} catch {
		throw new SourceRefused('url');
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new SourceRefused('url');
	const inline =
		auth.kind === 'query' && auth.name !== null ? parsed.searchParams.get(auth.name) : null;
	return {
		url: redact(parsed.href, auth),
		secret: secret !== null && secret !== '' ? secret : inline
	};
}

export function checkAuth(auth: Auth): Auth {
	if (!AUTH_KINDS.includes(auth.kind)) throw new SourceRefused('auth');
	const named = auth.kind === 'header' || auth.kind === 'query';
	const name = named ? (auth.name ?? '').trim() : '';
	if (named && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/u.test(name)) throw new SourceRefused('auth');
	return { kind: auth.kind, name: named ? name : null };
}

function fieldSpecs(columns: Column[]): FieldSpec[] {
	const taken: string[] = [];
	return columns.map((column) => {
		const name = numberedName(taken, column.name.trim() || pathName('json', column.path));
		taken.push(name);
		const format = Object.fromEntries(
			FORMAT_KEYS.filter((key) => column[key] !== undefined).map((key) => [key, column[key]])
		);
		return {
			...format,
			name,
			type: column.type,
			choices: hasChoices(column.type)
				? (column.choices ?? []).map((choice) => ({ name: choice, color: null }))
				: []
		};
	});
}

/** Makes the source's table with its fields read-only, and registers the source; the first run is the caller's. */
export async function createSource(
	db: Database,
	userId: string,
	spec: SourceSpec
): Promise<{ table: string; base: string; changes: Change[] }> {
	const auth = checkAuth(spec.auth);
	const { url, secret } = splitKey(spec.url, auth, spec.secret);
	if (
		spec.columns.length === 0 ||
		spec.columns.length > MAX_COLUMNS ||
		spec.columns.some(
			(column) => !(SOURCE_TYPES as readonly string[]).includes(column.type) || column.path === ''
		)
	) {
		throw new SourceRefused('columns');
	}
	if (!EVERY.includes(spec.every) || !MISSING.includes(spec.missing)) {
		throw new SourceRefused('columns');
	}
	// Rows known by all their values come back as new ones when one changes: kept, the old one stays too.
	if (spec.missing === 'keep' && spec.key === null) throw new SourceRefused('key');

	return serially(userId, async () => {
		const ws = loadWorkspace(db, userId);
		// A deleted table's source waits for an undo; it doesn't count against the cap.
		const live = sourceTables(db, userId).filter((id) => ws.table(id) !== undefined);
		if (live.length >= sourceLimits().sources) throw new SourceRefused('count');
		let home: { id: string; changes: Change[] };
		if (spec.base === null) {
			home = homeBase(ws, names);
		} else if (ws.base(spec.base) !== undefined) {
			home = { id: spec.base, changes: [] };
		} else {
			throw new SourceRefused('base');
		}
		const name = numberedName(
			ws.tables(home.id).map((table) => table.name),
			spec.name?.trim() || spec.label
		);
		const made = createTable(ws, home.id, name, fieldSpecs(spec.columns), () => [
			{ name: names.views.grid, type: 'grid', config: {} }
		]);
		const changes = made.changes.map((change) => {
			if (change.id === made.id) {
				return {
					...change,
					set: { ...change.set, [SOURCE]: markValue({ name: spec.label, problem: null, at: null }) }
				};
			}
			const at = made.fieldIds.indexOf(change.id);
			return at < 0 ? change : { ...change, set: { ...change.set, [PATH]: spec.columns[at].path } };
		});
		writeChanges(db, CONNECTOR(userId), ws, [...home.changes, ...changes]);

		const row: Source = {
			userId,
			tableId: made.id,
			baseId: home.id,
			url,
			auth: auth.kind,
			authName: auth.name,
			secret: null,
			hint: null,
			rows: spec.rows,
			key: spec.key,
			filter: spec.filter,
			every: spec.every,
			missing: spec.missing,
			nextAt: null,
			lastAt: null,
			lastOkAt: null,
			failures: 0,
			problem: null,
			createdAt: new Date()
		};
		if (secret !== null && auth.kind !== 'none') {
			row.secret = seal(secret, bound(row));
			row.hint = hintOf(secret);
		}
		insertSource(db, row);
		return { table: made.id, base: home.id, changes };
	});
}

export type Preview = {
	format: Format;
	url: string;
	columns: Column[];
	items: Item[];
	count: number;
	more: boolean;
	rowPaths: string[];
	rows: string;
	key: string | null;
};

/** The first page of a link, read as a table would be: columns with their types, a few rows, a key. */
export async function previewSource(input: {
	url: string;
	auth: Auth;
	secret: string | null;
	rows: string | null;
	filter?: string | null;
}): Promise<Preview> {
	const auth = checkAuth(input.auth);
	const { url, secret } = splitKey(input.url, auth, input.secret);
	const pulled = await pull(
		{ url, auth, secret, rows: input.rows },
		{ ...RUN_CAPS, pages: 1, rows: sourceLimits().rows, ms: PREVIEW_MS }
	);
	const paths = pulled.paths;
	const header = paths.map((path) => pathName(pulled.format, path));
	const guessed = guessColumns(
		[header, ...cellsOf({ paths, items: pulled.items }).slice(1)],
		names
	);
	const columns = guessed.map((guess, at) => {
		const { name, type, choices, ...format } = guess;
		// A source's types lock and a later page may hold 0 or 4.5, which a rating drops.
		return { ...format, path: paths[at], name, type: type === 'rating' ? 'number' : type, choices };
	});
	const filter = input.filter ?? null;
	const items =
		filter === null ? pulled.items : pulled.items.filter((item) => (item[filter] ?? '') !== '');
	return {
		format: pulled.format,
		url,
		columns,
		items: items.slice(0, PREVIEW_ROWS),
		count: items.length,
		more: !pulled.complete,
		rowPaths: pulled.rowPaths,
		rows: pulled.rows,
		key: guessKey(pulled.items, paths)
	};
}

export type SourcePatch = {
	every?: Every;
	missing?: Missing;
	secret?: string;
	url?: string;
};

/** Changes a source's schedule, its handling of missing rows, or its key; a new key or schedule wakes a paused source. */
export function patchSource(
	db: Database,
	userId: string,
	tableId: string,
	patch: SourcePatch
): Source {
	const source = readSource(db, userId, tableId);
	if (source === undefined) throw new SourceRefused('gone');
	const set: Partial<Source> = {};
	if (patch.every !== undefined) {
		if (!EVERY.includes(patch.every)) throw new SourceRefused('columns');
		set.every = patch.every;
		set.nextAt = nextRun(patch.every, Date.now());
	}
	if (patch.missing !== undefined) {
		if (!MISSING.includes(patch.missing)) throw new SourceRefused('columns');
		if (patch.missing === 'keep' && source.key === null) throw new SourceRefused('key');
		set.missing = patch.missing;
	}
	if (patch.url !== undefined) {
		const moved = splitKey(patch.url, authOf(source), null);
		set.url = moved.url;
		set.failures = 0;
		if (moved.secret !== null && source.auth === 'query') {
			set.secret = seal(moved.secret, bound(source));
			set.hint = hintOf(moved.secret);
		} else if (new URL(moved.url).origin !== new URL(source.url).origin) {
			// A key is given to one site: pointed elsewhere, it is asked for again rather than sent there.
			set.secret = null;
			set.hint = null;
		}
	}
	if (patch.secret !== undefined) {
		if (source.auth === 'none' || patch.secret.trim() === '') throw new SourceRefused('auth');
		set.secret = seal(patch.secret.trim(), bound(source));
		set.hint = hintOf(patch.secret.trim());
		set.failures = 0;
	}
	updateSource(db, userId, tableId, set);
	return { ...source, ...set };
}

/** "Stop syncing": the source goes, the table and its values stay, every field editable again. */
export async function stopSource(db: Database, userId: string, tableId: string): Promise<void> {
	await serially(userId, async () => {
		const source = readSource(db, userId, tableId);
		const ws = loadWorkspace(db, userId, source?.baseId);
		const changes: Change[] = [];
		if (ws.table(tableId) !== undefined) {
			changes.push(...updateRecord(ws, tableId, { [SOURCE]: null }));
			for (const field of ws.fields(tableId)) {
				if (ws.get(field.id)?.data[PATH] != null) {
					changes.push(...updateRecord(ws, field.id, { [PATH]: null }));
				}
			}
		}
		if (changes.length > 0) writeChanges(db, CONNECTOR(userId), ws, changes);
		deleteSource(db, userId, tableId);
	});
}

/** What a device may know of a source: never its key, only that it has one and how it ends. */
export function publicSource(source: Source): SourceState {
	return {
		table: source.tableId,
		url: source.url,
		auth: source.auth,
		authName: source.authName,
		hasKey: source.secret !== null,
		hint: source.hint,
		every: source.every,
		missing: source.missing,
		lastAt: source.lastAt?.getTime() ?? null,
		lastOkAt: source.lastOkAt?.getTime() ?? null,
		nextAt: source.nextAt?.getTime() ?? null,
		failures: source.failures,
		problem: source.problem
	};
}

export type PublicSource = ReturnType<typeof publicSource>;
