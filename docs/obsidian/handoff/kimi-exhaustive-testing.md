# Kimi Handoff: The "Exhaustive Validation" Campaign

You are the Senior QA Engineer for the `manawenuz/wg-easy` fork. This is the final validation campaign before the system is considered "Production Ready." You are tasked with executing the **Exhaustive Validation Master Plan**.

## Your Mission
1. **Headless UI Verification:** Validate the Nuxt 4 pages and Vue 3 components without a browser. Use unit tests for components and API-level E2E tests to verify state transitions (e.g., login -> dashboard, admin -> router settings).
2. **Traffic Stress Tests:** Verify the `tc` (Linux) and `queue tree` (MikroTik) logic. You must ensure that the shell commands generated for speed limiting are syntactically correct and target the right interfaces/IPs.
3. **Quota Automation:** Verify the `usagePoller` and `periodResetter` schedulers. You must prove that a client is automatically disabled in the database when usage exceeds the quota.
4. **End-User Handshake:** Verify the Curve25519 challenge-response login logic used for the User Dashboard.

---

## Testing Environments
- **Local:** `src/` (Drizzle/SQLite, Nuxt 4).
- **Remote Linux:** `188.245.59.196` (Use SSH key at `node_modules/wzp`).
- **MikroTik VM:** `172.16.81.127` (RouterOS 7.22.1).

---

## Phase 1: The "Obscura" Suite (Headless UI)
- Verify `src/app/pages/login.vue` handles incorrect credentials with a toast (using the polished `useSubmit` logic).
- Verify `src/app/pages/admin/routers/index.vue` displays the "Dockerized" badge when the API reports `dockerized: true`.
- Verify `src/app/pages/dashboard/index.vue` correctly filters clients so that a user cannot see another user's peers.

## Phase 2: The "Pressure Cooker" (Traffic & Quotas)
- **Scenario:** Speed Limit on Linux.
- **Task:** Verify `src/server/engines/wireguard/speedlimit.ts` produces the correct `tc filter` commands for a given peer IP.
- **Scenario:** Bandwidth Quota.
- **Task:** Create a test case that seeds a 10MB quota, simulates 11MB of usage in the `usage_sample` table, and verifies the scheduler disables the peer.

## Phase 3: The "MikroTik Auditor" (Bootstrap & API)
- Verify that the `MikrotikEngine` correctly uses the new `sshPassphraseEncrypted` field for bootstrap attempts.
- Verify that the `ObfuscationSidecar` deployment correctly detects an existing `wg-obfuscator` container and skips re-deployment (idempotency).

---

## Output Format
1. **Test Log:** Detailed list of every scenario executed.
2. **Pass/Fail Matrix:** 100% of cases must pass.
3. **Emergency Fixes:** If you find a bug during this exhaustive test, provide a unified diff to fix it immediately.
4. **Final System Status:** A definitive statement on the project's readiness.
