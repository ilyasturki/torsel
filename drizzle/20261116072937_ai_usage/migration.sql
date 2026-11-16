CREATE TABLE `ai_usage` (
	`user_id` text NOT NULL,
	`at` integer NOT NULL,
	`cost` integer NOT NULL,
	CONSTRAINT `fk_ai_usage_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
DROP INDEX IF EXISTS `ai_prompts_user_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `ai_prompts_at_idx`;--> statement-breakpoint
CREATE INDEX `ai_usage_user_at_idx` ON `ai_usage` (`user_id`,`at`);--> statement-breakpoint
CREATE INDEX `ai_usage_at_idx` ON `ai_usage` (`at`);--> statement-breakpoint
DROP TABLE `ai_prompts`;