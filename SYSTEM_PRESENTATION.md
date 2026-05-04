# wg-easy Fork: System Presentation

This document provides a comprehensive overview of the features and architectural innovations implemented in the `manawenuz/wg-easy` fork.

## 1. Core Architecture: Router-Agnostic Control Plane
The central innovation is the **VpnEngine** abstraction. The application is no longer a wrapper for a local `wg` command; it is a multi-tenant control plane that can manage VPN interfaces across different hardware and OS environments.

### Supporting Engines:
- **WireGuard (Native):** Standard Linux kernel implementation.
- **AmneziaWG:** WireGuard with packet-shape obfuscation (Jc, Jmin, Jmax, etc.).
- **BoringTun:** Cloudflare's userspace implementation (Rust).
- **MikroTik:** Remote management of RouterOS devices via API.

*Note: The UI displays a "Dockerized" badge when an engine is running via the Docker fallback (e.g., on remote hosts missing native binaries).*

---

## 2. Multi-Admin & RBAC (Foundation)
The system supports multiple administrators with granular permissions (RBAC).
- **Superadmin:** Full access to everything.
- **Admin:** Managed access to specific routers.
- **Operator:** Can manage clients but not router settings.
- **Viewer:** Read-only access to monitoring data.
- **Audit Logging:** Every state-changing action (client creation, engine toggle) is logged with the actor's ID and timestamp.

---

## 3. Advanced Traffic Management
- **Bandwidth Quotas:** Daily, weekly, or monthly data caps per client. Automatically disables the client when the limit is reached and resets at the start of the next period.
- **Speed Limits:** Real-time rate limiting (KB/s up/down) per client.
  - **Linux:** Implemented via `tc` (Traffic Control) with HTB qdiscs and IFB redirection.
  - **MikroTik:** Implemented via RouterOS `queue tree` and `mangle` rules.

---

## 4. End-User Features
- **User Dashboard:** A dedicated, read-only view for VPN clients. Users see their own clients, usage statistics, and expiry dates.
- **QR Key Login:** A passwordless login system. Users scan their WireGuard QR code or paste their config; the server verifies ownership of the private key via a Curve25519 signature challenge.
- **One-Time Links:** Secure, expiring links for sharing VPN configurations.

---

## 5. MikroTik Integration (Flagship)
- **Bootstrap Wizard:** A 4-step automated sequence that takes a "vanilla" MikroTik router and configures the WireGuard interface, IP addresses, NAT rules, and API users via SSH.
- **RouterOS API Transport:** High-performance, steady-state management using the native RouterOS API.
- **Obfuscation Sidecar:** Automatic deployment of `wg-obfuscator` containers on RouterOS for DPI evasion.

---

## 6. Resilience & Deployment
- **Dockerized Engine Fallback:** If a remote Linux host lacks native AmneziaWG tools, the orchestrator transparently executes commands via a transient Docker container.
- **Userspace Fallback:** The Docker image includes `amneziawg-go` for systems where kernel modules cannot be loaded.
- **SSH Passphrase Support:** Full support for encrypted, passphrase-protected SSH keys for remote management.

---

## 7. Platform Requirements
- **Host OS:** Linux is the primary target and is required for full feature parity.
- **Traffic Shaping:** Bi-directional speed limiting (Upload + Download) requires a host kernel that supports the `ifb` (Intermediate Functional Block) module.
  - **Linux Host:** Fully supported via `modprobe ifb`.
  - **Docker-on-macOS/Windows:** Egress (Download) shaping works via HTB, but Ingress (Upload) shaping is disabled due to missing kernel module support in the virtualized environment.
- **Kernel Headers:** Required for native WireGuard/AmneziaWG kernel modules. The system will automatically fallback to userspace (`wireguard-go`) if modules are unavailable.
