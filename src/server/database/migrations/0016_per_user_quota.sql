CREATE TABLE user_quota (
  user_id INTEGER PRIMARY KEY REFERENCES users_table(id) ON DELETE CASCADE,
  limit_bytes INTEGER NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily','weekly','monthly')),
  used_bytes INTEGER NOT NULL DEFAULT 0,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  auto_disable INTEGER NOT NULL DEFAULT 1,
  disabled_by_quota_at INTEGER
);
--> statement-breakpoint
INSERT INTO user_quota (user_id, limit_bytes, period, used_bytes, period_start, period_end, auto_disable, disabled_by_quota_at)
SELECT
  c.user_id,
  MAX(q.limit_bytes)         AS limit_bytes,
  MIN(q.period)              AS period,
  SUM(q.used_bytes)          AS used_bytes,
  MIN(q.period_start)        AS period_start,
  MIN(q.period_end)          AS period_end,
  MAX(q.auto_disable)        AS auto_disable,
  MIN(q.disabled_by_quota_at) AS disabled_by_quota_at
FROM quota q
JOIN clients_table c ON c.id = q.client_id
WHERE c.user_id IS NOT NULL
GROUP BY c.user_id;
--> statement-breakpoint
DROP TABLE quota;
