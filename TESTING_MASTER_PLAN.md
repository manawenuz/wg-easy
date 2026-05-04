# Exhaustive Validation Master Plan

This plan defines the final, 100% coverage testing campaign for the `wg-easy` fork. It transitions from unit-level verification to end-to-end "Stress" validation.

## 1. Automated Regression (Vitest)
- **Goal:** Maintain 100% pass rate on the existing 165 unit tests.
- **Scope:** Auth, RBAC, Data Model, Engine Registry, Config Generators.

## 2. Headless UI Verification (The "Obscura" Suite)
- **Goal:** Validate the polished UI without manual clicking.
- **Tooling:** Playwright (Headless) or direct API-to-Component integration tests.
- **Key Scenarios:**
  - **Login Flow:** Verify redirect to `/setup` if no admin exists; verify `/login` redirect for unauthenticated users.
  - **RBAC Lockout:** Log in as `operator`, verify "Router Settings" are hidden or read-only.
  - **Responsive Layout:** Check `ClientCard` for layout shifts during simulated data stream updates.
  - **Bootstrap Wizard:** Verify the 4-step progress bar and state transitions.

## 3. Bandwidth & Traffic Management (The "Pressure Cooker")
- **Goal:** Empirically prove that quotas and speed limits work on real hardware.
- **Target Environments:** Remote Linux (`188.245.59.196`) and MikroTik VM (`172.16.81.127`).
- **Test Cases:**
  - **Linux tc Shaping:** Set 512Kbps limit -> Run `iperf3` -> Verify throughput matches +/- 10%.
  - **MikroTik Queue Tree:** Set 1Mbps limit -> Verify `queue tree` creation on RouterOS -> Run traffic -> Verify match.
  - **Auto-Disable Quota:** Set 5MB quota -> Transfer 6MB -> Verify the engine calls `disablePeer()` and the client state flips to `enabled: false`.

## 4. End-User Verification
- **Goal:** Test the features from the perspective of a VPN client.
- **Scenarios:**
  - **QR Login Handshake:** Use `src/test/phase1_standalone.cjs` logic to verify the Curve25519 challenge-response sequence.
  - **Dashboard Usage Graph:** Seed usage data into the DB -> Verify the API returns the correct samples -> Verify the graph renders correctly.
  - **One-Time Link Expiry:** Create OTL -> Wait for expiry -> Verify 404/410 response.

## 5. Deployment Resilience
- **Goal:** Verify the "Dockerized Fallback" on a "Clean" host.
- **Scenario:** Remove `awg` from a remote host -> Attempt to bring up an AmneziaWG interface -> Verify the app successfully switches to `docker run ... amneziawg-tools`.
