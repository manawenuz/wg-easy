-- Traffic Groups & Sub-accounts
-- Adds traffic/speed groups for shared quota/speed limit management
-- Adds parent-child user relationships for sub-accounts

-- Create traffic_groups table
CREATE TABLE `traffic_groups` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL UNIQUE,
  `color_light` text NOT NULL,
  `color_dark` text NOT NULL,
  `up_kbps` integer,
  `down_kbps` integer,
  `quota_limit_bytes` integer,
  `quota_period` text CHECK(quota_period IN ('daily', 'weekly', 'monthly')),
  `quota_auto_disable` integer DEFAULT 1,
  `is_default` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  `updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
-- Insert default "Unlimited" group
INSERT INTO `traffic_groups` (`name`, `color_light`, `color_dark`, `up_kbps`, `down_kbps`, `quota_limit_bytes`, `quota_period`, `quota_auto_disable`, `is_default`)
VALUES ('Unlimited', 'bg-blue-500', 'bg-blue-400', NULL, NULL, NULL, NULL, 1, 1);
--> statement-breakpoint
-- Add default_traffic_group_id to users_table
ALTER TABLE `users_table` ADD COLUMN `default_traffic_group_id` integer REFERENCES traffic_groups(id) ON DELETE SET NULL;
--> statement-breakpoint
-- Add parent_user_id to users_table for sub-accounts
ALTER TABLE `users_table` ADD COLUMN `parent_user_id` integer REFERENCES users_table(id) ON DELETE CASCADE;
--> statement-breakpoint
-- Add traffic_group_id to clients_table
ALTER TABLE `clients_table` ADD COLUMN `traffic_group_id` integer REFERENCES traffic_groups(id) ON DELETE SET NULL;
