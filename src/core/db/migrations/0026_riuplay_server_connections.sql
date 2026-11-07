CREATE TABLE `server_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`auth_mode` text DEFAULT 'none' NOT NULL,
	`username` text,
	`secret_ciphertext` text,
	`local_approved_at` integer,
	`last_ok_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `server_connections_kind_url_idx` ON `server_connections` (`kind`,`base_url`);