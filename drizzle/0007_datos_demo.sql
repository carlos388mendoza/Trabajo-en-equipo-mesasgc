ALTER TABLE `table_layouts` ADD `is_demo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `table_layouts` ADD `demo_batch_id` text;--> statement-breakpoint
CREATE INDEX `table_layouts_demo_idx` ON `table_layouts` (`is_demo`);--> statement-breakpoint
ALTER TABLE `tables` ADD `is_demo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tables` ADD `demo_batch_id` text;--> statement-breakpoint
CREATE INDEX `tables_demo_idx` ON `tables` (`is_demo`);--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD `is_demo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD `demo_batch_id` text;--> statement-breakpoint
CREATE INDEX `waitlist_entries_demo_idx` ON `waitlist_entries` (`is_demo`);