ALTER TABLE `router` ADD `tls_fingerprint_sha256` text;--> statement-breakpoint
ALTER TABLE `router` ADD `api_port` integer DEFAULT 8729 NOT NULL;--> statement-breakpoint
ALTER TABLE `router` ADD `tls_required` integer DEFAULT true NOT NULL;
