# IQC Summary Statistics — Compliance & Security Document

## 1. Application Overview

IQC Summary Statistics is a web-based Internal Quality Control dashboard for clinical laboratory instruments. It processes QC data from AU5800 and DxI analysers, computes summary statistics, and generates audit-ready reports.

**Classification:** Internal laboratory tool handling QC measurement data. No patient-identifiable information (PII) is processed or stored.

---

## 2. Hosting Infrastructure & Tiers

### 2.1 Application Hosting — Vercel

| Tier | Features | Suitability |
|------|----------|-------------|
| **Hobby (Free)** | 1 deployment per commit, serverless functions (10s timeout), 100GB bandwidth/month, shared infrastructure | Development/testing only. Not suitable for production lab use. |
| **Pro ($20/user/month)** | Unlimited deployments, serverless functions (60s timeout), 1TB bandwidth, password protection, advanced analytics, preview deployments | Recommended for production. Adequate for small-to-medium lab teams. |
| **Enterprise (Custom)** | SSO/SAML, SLA guarantees, dedicated support, audit logs, advanced security (WAF, DDoS protection), custom domains with TLS, SOC 2 Type II compliant infrastructure | Required for organisations with formal compliance mandates (ISO 15189, NHS DSPT). |

**Current recommendation:** Pro tier minimum for production use. Enterprise tier if organisational policy requires SLA guarantees or SOC 2 compliance.

### 2.2 Database Hosting — Neon (Serverless PostgreSQL)

| Tier | Features | Suitability |
|------|----------|-------------|
| **Free** | 0.5 GiB storage, 1 project, shared compute, community support | Development/testing only. |
| **Launch ($19/month)** | 10 GiB storage, 10 projects, autoscaling compute, 300 compute hours/month | Suitable for small lab deployments with moderate data volumes. |
| **Scale ($69/month)** | 50 GiB storage, 50 projects, 750 compute hours/month, IP allow-listing, read replicas | Recommended for production. Supports larger datasets and network restrictions. |
| **Enterprise (Custom)** | Unlimited storage, dedicated compute, SOC 2 Type II, HIPAA BAA available, SLA, audit logging, VPC peering | Required for formal compliance environments. |

**Current recommendation:** Scale tier minimum for production. Enterprise tier if handling data subject to regulatory requirements.

---

## 3. Data Classification

| Data Type | Classification | Storage Location | Encrypted at Rest | Encrypted in Transit |
|-----------|---------------|-----------------|-------------------|---------------------|
| QC measurement values | Internal/Non-sensitive | Neon PostgreSQL | Yes (AES-256) | Yes (TLS 1.2+) |
| User email addresses | Internal/Low sensitivity | Neon PostgreSQL | Yes (AES-256) | Yes (TLS 1.2+) |
| User passwords | Credential | Neon PostgreSQL (bcrypt hashed) | Yes (AES-256) | Yes (TLS 1.2+) |
| JWT tokens | Session | HTTP-only cookie (client-side) | N/A | Yes (Secure flag) |
| CSV uploads | Transient | Browser memory only | N/A | N/A (client-side processing) |
| Exported reports | Transient | Browser download | N/A | N/A (client-side generation) |

**Key point:** CSV files are processed entirely in the browser. Raw data is only sent to the server when a user explicitly saves a report.

---

## 4. Authentication & Access Control

### 4.1 Authentication Mechanism

- JWT-based authentication with HS256 signing
- Tokens stored in HttpOnly, Secure, SameSite=Strict cookies
- 7-day token expiration
- Password hashing via bcrypt (10 salt rounds)
- Minimum password length: 8 characters

### 4.2 Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| Login | 10 attempts | 15 minutes |
| Registration | 5 attempts | 15 minutes |

### 4.3 Role-Based Access Control

| Role | Permission | Capabilities |
|------|-----------|-------------|
| Admin | full_access | All features, user management, approve/deny accounts |
| User | full_access | Import, export, save/load/delete own reports |
| User | view_only | Import, export, view reports (no save/delete) |
| User | pending | No access until approved by admin |

### 4.4 Authorisation Model

- First registered user automatically becomes admin
- Subsequent users require admin approval before access
- Server-side permission checks on all state-changing API endpoints
- Report deletion restricted to report owner or admin (IDOR protection)
- Admin self-modification blocked to prevent accidental lockout

---

## 5. Security Controls

### 5.1 Input Validation

| Control | Implementation |
|---------|---------------|
| XSS prevention | All dynamic content escaped via `escapeHtml()` before DOM insertion |
| SQL injection | Parameterised queries via Neon serverless driver (tagged templates) |
| CSRF protection | SameSite=Strict cookies |
| Content Security Policy | Restricts script sources to self and known CDN origins |
| File upload validation | CSV extension check, 50MB size limit |
| Error handling | Generic error messages to client, detailed logs server-side |

### 5.2 Transport Security

- All traffic over HTTPS (enforced by Vercel)
- Secure cookie flag ensures tokens only sent over HTTPS
- CDN scripts loaded with `crossorigin="anonymous"` attributes

### 5.3 Known Limitations

| Item | Status | Mitigation |
|------|--------|------------|
| No SRI on CDN scripts | Not implemented | CSP restricts script origins; CDN providers maintain integrity |
| No token revocation | By design (stateless JWT) | Auth middleware re-checks user status from DB on every request |
| No MFA | Not implemented | Mitigated by approval workflow and rate limiting |
| In-memory rate limiting | Resets on function cold start | Acceptable for serverless; consider Redis-backed limiter for Enterprise |
| No audit logging | Not implemented | Consider for Enterprise tier deployments |

---

## 6. Infrastructure Security (by Tier)

### 6.1 Vercel Security Features by Tier

| Feature | Hobby | Pro | Enterprise |
|---------|-------|-----|-----------|
| HTTPS/TLS | Yes | Yes | Yes |
| DDoS protection | Basic | Basic | Advanced (WAF) |
| Edge network | Yes | Yes | Yes |
| Preview deploy protection | No | Password | SSO/SAML |
| Audit logs | No | No | Yes |
| SOC 2 Type II | Shared | Shared | Dedicated |
| SLA | None | None | Custom |
| IP allow-listing | No | No | Yes |

### 6.2 Neon Security Features by Tier

| Feature | Free | Launch | Scale | Enterprise |
|---------|------|--------|-------|-----------|
| Encryption at rest | Yes | Yes | Yes | Yes |
| TLS in transit | Yes | Yes | Yes | Yes |
| IP allow-listing | No | No | Yes | Yes |
| SOC 2 Type II | No | No | No | Yes |
| HIPAA BAA | No | No | No | Yes |
| VPC peering | No | No | No | Yes |
| Point-in-time recovery | 24h | 7 days | 14 days | 30 days |

---

## 7. Compliance Mapping

### 7.1 ISO 15189 (Medical Laboratories)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Data integrity | Met | Parameterised queries, input validation, escaping |
| Access control | Met | Role-based with admin approval workflow |
| Audit trail | Partial | Report creation timestamps stored; no granular audit log |
| Data backup | Dependent on tier | Neon provides point-in-time recovery (tier-dependent) |
| Competence management | Out of scope | User roles define access, not competence |

### 7.2 NHS Data Security and Protection Toolkit (DSPT)

| Assertion | Status | Notes |
|-----------|--------|-------|
| Access management | Met | User registration requires admin approval |
| Encryption | Met | TLS in transit, AES-256 at rest (Neon) |
| Staff training | Out of scope | Organisational responsibility |
| Data minimisation | Met | No PII processed; QC data only |
| Incident response | Out of scope | Organisational responsibility |

---

## 8. Recommendations by Deployment Scenario

### Small Laboratory (1-5 users)
- **Vercel:** Pro tier
- **Neon:** Launch tier
- **Additional:** Ensure `JWT_SECRET` is cryptographically random (256+ bits)

### Medium Laboratory (5-20 users)
- **Vercel:** Pro tier
- **Neon:** Scale tier (for IP allow-listing)
- **Additional:** Consider implementing audit logging, regular DB backups

### Enterprise / NHS Trust
- **Vercel:** Enterprise tier (SSO, WAF, SLA, audit logs)
- **Neon:** Enterprise tier (HIPAA BAA, VPC peering, SOC 2)
- **Additional:** Implement MFA, comprehensive audit logging, external Redis for rate limiting, SRI hashes on CDN scripts, penetration testing

---

## 9. Document Control

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Date | 2026-04-03 |
| Application Version | 2.0 |
| Classification | Internal |
| Review Frequency | Annually or on significant change |
