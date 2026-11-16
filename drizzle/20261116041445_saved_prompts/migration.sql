CREATE TABLE `saved_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_saved_prompts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `saved_prompts_user_idx` ON `saved_prompts` (`user_id`);