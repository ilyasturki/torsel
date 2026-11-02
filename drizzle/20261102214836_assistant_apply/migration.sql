-- Threads made under propose/confirm don't replay under apply-at-once: they go, rather than migrate.
DELETE FROM `thread_messages`;--> statement-breakpoint
DELETE FROM `threads`;--> statement-breakpoint
DROP TABLE `thread_actions`;--> statement-breakpoint
CREATE TABLE `thread_actions` (
	`thread_id` text NOT NULL,
	`id` text NOT NULL,
	`seq` integer NOT NULL,
	`turn` integer NOT NULL,
	`summary` text NOT NULL,
	`changes` text NOT NULL,
	`before` text NOT NULL,
	`status` text NOT NULL,
	`reported` integer DEFAULT false NOT NULL,
	CONSTRAINT `thread_actions_pk` PRIMARY KEY(`thread_id`, `id`),
	CONSTRAINT `fk_thread_actions_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_files` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`size` integer NOT NULL,
	`data` blob NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_thread_files_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_thread_files_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `thread_files_user_idx` ON `thread_files` (`user_id`);
