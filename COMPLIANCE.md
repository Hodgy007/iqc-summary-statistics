# IQC Summary Statistics — Security & Compliance Posture

## 1. Application Overview

IQC Summary Statistics is an internal web-based dashboard for clinical laboratory quality control. It processes QC measurement data from AU5800 and DxI analysers to compute summary statistics and generate audit-ready reports.

**Classification:** Internal laboratory tool. **No patient-identifiable information (PII) is processed or stored.**

---

## 2. Data Classification

| Data Type | Classification | At Rest | In Transit |
|-----------|---------------|---------|------------|
| QC measurement values | Internal / Non-sensitive | AES-256 (Neon) | TLS 1.2+ |
| User email addresses | Internal / Low sensitivity | AES-256 (Neon) | TLS 1.2+ |
| Passwords | Credential | bcrypt hashed + AES-256 | TLS 1.2+ |
| JWT tokens | Session | HttpOnly cookie (client) | Secure flag (HTTPS only) |
| CSV uploads | Transient | Browser memory only | Not transmitted unless user saves report |
| Exported reports (PDF/XLSX/CSV) | Transient | Generated client-side | Not transmitted |

---

## 3. Infrastructure Security Posture

### 3.1 Application Hosting — Vercel

All traffic is served over Vercel's global edge network with enforced TLS encryption. The platform provides:

- **Automatic TLS 1.2+ certificate provisioning** — all endpoints encrypted in transit with zero manual configuration
- **DDoS mitigation** — network-layer volumetric attack protection at the edge
- **Immutable deployments** — every deployment is atomic; rollback is instant with no residual state
- **Serverless runtime isolation** — each API function executes in an isolated container with no shared memory, filesystem, or state between invocations
- **No persistent server state** — stateless functions eliminate an entire class of server-side persistence attacks
- **SOC 2 Type II audited infrastructure** — Vercel's platform undergoes annual third-party audit

**Enterprise-tier hardening** (available when required by organisational policy):
- Web Application Firewall (WAF) with OWASP rule sets
- SSO/SAML for platform access — prevents unauthorised deployments
- IP allow-listing for deployment and preview access
- Audit logs for all platform actions (deploys, configuration changes, access)
- Custom SLA with guaranteed uptime commitments

### 3.2 Database — Neon Serverless PostgreSQL

All persistent data is stored in Neon's managed PostgreSQL service:

- **AES-256 encryption at rest** — all stored data encrypted by default with provider-managed keys
- **TLS 1.2+ encryption in transit** — all database connections use transport-layer encryption
- **Network isolation** — database endpoints require a credential-bearing connection string; not publicly enumerable
- **Serverless connection pooling** — connection handling prevents exhaustion attacks; no long-lived connections
- **Point-in-time recovery** — automated backups enabling recovery to any point within the retention window

**Enterprise-tier hardening** (available when required by organisational policy):
- SOC 2 Type II certification for the database layer
- HIPAA Business Associate Agreement (BAA)
- VPC peering for private network connectivity — eliminates public internet exposure of database traffic
- IP allow-listing restricting database access to known origins
- Dedicated compute with guaranteed resource isolation (no noisy-neighbour risk)

---

## 4. Application Security Controls

### 4.1 Authentication

- **Token storage** — JWT tokens stored in HttpOnly, Secure, SameSite=Strict cookies. Immune to JavaScript-based token theft (XSS cannot read or exfiltrate the token).
- **Password storage** — bcrypt with 10 salt rounds. Computationally expensive to brute-force even if the database is compromised.
- **Session validation** — Every API request re-validates the user's status and permissions from the database. A denied or suspended account is locked out immediately, even with a valid token.
- **Rate limiting** — Login capped at 10 attempts per 15 minutes per IP. Registration capped at 5 per 15 minutes. Mitigates credential stuffing and brute-force attacks.
- **No information disclosure** — Login failures return identical generic error messages regardless of whether the account exists, the password is wrong, or the account is suspended. Prevents account enumeration and oracle attacks.

### 4.2 Authorisation

- **Admin approval workflow** — New accounts are created in "pending" state. No self-service access; an administrator must explicitly approve each account.
- **Role-based access control** — Admin and user roles with granular permission levels (full_access / view_only). Enforced server-side on every state-changing request.
- **IDOR protection** — Report deletion is restricted to the report owner or an admin. Prevents cross-user data manipulation via direct object reference.
- **Admin self-protection** — Administrators cannot modify their own account, preventing accidental or social-engineered lockout.
- **Setup endpoint protection** — Database initialisation endpoint requires admin authentication.

### 4.3 Input Validation & Output Encoding

- **XSS prevention** — All user-supplied, CSV-derived, and server-returned content is HTML-escaped via a centralised `escapeHtml()` function before DOM insertion. Covers ~30+ injection points.
- **SQL injection prevention** — All database queries use parameterised tagged templates (Neon driver). No string concatenation in SQL construction.
- **CSRF protection** — SameSite=Strict cookie policy blocks cross-origin request forgery. All state-changing endpoints are POST/PUT/DELETE only.
- **Content Security Policy** — CSP meta tag restricts script execution to `'self'` and explicitly listed CDN origins. Blocks inline script injection from unknown sources.
- **File upload validation** — CSV file extension enforcement and 50MB size limit. Files are processed entirely client-side; no server-side file storage.
- **Error handling** — Generic error messages returned to clients. Internal error details logged server-side only, preventing information leakage of database structure, connection strings, or stack traces.

---

## 5. Compliance Alignment

### ISO 15189 (Medical Laboratories)

| Requirement | Status | Detail |
|-------------|--------|--------|
| Data integrity | **Met** | Parameterised queries, input validation, output escaping |
| Access control | **Met** | Role-based access with mandatory admin approval workflow |
| Audit trail | **Partial** | Report creation timestamps stored; granular user action logging recommended for full compliance |
| Data backup | **Met** | Neon point-in-time recovery (retention window tier-dependent) |
| Competence management | Out of scope | Organisational responsibility |

### NHS Data Security & Protection Toolkit (DSPT)

| Assertion | Status | Detail |
|-----------|--------|--------|
| Access management | **Met** | Admin approval required; role-based permissions enforced server-side |
| Encryption | **Met** | TLS 1.2+ in transit; AES-256 at rest |
| Data minimisation | **Met** | No PII processed or stored; QC instrument data only |
| Staff training | Out of scope | Organisational responsibility |
| Incident response | Out of scope | Organisational responsibility |

---

## 6. Known Limitations & Mitigations

| Limitation | Risk | Mitigation |
|-----------|------|------------|
| No SRI on CDN scripts | CDN compromise could inject malicious JS | CSP restricts script origins; CDN providers (jsDelivr, Cloudflare) maintain integrity controls |
| No MFA | Single-factor auth only | Mitigated by admin approval workflow, rate limiting, and HttpOnly tokens |
| In-memory rate limiting | Resets on serverless cold start | Acceptable for current scale; Redis-backed limiter recommended for high-traffic deployments |
| 7-day JWT expiry | Extended window if token compromised | Every request re-checks user status from DB; account suspension is effective immediately |
| No granular audit log | Limited forensic capability | Report timestamps provide basic trail; comprehensive logging recommended for Enterprise |

---

## 7. Recommendations for Enhanced Security Posture

| Enhancement | Impact | When Required |
|-------------|--------|---------------|
| Multi-factor authentication | Eliminates single-factor credential risk | Enterprise / NHS Trust deployments |
| Comprehensive audit logging | Full forensic and compliance trail | ISO 15189 full compliance |
| Redis-backed rate limiting | Persistent rate limiting across cold starts | High-availability deployments |
| Subresource Integrity (SRI) | Hardens against CDN supply-chain attacks | All production deployments |
| Penetration testing | Independent validation of security posture | Before production deployment |
| VPC peering (Neon Enterprise) | Eliminates public internet database exposure | Sensitive environments |

---

## Document Control

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Date | 2026-04-03 |
| Application Version | 2.0 |
| Classification | Internal |
| Review Frequency | Annually or on significant change |
