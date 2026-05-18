-- Migration: PRD-60-14 — Shared quota pool across parent + sub-accounts
-- Delete any user_quota rows belonging to sub-accounts.
-- Quota is now family-scoped: only root users (parent_user_id IS NULL)
-- may have a user_quota row.
DELETE FROM user_quota
WHERE user_id IN (
  SELECT id FROM users_table WHERE parent_user_id IS NOT NULL
);
