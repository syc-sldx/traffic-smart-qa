CREATE TABLE `annual_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`city` text NOT NULL,
	`year` integer NOT NULL,
	`category` text NOT NULL,
	`metric` text NOT NULL,
	`metric_code` text NOT NULL,
	`original_metric` text NOT NULL,
	`period` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`normalized_value` real NOT NULL,
	`normalized_unit` text NOT NULL,
	`yoy` real,
	`geo_scope` text NOT NULL,
	`mode_scope` text NOT NULL,
	`verification_status` text NOT NULL,
	`notes` text NOT NULL,
	`cleaning_note` text NOT NULL,
	`source_ref` text NOT NULL,
	`source_title` text NOT NULL,
	`source_url` text NOT NULL,
	`source_type` text NOT NULL,
	`published_at` text,
	`source_file` text NOT NULL,
	`source_sheet` text NOT NULL,
	`source_row` integer NOT NULL,
	`dataset_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `annual_missing` (
	`id` text PRIMARY KEY NOT NULL,
	`city` text NOT NULL,
	`year` integer NOT NULL,
	`category` text NOT NULL,
	`metric` text NOT NULL,
	`status` text NOT NULL,
	`notes` text NOT NULL,
	`source_file` text NOT NULL,
	`source_sheet` text NOT NULL,
	`source_row` integer NOT NULL,
	`dataset_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `annual_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`source_ref` text NOT NULL,
	`region` text NOT NULL,
	`title` text NOT NULL,
	`published_at` text,
	`source_type` text NOT NULL,
	`notes` text NOT NULL,
	`url` text NOT NULL,
	`source_file` text NOT NULL,
	`source_sheet` text NOT NULL,
	`source_row` integer NOT NULL,
	`dataset_id` text NOT NULL
);
