CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`token_prefix` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	CONSTRAINT `fk_auth_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `records` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`base_id` text NOT NULL,
	`seq` integer NOT NULL,
	`record` text NOT NULL,
	CONSTRAINT `records_pk` PRIMARY KEY(`user_id`, `id`),
	CONSTRAINT `fk_records_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sync_counters` (
	`user_id` text PRIMARY KEY NOT NULL,
	`next_seq` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_sync_counters_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL UNIQUE,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_tokens_user_idx` ON `auth_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `records_user_seq_idx` ON `records` (`user_id`,`seq`);--> statement-breakpoint
CREATE INDEX `records_user_base_idx` ON `records` (`user_id`,`base_id`);