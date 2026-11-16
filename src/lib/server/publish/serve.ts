import { eq } from 'drizzle-orm';

import type { Workspace } from '../../core/workspace.ts';
import type { Database } from '../db/client.ts';
import type { Publication } from '../db/schema.ts';
import { loadWorkspace } from '../db/records.ts';
import { syncCounters } from '../db/schema.ts';
import { sqlPool } from '../sql/pool.ts';
import type { Built, Compute } from './payload.ts';
import { buildPublished } from './payload.ts';
import { findPublication, publishableView } from './store.ts';

export type Served = Built & { userId: string; baseId: string };

// One page load asks for the payload, then for each image: they share one build, until the owner's records move.
const HELD = 200;

const held = new Map<string, { userId: string; seq: number; served: Promise<Served | null> }>();

function seqOf(db: Database, userId: string): number {
	return (
		db
			.select({ next: syncCounters.nextSeq })
			.from(syncCounters)
			.where(eq(syncCounters.userId, userId))
			.get()?.next ?? 0
	);
}

function poolFor(ws: Workspace, baseId: string): Compute {
	const records = ws.baseRecords(baseId);
	return {
		computed: async (table) =>
			new Map(await sqlPool.run(records, baseId, { kind: 'computed', table })),
		chart: (table, config, only) =>
			sqlPool.run(records, baseId, { kind: 'chart', table, config, only })
	};
}

async function build(db: Database, publication: Publication): Promise<Served | null> {
	const view = publishableView(db, publication.userId, publication.viewId);
	if (view === undefined) return null;
	const ws = loadWorkspace(db, publication.userId, view.base);
	const built = await buildPublished(ws, view.id, poolFor(ws, view.base));
	return built === null ? null : { ...built, userId: publication.userId, baseId: view.base };
}

export function served(db: Database, token: string): Promise<Served | null> {
	const hit = held.get(token);
	if (hit !== undefined && hit.seq === seqOf(db, hit.userId)) return hit.served;

	const publication = findPublication(db, token);
	if (publication === undefined) {
		held.delete(token);
		return Promise.resolve(null);
	}
	const seq = seqOf(db, publication.userId);
	const served = build(db, publication);
	held.delete(token);
	while (held.size >= HELD) {
		const oldest = held.keys().next().value;
		if (oldest === undefined) break;
		held.delete(oldest);
	}
	held.set(token, { userId: publication.userId, seq, served });
	served.catch(() => {
		if (held.get(token)?.served === served) held.delete(token);
	});
	return served;
}

/** An unpublished link stops at once, not when its build goes stale. */
export function forget(token: string): void {
	held.delete(token);
}
