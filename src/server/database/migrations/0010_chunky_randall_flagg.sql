CREATE TABLE `pending_mutation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`interface_id` text NOT NULL,
	`kind` text NOT NULL,
	`client_id` integer,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pending_mutation_iface_next` ON `pending_mutation` (`interface_id`,`next_attempt_at`);