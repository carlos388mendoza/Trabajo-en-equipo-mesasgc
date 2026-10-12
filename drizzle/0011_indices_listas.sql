CREATE INDEX `waitlist_entries_rest_status_arrived_idx` ON `waitlist_entries` (`restaurant_id`,`status`,`arrived_at`);--> statement-breakpoint
CREATE INDEX `waitlist_entries_rest_arrived_idx` ON `waitlist_entries` (`restaurant_id`,`arrived_at`);--> statement-breakpoint
CREATE INDEX `waitlist_entries_status_seated_idx` ON `waitlist_entries` (`status`,`seated_at`);--> statement-breakpoint
CREATE INDEX `waitlist_entries_called_idx` ON `waitlist_entries` (`called_at`);