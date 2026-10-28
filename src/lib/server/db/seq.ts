import { eq, sql } from 'drizzle-orm';

import type { Database } from './client.ts';
import { syncCounters } from './schema.ts';

export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

// Call inside the same transaction as the write it stamps: a crash between the
// two burns a seq that the client's watermark then steps over.
export function claimSeq(executor: Executor, userId: string): number {
	const row = executor
		.update(syncCounters)
		.set({ nextSeq: sql`${syncCounters.nextSeq} + 1` })
		.where(eq(syncCounters.userId, userId))
		.returning({ nextSeq: syncCounters.nextSeq })
		.get();

	if (row === undefined) {
		throw new Error(`No sync counter for user ${userId}`);
	}

	return row.nextSeq - 1;
}
