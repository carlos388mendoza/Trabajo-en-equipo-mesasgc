CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_by_user_id` text
);
--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD `anonymized_at` integer;