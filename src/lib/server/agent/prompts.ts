import { randomUUID } from 'node:crypto';

import { and, asc, count, eq } from 'drizzle-orm';

import type { SavedPrompt } from '../../core/thread.ts';
import type { Database } from '../db/client.ts';
import { savedPrompts } from '../db/schema.ts';

export function listPrompts(db: Database, userId: string): SavedPrompt[] {
	return db
		.select({ id: savedPrompts.id, name: savedPrompts.name, text: savedPrompts.text })
		.from(savedPrompts)
		.where(eq(savedPrompts.userId, userId))
		.orderBy(asc(savedPrompts.name), asc(savedPrompts.createdAt))
		.all();
}

export function countPrompts(db: Database, userId: string): number {
	return (
		db.select({ n: count() }).from(savedPrompts).where(eq(savedPrompts.userId, userId)).get()?.n ??
		0
	);
}

export function savePrompt(db: Database, userId: string, name: string, text: string): SavedPrompt {
	const prompt = { id: randomUUID(), name, text };
	db.insert(savedPrompts)
		.values({ ...prompt, userId, createdAt: new Date() })
		.run();
	return prompt;
}

/** Whether there was one to delete. */
export function deletePrompt(db: Database, userId: string, id: string): boolean {
	return (
		db
			.delete(savedPrompts)
			.where(and(eq(savedPrompts.id, id), eq(savedPrompts.userId, userId)))
			.run().changes > 0
	);
}
