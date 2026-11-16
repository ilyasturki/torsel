import { blob, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { Change, Rec } from '../../core/model.ts';
import type { ActionStatus, RowMeta } from '../../core/thread.ts';

export const users = sqliteTable(
	'users',
	{
		id: text('id').notNull(),
		email: text('email').notNull().unique(),
		passwordHash: text('password_hash'),
		emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp_ms' }),
		googleSub: text('google_sub').unique(),
		claimNonceHash: text('claim_nonce_hash'),
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
		kind: text('kind', { enum: ['web', 'device', 'api', 'oauth'] }).notNull(),
		// What an api or oauth token may do over MCP: `read` lists and reads, `write` changes data too.
		access: text('access', { enum: ['read', 'write'] })
			.notNull()
			.default('write'),
		tokenHash: text('token_hash').notNull().unique(),
		tokenPrefix: text('token_prefix').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
		// An oauth token's consent and audience: it works only on `resource`, and dies with its grant.
		grantId: text('grant_id').references(() => oauthGrants.id, { onDelete: 'cascade' }),
		resource: text('resource')
	},
	(table) => [
		primaryKey({ columns: [table.id] }),
		index('auth_tokens_user_idx').on(table.userId),
		index('auth_tokens_grant_idx').on(table.grantId)
	]
);

export type AuthToken = typeof authTokens.$inferSelect;

/** Clients that registered themselves (RFC 7591); a client known by its metadata URL has no row. */
export const oauthClients = sqliteTable(
	'oauth_clients',
	{
		id: text('id').notNull(),
		name: text('name').notNull(),
		redirectUris: text('redirect_uris', { mode: 'json' }).notNull().$type<string[]>(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		// Set by its first grant: a client keeps its id after a revoke, so a used registration stays.
		usedAt: integer('used_at', { mode: 'timestamp_ms' })
	},
	(table) => [primaryKey({ columns: [table.id] })]
);

/** One consent: a client's standing access to an account, which its tokens and refresh tokens hang off. */
export const oauthGrants = sqliteTable(
	'oauth_grants',
	{
		id: text('id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		clientId: text('client_id').notNull(),
		clientName: text('client_name').notNull(),
		access: text('access', { enum: ['read', 'write'] }).notNull(),
		resource: text('resource').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' })
	},
	(table) => [primaryKey({ columns: [table.id] }), index('oauth_grants_user_idx').on(table.userId)]
);

export type OAuthGrant = typeof oauthGrants.$inferSelect;

// A used row stays until it expires: presenting it again is the reuse that revokes the grant.
export const oauthRefreshTokens = sqliteTable(
	'oauth_refresh_tokens',
	{
		tokenHash: text('token_hash').notNull(),
		grantId: text('grant_id')
			.notNull()
			.references(() => oauthGrants.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		usedAt: integer('used_at', { mode: 'timestamp_ms' })
	},
	(table) => [
		primaryKey({ columns: [table.tokenHash] }),
		index('oauth_refresh_tokens_grant_idx').on(table.grantId)
	]
);

/** An authorization request from the client's redirect to the consent, then the code it earned. */
export const oauthRequests = sqliteTable(
	'oauth_requests',
	{
		id: text('id').notNull(),
		clientId: text('client_id').notNull(),
		clientName: text('client_name').notNull(),
		clientHost: text('client_host'),
		redirectUri: text('redirect_uri').notNull(),
		loopbackOnly: integer('loopback_only', { mode: 'boolean' }).notNull(),
		state: text('state'),
		codeChallenge: text('code_challenge').notNull(),
		resource: text('resource').notNull(),
		access: text('access', { enum: ['read', 'write'] }).notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
		userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
		codeHash: text('code_hash').unique(),
		usedAt: integer('used_at', { mode: 'timestamp_ms' }),
		grantId: text('grant_id')
	},
	(table) => [primaryKey({ columns: [table.id] })]
);

export type OAuthRequest = typeof oauthRequests.$inferSelect;

export const emailTokens = sqliteTable(
	'email_tokens',
	{
		id: text('id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		purpose: text('purpose', { enum: ['verify', 'login'] }).notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		codeHash: text('code_hash'),
		codeAttempts: integer('code_attempts').notNull().default(0),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		usedAt: integer('used_at', { mode: 'timestamp_ms' })
	},
	(table) => [primaryKey({ columns: [table.id] }), index('email_tokens_user_idx').on(table.userId)]
);

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
		// The person renamed it: no generated title replaces theirs.
		named: integer('named', { mode: 'boolean' }).notNull().default(false),
		// The credential of the connected tool whose changes it holds, null for the assistant's own.
		source: text('source'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		primaryKey({ columns: [table.id] }),
		index('threads_user_updated_idx').on(table.userId, table.updatedAt),
		index('threads_user_source_idx').on(table.userId, table.source)
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
		turn: integer('turn').notNull(),
		summary: text('summary').notNull(),
		changes: text('changes', { mode: 'json' }).notNull().$type<Change[]>(),
		before: text('before', { mode: 'json' }).notNull().$type<Change[]>(),
		status: text('status').notNull().$type<ActionStatus>(),
		reported: integer('reported', { mode: 'boolean' }).notNull().default(false)
	},
	(table) => [primaryKey({ columns: [table.threadId, table.id] })]
);

// Uploaded ahead of the message that carries them, so `thread_id` is set only once it is sent.
export const threadFiles = sqliteTable(
	'thread_files',
	{
		id: text('id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		threadId: text('thread_id').references(() => threads.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		type: text('type').notNull(),
		size: integer('size').notNull(),
		data: blob('data', { mode: 'buffer' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [primaryKey({ columns: [table.id] }), index('thread_files_user_idx').on(table.userId)]
);

export const aiPrompts = sqliteTable(
	'ai_prompts',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		at: integer('at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		index('ai_prompts_user_at_idx').on(table.userId, table.at),
		index('ai_prompts_at_idx').on(table.at)
	]
);

// Kept under the base that holds them; base ids repeat across accounts (`b_home`), so the account keys them too.
export const blobs = sqliteTable(
	'blobs',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		baseId: text('base_id').notNull(),
		id: text('id').notNull(),
		type: text('type').notNull(),
		size: integer('size').notNull(),
		w: integer('w').notNull(),
		h: integer('h').notNull(),
		data: blob('data', { mode: 'buffer' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [primaryKey({ columns: [table.userId, table.baseId, table.id] })]
);

// `size` is what the image will weigh, held against the account's storage from its first part.
export const blobUploads = sqliteTable(
	'blob_uploads',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		baseId: text('base_id').notNull(),
		id: text('id').notNull(),
		size: integer('size').notNull(),
		data: blob('data', { mode: 'buffer' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [primaryKey({ columns: [table.userId, table.baseId, table.id] })]
);

// A table that fills itself from a link; the field each path lands in is the field record's `path`.
export const sources = sqliteTable(
	'sources',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		tableId: text('table_id').notNull(),
		baseId: text('base_id').notNull(),
		// Never holds a key: a query key lives in `secret` and is put back just before sending.
		url: text('url').notNull(),
		auth: text('auth', { enum: ['none', 'header', 'query', 'bearer', 'basic'] })
			.notNull()
			.default('none'),
		authName: text('auth_name'),
		secret: text('secret'),
		hint: text('hint'),
		rows: text('rows'),
		key: text('key'),
		filter: text('filter'),
		every: text('every', { enum: ['manual', 'hour', 'day'] }).notNull(),
		missing: text('missing', { enum: ['remove', 'keep'] }).notNull(),
		nextAt: integer('next_at', { mode: 'timestamp_ms' }),
		lastAt: integer('last_at', { mode: 'timestamp_ms' }),
		lastOkAt: integer('last_ok_at', { mode: 'timestamp_ms' }),
		failures: integer('failures').notNull().default(0),
		problem: text('problem'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.tableId] }),
		index('sources_next_idx').on(table.nextAt)
	]
);

export type Source = typeof sources.$inferSelect;
export const savedPrompts = sqliteTable(
	'saved_prompts',
	{
		id: text('id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		text: text('text').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [primaryKey({ columns: [table.id] }), index('saved_prompts_user_idx').on(table.userId)]
);
