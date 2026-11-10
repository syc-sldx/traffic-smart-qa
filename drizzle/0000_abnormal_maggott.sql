CREATE TABLE `congestion` (
	`id` integer PRIMARY KEY NOT NULL,
	`city` text NOT NULL,
	`city_code` text,
	`ts` text NOT NULL,
	`health_index` real,
	`congestion_delay_index` real,
	`avg_speed_kmh` real,
	`city_rank` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `congestion_scope` ON `congestion` (`city`,`ts`);--> statement-breakpoint
CREATE TABLE `flow` (
	`id` integer PRIMARY KEY NOT NULL,
	`city` text NOT NULL,
	`stat_date` text NOT NULL,
	`ridership` real NOT NULL,
	`unit` text,
	`source` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flow_scope` ON `flow` (`city`,`stat_date`,`source`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`html` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `seed_state` (
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weather` (
	`id` integer PRIMARY KEY NOT NULL,
	`city` text NOT NULL,
	`stat_date` text NOT NULL,
	`weather_type` text,
	`temp_high` real,
	`temp_low` real,
	`precipitation_mm` real,
	`wind_level` integer,
	`is_extreme` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weather_scope` ON `weather` (`city`,`stat_date`);