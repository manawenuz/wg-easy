CREATE TABLE IF NOT EXISTS `wg_obfuscator_config` (
	`interface_id` text PRIMARY KEY NOT NULL,
	`listen_port` integer NOT NULL,
	`wg_target_port` integer NOT NULL,
	`key` text NOT NULL,
	`dummy_padding_min` integer DEFAULT 8 NOT NULL,
	`dummy_padding_max` integer DEFAULT 64 NOT NULL,
	FOREIGN KEY (`interface_id`) REFERENCES `interfaces_table`(`name`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `router` ADD `ssh_passphrase_encrypted` text;--> statement-breakpoint
ALTER TABLE `router` ADD `tls_fingerprint_sha256` text;--> statement-breakpoint
ALTER TABLE `router` ADD `api_port` integer DEFAULT 8729 NOT NULL;--> statement-breakpoint
ALTER TABLE `router` ADD `tls_required` integer DEFAULT true NOT NULL;