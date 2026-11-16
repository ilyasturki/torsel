CREATE TABLE `sources` (
	`user_id` text NOT NULL,
	`table_id` text NOT NULL,
	`base_id` text NOT NULL,
	`url` text NOT NULL,
	`auth` text DEFAULT 'none' NOT NULL,
	`auth_name` text,
	`secret` text,
	`hint` text,
	`rows` text,
	`key` text,
	`filter` text,
	`every` text NOT NULL,
	`missing` text NOT NULL,
	`next_at` integer,
	`last_at` integer,
	`last_ok_at` integer,
	`failures` integer DEFAULT 0 NOT NULL,
	`problem` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `sources_pk` PRIMARY KEY(`user_id`, `table_id`),
	CONSTRAINT `fk_sources_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `sources_next_idx` ON `sources` (`next_at`);