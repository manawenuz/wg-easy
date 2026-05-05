---
id: PRD-20-05
title: User Groups & Shared Bandwidth Quotas
status: draft
phase: P3
depends_on:
  - "[[prds/20-user-features/03-bandwidth-quotas]]"
  - "[[prds/60-bugfixes/05-per-user-client-ownership]]"
touches:
  - src/server/database/repositories/userGroup/schema.ts (new)
  - src/server/database/repositories/userGroup/service.ts (new)
  - src/server/database/repositories/user/schema.ts
  - src/server/database/repositories/groupQuota/schema.ts (new)
  - src/server/scheduler/quotaEvaluator.ts
  - src/server/api/dashboard/group/users.get.ts (new)
  - src/server/api/dashboard/group/users.post.ts (new)
  - src/server/api/dashboard/group/users/[id].delete.ts (new)
  - src/app/pages/dashboard/group.vue (new)
  - src/i18n/locales/en.json
---

# PRD-20-05 — User Groups & Shared Bandwidth Quotas

## Why

Currently, bandwidth quotas are applied strictly per-client (device). However, users often want to sell or distribute a single "pooled" data plan to a family or a small team (e.g., 500GB/month shared across 5 people). We need the ability to group users together, share a single data quota across all their clients, and delegate the management of that group to a designated "Group Admin".

This empowers a B2B2C model where platform admins delegate account provisioning to "Group Admins" who manage their own sub-accounts out of a shared resource pool.

## User stories

- As a **system admin**, I can create a User Group, allocate a shared bandwidth quota (e.g., 500GB/month), and create the first user, which automatically becomes the **Group Admin**.
- As a **Group Admin**, I can log into the user dashboard and see a "My Group" section.
- As a **Group Admin**, I can create new sub-accounts (users) and delete them. They automatically join my group and share my quota.
- As a **Group Admin**, I can view the traffic usage of each individual sub-account to see who is consuming the shared bandwidth.
- As a **Sub-account (regular user)**, I log in and only see my own devices and my own usage. I can see the remaining shared group quota, but not other users' details.
- As a **system**, when the aggregated usage of all clients in a group exceeds the group quota, all clients in that group are automatically disabled.

## Scope

### In

- **User Groups**: A new `user_group` table linking multiple users together.
- **Group Admins**: The `user_group` has an `owner_id` pointing to the user who manages it.
- **Group Quotas**: A `group_quota` table (similar to the existing per-client `quota` table) that tracks periodic limits for an entire group.
- **Quota Evaluator Update**: The background scheduler (`quotaEvaluator`) must sum up usage across all clients belonging to users in a group. If the sum > group limit, disable all clients in the group.
- **Dashboard Delegation**: 
  - Group Admins get access to new UI endpoints to CRUD users within their group.
  - Group Admins can see aggregated usage stats for their group members.

### Out

- **Nested Groups**: Groups within groups (sub-sub-accounts) are out of scope. One flat level of delegation only.
- **Per-User Quotas within Groups**: A sub-account cannot have its own hard limit separate from the group limit in this phase (e.g., User A gets max 10GB of the 50GB pool). It's a shared free-for-all pool.
- **Group Speed Limits**: For now, rate limits remain per-client. Group-wide shared queues (e.g., HTB classes for a whole group) are complex to implement with `tc` and are out of scope.

## Data model changes

```ts
// src/server/database/repositories/userGroup/schema.ts
export const userGroup = sqliteTable('user_groups', {
  id: int().primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  ownerId: int('owner_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// Add to src/server/database/repositories/user/schema.ts
groupId: int('group_id').references(() => userGroup.id, { onDelete: 'set null' }),

// src/server/database/repositories/groupQuota/schema.ts
export const groupQuota = sqliteTable('group_quota', {
  groupId: int('group_id').primaryKey().references(() => userGroup.id, { onDelete: 'cascade' }),
  limitBytes: int('limit_bytes', { mode: 'number' }).notNull(),
  period: text('period').$type<'daily' | 'weekly' | 'monthly'>().notNull(),
  usedBytes: int('used_bytes').notNull().default(0),
  periodStart: int('period_start', { mode: 'timestamp' }).notNull(),
  periodEnd: int('period_end', { mode: 'timestamp' }).notNull(),
  autoDisable: int('auto_disable', { mode: 'boolean' }).notNull().default(true),
  disabledByQuotaAt: int('disabled_by_quota_at', { mode: 'timestamp' }),
});
```

## Dashboard API Additions (Role: CLIENT + isGroupAdmin)

| Method | Path | Description |
|---|---|---|
| GET | `/api/dashboard/group` | Returns the group details, total quota usage, and list of sub-accounts with their individual usage. |
| POST | `/api/dashboard/group/users` | Creates a new sub-account in the group. |
| DELETE | `/api/dashboard/group/users/:id` | Deletes a sub-account. |

*Note: The auth middleware must verify that the requesting user is the `owner_id` of their `group_id` before allowing access to these routes.*

## Verification

- **Unit**: The `quotaEvaluator` correctly aggregates bytes from multiple clients across multiple users in the same group and trips the disable flag for all of them when the limit is breached.
- **Integration**: A Group Admin can create a user, but a regular Sub-account receives a 403 Forbidden when trying to access the `/api/dashboard/group` endpoints.

## Resolution log

- **Planned**: PRD created based on feature request for B2B2C bandwidth sharing.
