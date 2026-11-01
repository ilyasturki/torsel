CREATE TABLE `ai_prompts` (
	`user_id` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `fk_ai_prompts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `ai_prompts_user_at_idx` ON `ai_prompts` (`user_id`,`at`);--> statement-breakpoint
CREATE INDEX `ai_prompts_at_idx` ON `ai_prompts` (`at`);