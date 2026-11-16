CREATE TABLE `publications` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`view_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_publications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_user_view_idx` ON `publications` (`user_id`,`view_id`);