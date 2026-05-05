-- PRD-10-07: Add deployment_mode and host_endpoint to wg_obfuscator_config
-- so obfuscation can run as a sidecar on the wg-easy host instead of inside
-- a RouterOS container. Defaults to 'router' to preserve existing behavior.

ALTER TABLE wg_obfuscator_config ADD COLUMN deployment_mode TEXT NOT NULL DEFAULT 'router';
--> statement-breakpoint
ALTER TABLE wg_obfuscator_config ADD COLUMN host_endpoint TEXT;
