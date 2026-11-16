import type { Workspace } from '../../core/workspace.ts';
import type { Database } from '../db/client.ts';
import { loadWorkspace } from '../db/records.ts';
import { sqlPool } from '../sql/pool.ts';
import type { Built, Compute } from './payload.ts';
import { buildPublished } from './payload.ts';
import { findPublication, publishableView } from './store.ts';

export type Served = Built & { userId: string; baseId: string };

// One page load asks for the payload, then for each image: they share one build.
const FRESH_MS = 30_000;
const HELD = 200;

const held = new Map<string, { at: number; served: Promise<Served | null> }>();

function poolFor(ws: Workspace, baseId: string): Compute {
	const records = ws.baseRecords(baseId);
	return {
		computed: async (table) =>
			new Map(await sqlPool.run(records, baseId, { kind: 'computed', table })),
		chart: (table, config) => sqlPool.run(records, baseId, { kind: 'chart', table, config })
	};
}

async function build(db: Database, token: string): Promise<Served | null> {
	const publication = findPublication(db, token);
	if (publication === undefined) return null;
	const view = publishableView(db, publication.userId, publication.viewId);
	if (view === undefined) return null;
	const ws = loadWorkspace(db, publication.userId, view.base);
	const built = await buildPublished(ws, view.id, poolFor(ws, view.base));
	return built === null ? null : { ...built, userId: publication.userId, baseId: view.base };
}

/** What a link shows, or null for a token that opens nothing. */
export function served(db: Database, token: string): Promise<Served | null> {
	const now = Date.now();
	const hit = held.get(token);
	if (hit !== undefined && now - hit.at < FRESH_MS) return hit.served;

	const served = build(db, token);
	held.delete(token);
	while (held.size >= HELD) {
		const oldest = held.keys().next().value;
		if (oldest === undefined) break;
		held.delete(oldest);
	}
	held.set(token, { at: now, served });
	served.catch(() => {
		if (held.get(token)?.served === served) held.delete(token);
	});
	return served;
}

/** An unpublished link stops at once, not when its build goes stale. */
export function forget(token: string): void {
	held.delete(token);
}
