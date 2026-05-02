# Technical Audit Notes — wg-easy fork

This document summarizes the technical state of the codebase after the first three major phases, including known gaps, architectural deviations, and follow-up tasks.

## 1. Architectural Integrity
- **VpnEngine Abstraction:** The abstraction is solid. We have four working engines: `wireguard`, `amneziawg`, `boringtun`, and `mikrotik`.
- **Registry:** The `registry.ts` correctly handles dynamic resolution of engines per interface.
- **Transports:** `LocalShell`, `SshTransport`, and `RouterOsApiTransport` provide a clean separation between engine logic and communication protocols.
- **Scheduler:** The background workers (`usagePoller`, `quotaEvaluator`, etc.) are correctly initialized in `Database.ts` and handle multi-engine interfaces.

## 2. Security Audit
- **RBAC:** Principal context and `requirePermission` are enforced in all new API routes.
- **Encryption:** Router credentials are encrypted at rest using `aes-256-gcm`.
- **Crypto (Login):** The QR/Key login uses a secure X25519 ECDH handshake + SHA-512 proof-of-possession. Private keys are never sent to the server.

## 3. Known Gaps & Punted Tasks

### i18n (Translations)
- **Dashboard:** Many keys in the User Dashboard and login pages (`dashboard.*`) are referenced but not yet present in `en.json` or other locales.
- **Capabilities:** Engine capability labels ("Speed Limit", "Live Stats") in the Engine Selector are currently hardcoded in English.
- **Speed Limits:** Badge labels are hardcoded.

### MikroTik
- **API Connectivity:** TLS is supported, but **fingerprint pinning (TOFU)** is not yet implemented. It currently connects to any TLS-enabled RouterOS API without verification.
- **Endpoints:** Missing a singular `GET /api/admin/router/[id]` endpoint; the UI currently filters from the full list.
- **Obfuscation:** The `generateClientObfuscatorConfig()` helper is implemented on the engine but **not yet wired** into the `/api/client/:id/configuration` or dashboard download routes.

### Multi-Engine
- **AmneziaWG:** Parameters are currently shared via the interface. Fine-grained per-peer AWG parameter overrides in the UI were punted.
- **BoringTun:** Requires a host with `boringtun-cli` installed. The Dockerfile now builds this, but manual host installs must ensure the binary is on the `PATH`.

## 4. Test Suite Health
- **Total Tests:** ~165 unit tests across the suite.
- **Coverage:** Excellent coverage for crypto, engine logic, and API controllers.
- **Note:** `usage.get.test.ts` was reported as flaky by the implementer; verify during UAT.
