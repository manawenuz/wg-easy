-- PRD-60-05: Backfill per-client end-users for admin-owned clients
-- For each client whose user_id points to a non-CLIENT role user,
-- create a new CLIENT-role user and reassign the client to it.
-- This migration is idempotent: re-running it is a no-op because
-- after the first run all clients are owned by CLIENT-role users.

-- Step 1: Insert one end-user per client that is currently owned by a non-CLIENT user.
-- CLIENT role = 2 (from shared/utils/permissions.ts)
INSERT INTO users_table (username, password, email, name, role, totp_verified, enabled, created_at, updated_at)
SELECT
  'auto-' || c.id,
  '',
  NULL,
  c.name,
  2,
  0,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM clients_table c
JOIN users_table u ON c.user_id = u.id
WHERE u.role != 2
  AND NOT EXISTS (
    SELECT 1 FROM users_table eu
    WHERE eu.username = 'auto-' || c.id
  );

-- Step 2: Reassign each such client to its newly-created end-user.
UPDATE clients_table
SET user_id = (
  SELECT eu.id FROM users_table eu
  WHERE eu.username = 'auto-' || clients_table.id
)
WHERE EXISTS (
  SELECT 1 FROM users_table u
  WHERE u.id = clients_table.user_id AND u.role != 2
)
AND EXISTS (
  SELECT 1 FROM users_table eu
  WHERE eu.username = 'auto-' || clients_table.id
);
