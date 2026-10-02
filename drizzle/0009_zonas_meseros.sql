CREATE TABLE `waiter_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`waiter_count` integer NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`save_token` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`demo_batch_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `waiter_configs_restaurant_idx` ON `waiter_configs` (`restaurant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `waiter_configs_one_active_idx` ON `waiter_configs` (`restaurant_id`) WHERE "waiter_configs"."is_active" = 1;--> statement-breakpoint
CREATE TABLE `waiter_zone_tables` (
	`config_id` text NOT NULL,
	`table_id` text NOT NULL,
	`zone_id` text NOT NULL,
	PRIMARY KEY(`config_id`, `table_id`),
	FOREIGN KEY (`config_id`) REFERENCES `waiter_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `waiter_zones`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `waiter_zone_tables_zone_idx` ON `waiter_zone_tables` (`zone_id`);--> statement-breakpoint
CREATE TABLE `waiter_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text NOT NULL,
	`position` integer NOT NULL,
	`waiter_name` text NOT NULL,
	`color` text NOT NULL,
	FOREIGN KEY (`config_id`) REFERENCES `waiter_configs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `waiter_zones_config_idx` ON `waiter_zones` (`config_id`);--> statement-breakpoint
ALTER TABLE `waitlist_entries` ADD `waiter_name` text;