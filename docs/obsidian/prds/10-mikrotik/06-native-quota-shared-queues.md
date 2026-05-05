---
id: PRD-10-06
title: Native MikroTik quota enforcement with shared parent queues and one-shot grants
status: draft
phase: P1
depends_on:
  - "[[prds/10-mikrotik/03-mikrotik-obfuscation-refactor]]"
  - "[[prds/20-user-features/04-speed-limits]]"
touches:
  - src/server/database/migrations/0010_quota_model_v2.sql (new)
  - src/server/database/repositories/quota/schema.ts
  - src/server/database/repositories/quota/types.ts
  - src/server/database/repositories/quota/service.ts
  - src/server/database/repositories/quotaGroup/schema.ts (new)
  - src/server/database/repositories/quotaGroup/service.ts (new)
  - src/server/engines/mikrotik/quota.ts (new)
  - src/server/engines/mikrotik/index.ts (wire syncQuota / clearQuota into peer ops)
  - src/server/engines/types.ts (add quota hooks to VpnEngine interface)
  - src/server/scheduler/quotaEvaluator.ts (becomes a reconciler, not the enforcer)
  - src/server/scheduler/usagePoller.ts (read MT queue counters as source of truth)
  - src/server/scheduler/periodResetter.ts (handle period-less grants)
  - src/server/api/admin/clients/[id]/quota.put.ts
  - src/server/api/admin/quota-groups/index.get.ts (new)
  - src/server/api/admin/quota-groups/index.post.ts (new)
  - src/server/api/admin/quota-groups/[id]/index.patch.ts (new)
  - src/server/api/admin/quota-groups/[id]/index.delete.ts (new)
  - src/app/pages/admin/quota-groups/index.vue (new)
  - src/app/components/Clients/QuotaForm.vue
  - src/i18n/locales/en.json
---

# PRD-10-06 — Native MikroTik quota with shared queues and one-shot grants

> Today's quota path is "wg-easy polls samples → wg-easy decides over-limit →
> wg-easy disables the peer." Enforcement lives in the control plane, which
> means a wg-easy outage suspends enforcement and a long polling interval
> leaks tens-to-hundreds of MB past the cap. Speed limits are already
> MikroTik-native (queue tree + mangle); quota should be too.
>
> Beyond moving enforcement to the router, real deployments need two things
> that today's model can't express:
> 1. **Shared parent queues** — an MSP sells "1TB family plan" that's split
>    across N sub-accounts. The total cap is enforced in one place, even
>    though each child has its own peer config.
> 2. **One-shot grants** — "50GB to use over 3 months, no monthly reset" is
>    closer to how ISP top-ups, gift cards, and prepaid plans actually work
>    than the current daily/weekly/monthly auto-resetting model.

## Why

- **Reliability:** enforcement survives wg-easy outages. RouterOS keeps
  policing traffic against the queue counters and drops over-limit peers
  whether or not the orchestrator is reachable. wg-easy still polls
  counters periodically while it's up (see "Visuals / display polling")
  to keep the UI fresh — but missing those polls degrades the *display*,
  not the policing.
- **Latency to enforcement:** sub-minute (router-side scheduler firing) vs.
  multi-minute (poll → DB write → eval cron → API mutation) round-trip.
- **Single source of truth in the data path:** queue byte counters on the
  MikroTik are *the* number; wg-easy reads them for display, doesn't compute
  them. Counter-reset detection in `usagePoller.ts` becomes unnecessary.
- **Reseller / MSP scenarios:** parent queues let one billing entity (a
  family, a tenant, an internal department) cap aggregate usage. wg-easy
  expresses the hierarchy; MikroTik enforces it for free via queue parents.
- **Prepaid / one-shot plans:** removes the "monthly auto-reset" assumption
  that doesn't fit the most common consumer use case ("here's 50GB, use it
  whenever").

## User stories

- **As an admin**, I create a quota group "ACME team" with 1 TB. I assign 5
  clients to it. The MikroTik enforces the 1 TB total — when it's hit, all 5
  drop simultaneously.
- **As an admin**, I issue a client a one-shot grant of 50 GB with no
  period. They consume it over weeks; once spent, they drop. Nothing
  auto-replenishes. I can top up by editing the grant.
- **As an admin**, I see a client list with `usedBytes / limitBytes` per
  client (or per group, for shared) sourced live from MikroTik queue
  counters, not from a polled rolling sum in SQLite.
- **As an operator**, I take wg-easy down for an hour. Peers over their
  caps stay dropped. New peers added before the outage continue to be
  enforced. When wg-easy comes back, queue state on the router is the truth
  and wg-easy reconciles.

## Out of scope

- Per-engine quota for non-MikroTik engines. WireGuard kernel and
  AmneziaWG/BoringTun keep the current "polling + disable" path; only the
  MikroTik engine implements the new native path. Engine interface gets
  optional quota hooks so engines that don't implement them fall back.
- Realtime billing / metering integrations. This PRD ships internal
  enforcement only; export of usage events is its own future work.
- Per-application or per-protocol quota carve-outs. We cap aggregate
  bytes per peer/group, not "1GB Netflix, 5GB other".

## Data model

### Existing `quota` table — additive changes

```sql
ALTER TABLE quota ADD COLUMN group_id INTEGER REFERENCES quota_group(id);
ALTER TABLE quota ADD COLUMN grant_type TEXT NOT NULL DEFAULT 'period';
  -- 'period' = current behavior (recurring window)
  -- 'oneshot' = consumes a single grant; no auto-reset
  -- 'group'   = peer is a member of a group; group owns the cap
ALTER TABLE quota ADD COLUMN expires_at INTEGER;
  -- Optional hard expiry; for oneshot grants this is "lose unused balance".
  -- Independent of period rollover.
ALTER TABLE quota ADD COLUMN router_queue_id TEXT;
  -- Internal: the .id of the /queue/simple entry on the active router.
```

### New `quota_group` table

```sql
CREATE TABLE quota_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  limit_bytes INTEGER NOT NULL,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  grant_type TEXT NOT NULL DEFAULT 'oneshot',  -- same vocabulary as quota.grant_type
  period TEXT,                                 -- nullable; only set for grant_type='period'
  period_start INTEGER,
  period_end INTEGER,
  expires_at INTEGER,
  router_queue_id TEXT,                        -- /queue/simple parent on active MT
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  updated_at INTEGER DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
```

A peer with a `group_id` ignores its own `limit_bytes`; the group's cap is
authoritative. Peer-level `used_bytes` is still tracked for visibility but
doesn't drive enforcement.

## RouterOS side

Wg-easy installs and maintains, per peer with a quota:

```
# Parent queue (only when peer is in a quota_group; one per group)
/queue/simple/add name=wg-quota-grp-<groupId> target=<member-ip-1>,<member-ip-2>,... \
  max-limit=10G/10G total-max-limit=<groupLimitBytes> comment="wg-quota:group:<groupId>"

# Per-peer queue (every peer with quota; child of the group queue if any)
/queue/simple/add name=wg-quota-<peerId> target=<peer-ip>/32 \
  parent=<wg-quota-grp-X | none> \
  total-max-limit=<peerLimitBytes | inherits-from-parent> \
  comment="wg-quota:peer:<peerId>"
```

`total-max-limit` on `/queue/simple` is the **byte cap**: when traffic
through the queue exceeds it, RouterOS stops passing further bytes through
that queue. Combined with a default-deny `forward` rule for those source
IPs, the peer is effectively disabled at the router.

A scheduler script — installed once per router by wg-easy on bootstrap and
named `wg-quota-watch` — runs every 30s and:

```
:foreach q in=[/queue/simple/find where comment~"wg-quota:peer:"] do={
  :local name [/queue/simple/get $q name]
  :local bytes [/queue/simple/get $q bytes]
  :local limit [/queue/simple/get $q total-max-limit]
  # Parse 'bytes' (format "rx/tx") into a single number, compare to limit,
  # toggle a `disabled=yes` on the peer entry when over.
}
```

The script is part of the bootstrap `.rsc` (see PRD-10-06 sibling work in
the bootstrap helper). wg-easy never edits the script after install.

## API

### Quota groups

| Method | Path                              | Body / Notes                             |
|--------|-----------------------------------|------------------------------------------|
| GET    | `/api/admin/quota-groups`         | List with member counts and used/limit   |
| POST   | `/api/admin/quota-groups`         | `{ name, limitBytes, grantType, period?, expiresAt? }` |
| PATCH  | `/api/admin/quota-groups/:id`     | Update limit/period/expiry; idempotent   |
| DELETE | `/api/admin/quota-groups/:id`     | 409 if members exist; `?force=true` detaches them first |

### Per-client quota

`PUT /api/admin/clients/:id/quota` body gains:

```ts
{
  // Choose one mode:
  groupId?: number;                      // join a quota group
  limitBytes?: number;                   // standalone peer quota
  grantType: 'period' | 'oneshot';
  // Period-mode fields (existing; ignored when grantType='oneshot'):
  period?: 'daily' | 'weekly' | 'monthly';
  // Optional hard expiry for either mode:
  expiresAt?: number;
}
```

Server validates: groupId XOR limitBytes; grantType='period' requires
`period`; grantType='oneshot' rejects `period`.

### Engine interface (additive)

```ts
// src/server/engines/types.ts
interface VpnEngine {
  // ... existing methods ...
  syncQuota?(iface: InterfaceType, peer: Client, quota: QuotaResolved): Promise<void>;
  clearQuota?(iface: InterfaceType, peer: Client): Promise<void>;
  syncQuotaGroup?(iface: InterfaceType, group: QuotaGroupType, members: Client[]): Promise<void>;
  clearQuotaGroup?(iface: InterfaceType, groupId: ID): Promise<void>;
  readQuotaUsage?(iface: InterfaceType): Promise<QuotaUsageSample[]>;
}
```

Engines without these hooks fall back to the existing
"poll counters + decide in wg-easy" path. Only the MikroTik engine
implements them in v1 of this PRD.

## Scheduler changes

### `quotaEvaluator.ts`

Becomes a **reconciler**, not the primary enforcer. Once per cron tick:

1. For each engine that supports `readQuotaUsage`, pull current usage from
   the router's queue counters.
2. Update `quota.used_bytes` and `quota_group.used_bytes` purely for
   display — *not* to gate enforcement.
3. Compare to `quota.expires_at` / `quota_group.expires_at`; for expired
   grants, call `engine.clearQuota` to remove the queue (returning the peer
   to unmetered) and audit.
4. If a peer has `grant_type='period'` and the period rolled over, clear
   used_bytes on both wg-easy and on the router-side queue (set
   `total-max-limit` again to reset accumulated bytes — RouterOS resets the
   queue's byte counter when `total-max-limit` is rewritten).

### `usagePoller.ts`

Switches to calling `engine.readQuotaUsage` when available. The
counter-reset handling (`if (rxDelta < 0) ...`) is no longer needed for
MikroTik because RouterOS exposes monotonic queue byte counters that we
read directly, not deltas we compose.

## Visuals / display polling

Enforcement does not require wg-easy to be reachable, but **dashboards still
do**. wg-easy must continue polling the router on a schedule to keep the UI
honest. Two independent data sources, each polled separately:

| Source                                            | What it gives                          | UI use                              | Default cadence |
|---------------------------------------------------|----------------------------------------|-------------------------------------|-----------------|
| `/queue/simple/print where comment~"wg-quota:"`   | Bytes consumed against each quota cap  | "Used / Remaining" bars, group totals | 60s (configurable via `QUOTA_DISPLAY_POLL_SEC`) |
| `/interface/wireguard/peers/print` rx/tx          | All-time per-peer rx/tx counters       | Bandwidth graphs, last-handshake, online state | 15s (already exists for live status) |

Polling is best-effort: a missed poll degrades freshness but never
enforcement. If the router is unreachable, the UI shows the last-known
values with a stale-data indicator instead of zeroing or hiding them.

**Implementation notes:**

- `engine.readQuotaUsage` returns `{ peerId | groupId, bytesUsed, limitBytes, source: 'queue' }`. wg-easy persists snapshots to a small ring buffer (or `usage_sample` table reused) so the UI can render rate graphs without re-polling on every page load.
- `engine.sampleUsage` (the existing per-peer rx/tx hook used by graphs)
  remains unchanged. Queue-counter polling and peer-counter polling are
  orthogonal — they answer different questions.
- The poll interval is per-router. Operators with hundreds of peers on a
  CHR can stretch it to 5 min for cost; lab setups can drop it to 10s.
  RouterOS handles `/queue/simple/print` cheaply (it's a tracked struct,
  not a packet-walk).
- Webhooks / push from MikroTik would be ideal for "near-real-time
  remaining bytes," but RouterOS has no native outbound notifier for queue
  counters. Polling stays the design.

### `periodResetter.ts`

Skips `grantType='oneshot'` and group-managed peers. For oneshot, the
balance only changes via admin action (top-up via PATCH) or expiry.

## UI

### Admin → Quota Groups (new)

Table: name, limit, used (live from router), members, period or grant
type, expiry. Buttons: Create, Edit, Delete (with detach-or-cancel
warning), Add member.

### Client edit → Quota section

Three radio modes:
- **None** (default)
- **Standalone** — `limitBytes`, optional `period`, optional `expiresAt`
- **Group** — pick from `/api/admin/quota-groups` dropdown

Live used/remaining bytes shown when MikroTik engine is active.

## Sequence: peer added to a group

```mermaid
sequenceDiagram
  Admin ->> UI: Add client; quota mode=Group; group=ACME
  UI ->> Server: POST /admin/clients
  Server ->> Server: insert client; insert quota{groupId=ACME}
  Server ->> Engine: syncInterface(peers)
  Engine ->> MT: /interface/wireguard/peers/add ...
  Server ->> Engine: syncQuotaGroup(group, members)
  Engine ->> MT: /queue/simple/set [find name=wg-quota-grp-ACME] target=<member-ips>
  Engine ->> MT: /queue/simple/add name=wg-quota-<peerId> parent=wg-quota-grp-ACME ...
  Server -->> UI: 200 ok
```

## Acceptance tests

1. **Standalone oneshot** — create client + 1GB oneshot quota. Generate
   ~1.1GB of traffic via the peer. RouterOS queue blocks further bytes
   before wg-easy's poll loop fires. Peer is dropped on the router.
2. **Standalone period** — create client + 5GB monthly. After period rolls
   over (mock the date), `quota.used_bytes` returns to 0 *and* the
   MikroTik queue counter resets. New traffic flows.
3. **Group cap** — create 3-member quota group of 1GB total. Use 999MB on
   member A. Member B can still send 1MB; subsequent traffic from any
   member is blocked. Removing member A's traffic doesn't reset the
   group counter.
4. **Topup** — issue a 1GB oneshot, exhaust it (peer drops). PATCH
   `limitBytes=2GB` (effectively a topup). Peer comes back online without
   wg-easy needing to flip enabled.
5. **Outage resilience** — set 100MB cap. Stop wg-easy. Run traffic past
   cap. Peer still drops on schedule (router-side scheduler does the work).
   Restart wg-easy; usage figures reconcile from queue counters.
6. **Group → standalone migration** — switch a client from group to
   standalone with a fresh 5GB cap. The peer-side queue is rebuilt with no
   parent; group usage updates to exclude this member's bytes.
7. **Engine fallback** — same operations against the WireGuard self-engine
   continue to work via the legacy poll-and-disable path; the new schema
   columns are populated but enforcement still happens in
   `quotaEvaluator.ts` for non-MikroTik engines.

## Migration plan

- `0010_quota_model_v2.sql` adds the new columns and table; existing
  `period`-based quotas migrate trivially (`grant_type='period'` is the
  default).
- On first run after upgrade, for each existing quota with an active
  MikroTik interface, the engine creates the corresponding `/queue/simple`
  and starts native enforcement. wg-easy keeps the legacy fallback path
  enabled for at least one release in case the queue install fails.

## Risks & follow-ups

- **`total-max-limit` semantics across RouterOS versions.** v6 vs v7 may
  behave differently on counter reset. Need a CI matrix or at minimum
  manual verification on 7.18 / 7.20 / 7.22.
- **Scheduler script footprint.** One scheduler entry per router (not per
  peer) keeps it small; per-peer enforcement is implicit because the script
  iterates all `wg-quota:*` queues.
- **Group target list churn.** As members join/leave a group, we rewrite
  the parent queue's `target=` list. RouterOS tolerates this; we should
  still rate-limit "membership thrash" if a UI bug causes loops.
- **Counter accuracy for display.** `bytes` on `/queue/simple` is
  authoritative for *enforcement* but only updated when packets pass
  through; for clients with idle days, the displayed remaining bytes will
  be slightly stale until the next packet. Acceptable.
- **Future: per-day rate caps** ("up to 5 GB/day, 100 GB/month") would
  require nested groups (a daily child under a monthly parent). Out of
  scope here; the data model can express it (groups can have parents) once
  the UI catches up.
