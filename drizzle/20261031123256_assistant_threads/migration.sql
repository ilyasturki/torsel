CREATE TABLE `thread_actions` (
	`thread_id` text NOT NULL,
	`id` text NOT NULL,
	`seq` integer NOT NULL,
	`tier` text NOT NULL,
	`summary` text NOT NULL,
	`detail` text NOT NULL,
	`changes` text NOT NULL,
	`after` text NOT NULL,
	`status` text NOT NULL,
	`reported` integer DEFAULT false NOT NULL,
	CONSTRAINT `thread_actions_pk` PRIMARY KEY(`thread_id`, `id`),
	CONSTRAINT `fk_thread_actions_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_messages` (
	`thread_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`meta` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `thread_messages_pk` PRIMARY KEY(`thread_id`, `seq`),
	CONSTRAINT `fk_thread_messages_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_threads_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `threads_user_updated_idx` ON `threads` (`user_id`,`updated_at`);