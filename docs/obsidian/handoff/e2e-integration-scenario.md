# PRD: Comprehensive E2E Integration Scenario

## 1. Objective
Establish a reliable, repeatable end-to-end (E2E) testing scenario for `wg-easy-fork` to empirically verify speed limits, bandwidth quotas, and Role-Based Access Control (RBAC) against a live VPN engine.

## 2. Methodology: The "Ping-Pong" Approach
We will execute this scenario interactively:
1.  **Agent (Me):** Brings up the core `wg-easy` server and provides administrative credentials.
2.  **User (You):** Logs into the UI, creates a WireGuard client, configures limits, and hands the generated `.conf` back to me.
3.  **Agent (Me):** Deploys a dedicated `wg-client` container using the provided config and attaches it to the VPN.
4.  **User (You):** Runs traffic tests (e.g., `iperf` or `curl`) to verify limits, and validates RBAC functionality (Superadmin vs. Admin vs. User views).

## 3. Scenario Matrix

### Phase 1: The Default Engine (WireGuard)
*   **Goal:** Verify baseline functionality (Limits + Roles) on the standard Linux kernel/userspace WireGuard implementation.

### Phase 2+ (Future): Alternative Engines
*   **AmneziaWG:** Verify obfuscated traffic shaping.
*   **BoringTun:** Verify userspace implementations behave identically to kernel modules.
*   **Mikrotik:** Verify remote API integration and RouterOS Queue Trees.

## 4. Execution Steps (Phase 1: WireGuard)

### Step 1: Environment Initialization
- The Agent runs `docker compose -f docker-compose.dev.yml up -d --build`.
- The Agent confirms the UI is accessible on port `51821`.

### Step 2: Client Configuration (User Action)
- The User logs into the UI (`http://localhost:51821`) using the default Superadmin credentials.
- The User creates a new client and downloads the `.conf` file.
- The User provides the `.conf` file contents to the Agent.

### Step 3: Client Deployment (Agent Action)
- The Agent provisions a new Docker container (`linuxserver/wireguard` or `alpine` with WireGuard tools) using the provided `.conf`.
- The Agent confirms a successful handshake.

### Step 4: Traffic & Quota Validation (User Action)
- **Speed Limit:** The User sets a download/upload limit in the UI. The User execs into the client container and tests throughput (e.g., `curl -o /dev/null http://speedtest.tele2.net/10MB.zip`).
- **Bandwidth Quota:** The User sets a small quota (e.g., 5MB). The User generates traffic. After 60 seconds, the User verifies the client is auto-disabled and traffic stops.

### Step 5: RBAC Validation (User Action)
- The User creates a "Limited Admin" account and verifies they can manage clients but cannot access System Settings or Engines.
- The User creates a standard "User" account, associates it with a client, logs in, and verifies they only see their personal dashboard and usage stats.

## 5. Automated E2E Test

A headless Node.js test script implements the full scenario via the HTTP API:

**File:** `src/test/e2e-phase1-wireguard.cjs`

```bash
node src/test/e2e-phase1-wireguard.cjs
```

### Test Results (Local Dev Environment)

| Check | Status |
|---|---|
| Superadmin login | ✅ |
| Client creation + config download | ✅ |
| Download speed limit (`tc` class created) | ✅ |
| Upload speed limit | ⚠️ Requires Linux host with `ifb` module |
| Speed limit removal (`tc` class gone) | ✅ |
| Quota creation | ✅ |
| Simulated traffic + DB update | ✅ |
| Auto-disable on quota exceed | ✅ |
| Quota cleanup + re-enable | ✅ |
| RBAC — Operator can manage clients | ✅ |
| RBAC — Operator denied system settings | ✅ |
| RBAC — Viewer denied client creation | ✅ |

### Known Environment Constraints

- **macOS Docker (OrbStack):** Lacks the `ifb` kernel module, so upload (ingress) shaping fails with `Cannot find device "ifb-wg0"`. Download (egress) shaping works because HTB is a standard scheduler.
- **Linux Host:** Full upload/download shaping works when `ifb` is loaded (`sudo modprobe ifb`).

## 6. Deployment on Hetzner Cloud (Linux VM)

For full end-to-end validation with real traffic, deploy on a Hetzner Cloud VM:

1. **Provision:** Create a CPX11 (or larger) instance with Ubuntu 24.04.
2. **Prepare:** `apt update && apt install -y docker.io docker-compose-plugin`
3. **Clone:** `git clone <repo> && cd wg-easy-fork`
4. **Start:** `docker compose -f docker-compose.dev.yml up -d --build`
5. **Expose:** Open UDP port 51820 and TCP port 51821 in the Hetzner firewall.
6. **Verify:** Load `ifb` module inside the container or on the host.

The VM will provide a real Linux kernel where both ingress and egress shaping work correctly, enabling the full speed-limit test with a laptop client.
