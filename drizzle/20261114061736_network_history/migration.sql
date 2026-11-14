CREATE TABLE `network_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `network_history_observed_at_idx` ON `network_history` (`observed_at`,`id`);--> statement-breakpoint
CREATE INDEX `network_history_entity_idx` ON `network_history` (`kind`,`entity_id`,`observed_at`,`id`);