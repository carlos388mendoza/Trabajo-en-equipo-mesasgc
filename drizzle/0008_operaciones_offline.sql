CREATE TABLE `offline_operations` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`ok` integer NOT NULL,
	`response` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `offline_operations_created_idx` ON `offline_operations` (`created_at`);