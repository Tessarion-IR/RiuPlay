CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collection_items` (
	`collection_id` integer NOT NULL,
	`source_id` text NOT NULL,
	`title_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `source_id`, `title_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_items_title_idx` ON `collection_items` (`source_id`,`title_id`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `local_media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_type` text NOT NULL,
	`title` text NOT NULL,
	`alt_titles_json` text DEFAULT '[]' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cover` text DEFAULT '' NOT NULL,
	`genres_json` text DEFAULT '[]' NOT NULL,
	`release_info` text DEFAULT '' NOT NULL,
	`origin` text NOT NULL,
	`origin_ref` text NOT NULL,
	`extra_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "local_media_content_type_check" CHECK("local_media"."content_type" in ('video', 'manga', 'audio'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_media_origin_idx` ON `local_media` (`origin`,`origin_ref`);--> statement-breakpoint
CREATE INDEX `local_media_type_idx` ON `local_media` (`content_type`);--> statement-breakpoint
CREATE TABLE `local_media_units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`kind` text NOT NULL,
	`number` real NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`subtitle_url` text,
	`pages_json` text DEFAULT '[]' NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `local_media`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "local_media_units_kind_check" CHECK("local_media_units"."kind" in ('episode', 'chapter', 'track'))
);
--> statement-breakpoint
CREATE INDEX `local_media_units_media_idx` ON `local_media_units` (`media_id`,`number`);