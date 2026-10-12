CREATE TABLE `waitlist_undo` (
	`restaurant_id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`record` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
