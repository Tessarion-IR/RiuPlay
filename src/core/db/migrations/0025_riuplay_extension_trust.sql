CREATE TABLE `extension_state` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`granted_permissions` text,
	`granted_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repository_state` (
	`url` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trust` text DEFAULT 'untrusted' NOT NULL,
	`trusted_at` integer,
	`name` text,
	`last_checked_at` integer,
	`last_error` text,
	`updated_at` integer NOT NULL
);
