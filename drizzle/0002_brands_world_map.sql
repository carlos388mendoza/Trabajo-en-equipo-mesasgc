CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`accent_color` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_name_unique` ON `brands` (`name`);--> statement-breakpoint
ALTER TABLE `restaurants` ADD `brand_id` text REFERENCES brands(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `restaurants` ADD `city` text;--> statement-breakpoint
ALTER TABLE `restaurants` ADD `map_x` integer;--> statement-breakpoint
ALTER TABLE `restaurants` ADD `map_y` integer;--> statement-breakpoint
CREATE INDEX `restaurants_brand_idx` ON `restaurants` (`brand_id`);