-- PRD-60-04: Add embedded DNS resolver columns to user_configs_table
ALTER TABLE user_configs_table ADD COLUMN embedded_dns_enabled INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE user_configs_table ADD COLUMN dns_upstream TEXT NOT NULL DEFAULT '["1.1.1.1","1.0.0.1"]';
