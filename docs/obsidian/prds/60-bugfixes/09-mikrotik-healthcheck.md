---
id: PRD-60-09
title: Engine-aware Docker healthcheck
status: draft
phase: P1
priority: low
severity: cosmetic
depends_on: []
touches:
  - Dockerfile
  - src/server/utils/healthcheck.ts (new)
  - src/cli.ts
---

# PRD-60-09 — Engine-aware Docker healthcheck

> Status: `draft` · Phase: `P1` · Severity: cosmetic

## Why

Upstream Dockerfile sets `HEALTHCHECK CMD wg show | grep -q interface`. With a MikroTik-engine deployment there is no kernel-level WireGuard interface inside the container, so the check always fails and Docker reports the container `unhealthy` indefinitely — even though the app is fine. Confirmed live: `tgmanwehs:wg-easy` shows `unhealthy` while serving traffic correctly. Cosmetic but actively misleading: monitoring tooling that watches Docker health states will fire false alerts.

## Scope

### In

- Replace the `HEALTHCHECK` shell with a CLI subcommand `wg-easy-cli healthcheck` (Node-based) that decides the health rule based on `interfaces_table.engine_type`:
  - `wireguard` / `amneziawg` / `boringtun` (kernel-or-userspace local engines): preserve current behavior — `wg show` must list the interface.
  - `mikrotik` (and any future remote engine): success requires the HTTP server responding on the configured port AND the most recent `usage_sample` for the active interface being newer than 5 minutes (or `consecutive_failures < 3` once [[prds/60-bugfixes/08-engine-health-surface]] lands).
- Update Dockerfile `HEALTHCHECK` to invoke the CLI subcommand.

### Out

- A separate `/health` HTTP endpoint for k8s readiness probes — could be a follow-up; this PRD is scoped to the in-container Docker healthcheck.

## Data model changes

None.

## API changes

None.

## CLI changes

- New `src/cli.ts` subcommand `healthcheck`. Exits 0 on healthy, non-zero on unhealthy.
- Reads DB directly (same path as the running app) to determine engine type.

## Migration & rollout

- Just a Dockerfile change + new CLI command. No schema impact.

## Verification

**Unit tests:**
- `healthcheck.ts` with mocked DB: returns 0 for `wireguard` when `wg show` lists interface, non-zero otherwise; returns 0 for `mikrotik` when last sample fresh, non-zero otherwise.

**Manual test plan:**
1. Rebuild image with new HEALTHCHECK.
2. Deploy on `tgmanwehs` (MikroTik engine) — `docker ps` should show `(healthy)`.
3. Switch interface to `wireguard` engine — same image still reports healthy via the kernel check.

## Open questions

- [ ] Sample-freshness window: 5 min suggested; could be tied to the poller interval × N.

---

## Kimi handoff

**Read before implementing:**
- `Dockerfile` (full, especially HEALTHCHECK directive).
- `src/cli.ts` (full)
- `src/server/database/repositories/interface/service.ts`
- `src/server/scheduler/usagePoller.ts` — for the sample-freshness query pattern.

**Modify these files:** see `touches:`.

**Acceptance tests:**
1. `docker ps` shows `(healthy)` after a 90-second wait on a MikroTik-engine deployment.
2. Stopping the router (or simulating engine offline for 6+ min) flips the container to `(unhealthy)`.

**Self-test plan:**
```bash
cd src && pnpm vitest run server/utils/healthcheck
# Image-level:
docker build -t wg-easy-fork:hc-test .
docker run --rm -d --name hctest ... wg-easy-fork:hc-test
sleep 90 && docker inspect --format '{{.State.Health.Status}}' hctest
```
