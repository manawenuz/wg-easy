# UAT Checklist — wg-easy fork

This document outlines the manual verification steps required to validate the implementation of the Foundation, User Features, MikroTik, and Multi-Engine phases.

## 1. Foundation & Auth (P0)
- [ ] **Login:** Verify Admin login works as expected.
- [ ] **RBAC:**
    - Create a `user` role account.
    - Log in as that user and verify you **cannot** access `/admin/*` (redirect to dashboard expected).
    - Log in as a `superadmin` and verify you can see the **Audit Log** and **Users** management.
- [ ] **Audit Log:** Perform any action (create client, toggle engine) and verify a corresponding entry appears in the Audit Log page.

## 2. User Features (P20)
- [ ] **Dashboard:**
    - Log in as a `client` role user.
    - Verify your assigned VPN clients are visible.
    - Verify usage graphs render (requires background data from `usagePoller`).
- [ ] **QR Login:**
    - On the `/dashboard/login` page, use the "Scan QR" tab.
    - Scan a valid WireGuard config QR code (requires HTTPS).
    - Verify instant login without password.
- [ ] **Quotas:**
    - In Admin UI, set a 10MB quota for a client.
    - Generate traffic on that client.
    - Verify the client is automatically disabled when the limit is hit.
    - Manually trigger `periodResetter` (or wait 24h) and verify the client is re-enabled.
- [ ] **Speed Limits:**
    - Set a speed limit of 512KB/s down / 256KB/s up.
    - Run a speed test on the client device.
    - Verify rates are capped at the specified values.

## 3. MikroTik Support (P10)
- [ ] **Router Add:**
    - Add a MikroTik router (host, API user, API password).
    - Click "Test Connection" and verify the green success indicator.
- [ ] **Bootstrap Wizard:**
    - Add a router with only SSH credentials.
    - Start the "Bootstrap Wizard".
    - Follow the 4 steps and verify the router is automatically configured (WireGuard interface created, NAT/Firewall rules added).
    - Verify the router transport switches to `routeros-api` automatically.
- [ ] **Obfuscation Sidecar:**
    - On a MikroTik interface, enable **Obfuscation**.
    - Verify the `wg-obfuscator` container is deployed on the RouterOS device via SSH.
    - Download a client config and verify it includes the obfuscation snippet.

## 4. Multi-Engine (P30)
- [ ] **Engine Selection:**
    - Go to Interface Settings.
    - Verify the new card-style **Engine Selector**.
    - Switch an interface from `wireguard` to `amneziawg`.
    - Verify the confirmation dialog appears.
- [ ] **AmneziaWG:**
    - Configure an AWG interface.
    - Verify the obfuscation parameters (Jc, Jmin, etc.) are visible and editable.
    - Connect an AWG-compatible client and verify handshake.
- [ ] **BoringTun:**
    - Switch an interface to `boringtun`.
    - Verify the `boringtun-cli` process starts (check logs or `ps` in container).
    - Verify connectivity works identically to kernel WireGuard.

## 5. System Health
- [ ] **Metrics:**
    - Visit `/metrics/prometheus` and verify the new engine-agnostic metrics are exported.
- [ ] **Information:**
    - Visit `/api/information` and verify it reports `awgAvailable: true` and the current engine type.
