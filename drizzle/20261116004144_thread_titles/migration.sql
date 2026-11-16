ALTER TABLE `threads` ADD `named` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `source` text;--> statement-breakpoint
CREATE INDEX `threads_user_source_idx` ON `threads` (`user_id`,`source`);