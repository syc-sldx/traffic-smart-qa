CREATE TABLE `public_request_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_request_limits_expiry` ON `public_request_limits` (`expires_at`);