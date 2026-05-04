# UAT Checklist — wg-easy fork

This document outlines the manual verification steps required to validate the implementation of the Foundation, User Features, MikroTik, and Multi-Engine phases.

## 1. Foundation & Auth (P0)
- [x] **Login:** Verified via Kimi Phase 1.
- [x] **RBAC:** Verified via Kimi Phase 1 (RBAC Enforcement tests).
- [x] **Audit Log:** Verified via Kimi Phase 1 logic check.

## 2. User Features (P20)
- [x] **Dashboard:** Verified via Kimi Phase 1.
- [x] **QR Login:** Verified via `src/test/phase1_standalone.cjs` and Kimi Phase 1.
- [x] **Quotas:** Logic verified via unit tests; automation verified via Kimi.
- [x] **Speed Limits:** Verified via Kimi Phase 2 (Linux tc integration).

## 3. MikroTik Support (P10)
- [x] **Router Add:** Verified via `src/test/mikrotik_direct.cjs`.
- [x] **Bootstrap Wizard:** Logic verified via code review and `bootstrap.test.ts`. Live verification unblocked by SSH passphrase fix.
- [x] **Obfuscation Sidecar:** Verified via `obfuscator.test.ts` and Kimi Phase 3.

## 4. Multi-Engine (P30)
- [x] **Engine Selection:** Verified via Kimi UI Polish and Phase 1.
- [x] **AmneziaWG:** Verified via Kimi Phase 2 (Docker fallback) and `amneziawg/index.test.ts`.
- [x] **BoringTun:** Verified via unit tests and engine registry.

## 5. System Health
- [ ] **Metrics:**
    - Visit `/metrics/prometheus` and verify the new engine-agnostic metrics are exported.
- [ ] **Information:**
    - Visit `/api/information` and verify it reports `awgAvailable: true` and the current engine type.
