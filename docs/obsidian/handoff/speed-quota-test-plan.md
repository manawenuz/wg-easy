# PRD: Speed & Bandwidth Limitation Verification Plan

## 1. Objective
Empirically verify that the `wg-easy-fork` correctly enforces network speed limits (via Linux TC/HTB) and bandwidth quotas (via background usage polling and auto-disabling).

## 2. Infrastructure Requirements
- **Host Machine:** Linux (required for `tc` and `ifb` modules).
- **Kernel Modules:** `ifb`, `sch_htb`, `act_mirred`.
- **Containers:**
  - `wg-easy`: Management UI and WireGuard server.
  - `wg-client`: A secondary container to simulate a VPN user.

## 3. Setup Instructions

### 3.1 Host Preparation
Ensure the Intermediate Functional Block (ifb) module is loaded:
```bash
sudo modprobe ifb
```

### 3.2 Docker Compose Update
Add the following service to `docker-compose.dev.yml`:

```yaml
  wg-client:
    image: linuxserver/wireguard:latest
    container_name: wg-client
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    volumes:
      - ./data/client-config:/config
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Etc/UTC
    depends_on:
      - wg-easy
```

## 4. Verification Scenarios

### Scenario 1: Speed Limit Enforcement (TC/HTB)
**Goal:** Prove that setting a limit in the UI correctly translates to `tc` commands and throttles traffic.

1.  **Configure:** In the UI, set Client A to `1000 Kbps` Download and `500 Kbps` Upload.
2.  **Verify Backend:** Execute `docker exec wg-easy tc class show dev wg0` and `docker exec wg-easy tc class show dev ifb-wg0`.
3.  **Test Download:** Inside `wg-client`, run:
    ```bash
    curl -o /dev/null http://speedtest.tele2.net/10MB.zip
    ```
    *Expectation:* Speed should be capped at ~125 KB/s.
4.  **Test Upload:**
    ```bash
    # Requires a target server or using iperf3
    # Simpler check: monitor 'wg show' transfer stats during a POST request
    ```

### Scenario 2: Bandwidth Quota & Auto-Disable
**Goal:** Prove the scheduler correctly polls usage and disables peers when they exceed their cap.

1.  **Configure:** In the UI, set Client A to a `10 MB` daily quota. Ensure "Auto-Disable" is checked.
2.  **Generate Traffic:** In `wg-client`, download a 15MB file:
    ```bash
    curl -o /dev/null http://speedtest.tele2.net/100MB.zip
    ```
    (Stop after ~20MB).
3.  **Wait:** Allow up to 60 seconds for the `UsagePoller` and `QuotaEvaluator` to tick.
4.  **Observe:**
    - UI should show the client as "Disabled".
    - `docker logs wg-easy` should show: `[Scheduler] Quota exceeded for client ...`.
    - `docker exec wg-easy wg show` should NO LONGER list the peer's allowed IPs or the peer itself if completely removed.

## 5. Unit Test Coverage

The following unit tests were added and verified:

| Test File | Coverage |
|---|---|
| `src/server/scheduler/usagePoller.test.ts` | Counter reset detection, delta computation, quota increment, zero-delta skip |
| `src/server/scheduler/quotaEvaluator.test.ts` | Disable on exceed, skip already-disabled, error logging |
| `src/server/scheduler/periodResetter.test.ts` | Period rollover, re-enable logic, manual-disable protection |
| `src/server/scheduler/usageRollup.test.ts` | 7-day sample cleanup |
| `src/server/engines/wireguard/speedlimit.test.ts` | TC command generation for apply/clear/teardown |
| `src/server/services/speedLimitService.test.ts` | Capability check, set/clear, zero-value deletion |
| `src/server/services/quotaService.test.ts` | CRUD, period date calculations (daily/weekly/monthly) |

**Run:** `pnpm vitest run src/server/scheduler src/server/services`

## 6. E2E Test Results

Automated E2E test: `src/test/e2e-phase1-wireguard.cjs`

| Scenario | Result | Notes |
|---|---|---|
| Client creation | ✅ Pass | Config generated correctly |
| Speed limit — download | ✅ Pass | `tc class` created with correct rate |
| Speed limit — upload | ⚠️ Partial | Fails on macOS Docker (missing `ifb` module). **Works on Linux with `modprobe ifb`** |
| Speed limit — clear | ✅ Pass | `tc` class removed cleanly |
| Quota — set | ✅ Pass | DB record created correctly |
| Quota — auto-disable | ✅ Pass | Client disabled after usage exceeds limit |
| Audit log | ✅ Pass | `quota.exceeded` event recorded |

## 7. Success Criteria
- [x] `tc` classes are created/removed dynamically when limits are changed in the UI.
- [x] Network throughput matches the UI-defined speed limits within a 10% margin. *(Verified on Linux VM)*
- [x] Client is automatically disabled in the database AND the WireGuard engine immediately after the 60s poll confirms quota breach.
- [x] Audit logs correctly record the `quota.exceeded` event.
