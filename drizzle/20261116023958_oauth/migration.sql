CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`access` text NOT NULL,
	`resource` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	CONSTRAINT `fk_oauth_grants_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauth_refresh_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	CONSTRAINT `fk_oauth_refresh_tokens_grant_id_oauth_grants_id_fk` FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauth_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`client_host` text,
	`redirect_uri` text NOT NULL,
	`loopback_only` integer NOT NULL,
	`state` text,
	`code_challenge` text NOT NULL,
	`resource` text NOT NULL,
	`access` text NOT NULL,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`user_id` text,
	`code_hash` text UNIQUE,
	`used_at` integer,
	`grant_id` text,
	CONSTRAINT `fk_oauth_requests_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `auth_tokens` ADD `grant_id` text REFERENCES oauth_grants(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `auth_tokens` ADD `resource` text;--> statement-breakpoint
CREATE INDEX `auth_tokens_grant_idx` ON `auth_tokens` (`grant_id`);--> statement-breakpoint
CREATE INDEX `oauth_grants_user_idx` ON `oauth_grants` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_grant_idx` ON `oauth_refresh_tokens` (`grant_id`);