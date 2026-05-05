-- PRD-60-08: Engine health surface
ALTER TABLE router ADD COLUMN last_seen_ok_at INTEGER;
--> statement-breakpoint
ALTER TABLE router ADD COLUMN last_seen_error TEXT;
--> statement-breakpoint
ALTER TABLE router ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
