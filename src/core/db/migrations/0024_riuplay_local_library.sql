CREATE TABLE `local_library` (
	`media_id` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `local_media`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "local_library_status_check" CHECK("local_library"."status" in ('active', 'planned', 'completed', 'on_hold', 'dropped'))
);
--> statement-breakpoint
CREATE INDEX `local_library_status_idx` ON `local_library` (`status`);--> statement-breakpoint
CREATE TABLE `local_progress` (
	`unit_id` integer PRIMARY KEY NOT NULL,
	`media_id` integer NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`duration` real DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `local_media_units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `local_media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `local_progress_media_idx` ON `local_progress` (`media_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `local_progress_updated_idx` ON `local_progress` (`updated_at`);