CREATE TABLE `login_failures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`ip` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_failures_email_idx` ON `login_failures` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_failures_ip_idx` ON `login_failures` (`ip`,`created_at`);--> statement-breakpoint
CREATE TABLE `realtime_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room` text NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `realtime_events_room_idx` ON `realtime_events` (`room`,`id`);--> statement-breakpoint
CREATE INDEX `realtime_events_created_idx` ON `realtime_events` (`created_at`);