CREATE TABLE `router` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`engine_type` text NOT NULL,
	`transport` text NOT NULL,
	`host` text,
	`port` integer,
	`credentials_encrypted` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_seen` integer,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `router_name_unique` ON `router` (`name`);--> statement-breakpoint
CREATE TABLE `quota` (
	`client_id` integer PRIMARY KEY NOT NULL,
	`limit_bytes` integer NOT NULL,
	`period` text NOT NULL,
	`used_bytes` integer DEFAULT 0 NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`auto_disable` integer DEFAULT true NOT NULL,
	`disabled_by_quota_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `speed_limit` (
	`client_id` integer PRIMARY KEY NOT NULL,
	`up_kbps` integer DEFAULT 0 NOT NULL,
	`down_kbps` integer DEFAULT 0 NOT NULL,
	`applied_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `usage_sample` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`rx_bytes` integer NOT NULL,
	`tx_bytes` integer NOT NULL,
	`ts` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `usage_sample_client_ts` ON `usage_sample` (`client_id`,`ts`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer,
	`action` text NOT NULL,
	`target` text,
	`result` text NOT NULL,
	`ts` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users_table`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `admin_router_acl` (
	`user_id` integer NOT NULL,
	`router_id` integer NOT NULL,
	`permission` text NOT NULL,
	PRIMARY KEY(`user_id`, `router_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users_table`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`router_id`) REFERENCES `router`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exit_node` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`router_id` integer NOT NULL,
	`label` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`router_id`) REFERENCES `router`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `route_policy` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`interface_id` text NOT NULL,
	`client_id` integer,
	`match_cidr` text NOT NULL,
	`exit_node_id` integer NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	FOREIGN KEY (`interface_id`) REFERENCES `interfaces_table`(`name`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients_table`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exit_node_id`) REFERENCES `exit_node`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `api_token` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`label` text,
	`scopes` text,
	`expires_at` integer,
	`last_used_at` integer,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `router` (`id`, `name`, `engine_type`, `transport`, `enabled`) VALUES (0, 'self', 'wireguard', 'local-shell', true);--> statement-breakpoint
ALTER TABLE `interfaces_table` ADD `engine_type` text DEFAULT 'wireguard' NOT NULL;--> statement-breakpoint
ALTER TABLE `interfaces_table` ADD `router_id` integer DEFAULT 0 NOT NULL REFERENCES router(id);