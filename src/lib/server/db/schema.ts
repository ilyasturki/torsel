import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { Change, Rec } from '../../core/model.ts';
import type { ActionStatus, RowMeta, Tier } from '../../core/thread.ts';

export const users = sqliteTable(
	'users',
	{
		id: text('id').notNull(),
		email: text('email').notNull().unique(),
		passwordHash: text('password_hash').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [primaryKey({ columns: [table.id] })]
);

export type User = typeof users.$inferSelect;

export const authTokens = sqliteTable(
	'auth_tokens',
	{
		id: text('id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		kind: text('kind', { enum: ['web', 'device', 'api'] }).notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		tokenPrefix: text('token_prefix').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' })
	},
	(table) => [primaryKey({ columns: [table.id] }), index('auth_tokens_user_idx').on(table.userId)]
);

export type AuthToken = typeof authTokens.$inferSelect;

export const syncCounters = sqliteTable(
	'sync_counters',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		nextSeq: integer('next_seq').notNull().default(1)
	},
	(table) => [primaryKey({ columns: [table.userId] })]
);

export const records = sqliteTable(
	'records',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		id: text('id').notNull(),
		baseId: text('base_id').notNull(),
		seq: integer('seq').notNull(),
		record: text('record', { mode: 'json' }).notNull().$type<Rec>()
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.id] }),
		index('records_user_seq_idx').on(table.userId, table.seq),
		index('records_user_base_idx').on(table.userId, table.baseId)
	]
);

export const threads = sqliteTable(
	'threads',
	{
		id: text('id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		primaryKey({ columns: [table.id] }),
		index('threads_user_updated_idx').on(table.userId, table.updatedAt)
	]
);

// Append-only and replayed byte for byte: editing a sent row invalidates the thinking blocks after it.
export const threadMessages = sqliteTable(
	'thread_messages',
	{
		threadId: text('thread_id')
			.notNull()
			.references(() => threads.id, { onDelete: 'cascade' }),
		seq: integer('seq').notNull(),
		role: text('role', { enum: ['user', 'assistant', 'event'] }).notNull(),
		content: text('content', { mode: 'json' }).notNull().$type<unknown>(),
		meta: text('meta', { mode: 'json' }).$type<RowMeta>(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [primaryKey({ columns: [table.threadId, table.seq] })]
);

export const threadActions = sqliteTable(
	'thread_actions',
	{
		threadId: text('thread_id')
			.notNull()
			.references(() => threads.id, { onDelete: 'cascade' }),
		id: text('id').notNull(),
		seq: integer('seq').notNull(),
		tier: text('tier').notNull().$type<Tier>(),
		summary: text('summary').notNull(),
		detail: text('detail', { mode: 'json' }).notNull().$type<string[]>(),
		changes: text('changes', { mode: 'json' }).notNull().$type<Change[]>(),
		after: text('after', { mode: 'json' }).notNull().$type<string[]>(),
		status: text('status').notNull().$type<ActionStatus>(),
		reported: integer('reported', { mode: 'boolean' }).notNull().default(false)
	},
	(table) => [primaryKey({ columns: [table.threadId, table.id] })]
);
