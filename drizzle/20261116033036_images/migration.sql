CREATE TABLE `blob_uploads` (
	`user_id` text NOT NULL,
	`base_id` text NOT NULL,
	`id` text NOT NULL,
	`size` integer NOT NULL,
	`data` blob NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `blob_uploads_pk` PRIMARY KEY(`user_id`, `base_id`, `id`),
	CONSTRAINT `fk_blob_uploads_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `blobs` (
	`user_id` text NOT NULL,
	`base_id` text NOT NULL,
	`id` text NOT NULL,
	`type` text NOT NULL,
	`size` integer NOT NULL,
	`w` integer NOT NULL,
	`h` integer NOT NULL,
	`data` blob NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `blobs_pk` PRIMARY KEY(`user_id`, `base_id`, `id`),
	CONSTRAINT `fk_blobs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
