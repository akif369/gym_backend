# GYMatrix Backend Implementation Doc

Date audited: August 8, 2026

## 1. Current repo reality

This repo is not yet a production-ready full-stack system.

Observed state in the current workspace:

- `webapp` contains a broad admin UI for members, attendance, payments, staff, leads, trainers, PT sessions, workouts, reports, settings, and login.
- Most frontend pages still read from `webapp/src/lib/mockData.ts`.
- The only live API integration currently used by the webapp is:
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/forgot-password`
- The current `backend` folder contains package metadata and dependencies, but no actual application source files.
- The root `README.md` still references an older monorepo layout (`services/api`, NestJS, Prisma) that does not match the current filesystem.

Bottom line:

- The frontend product scope is significantly ahead of the backend.
- The backend should be treated as a new implementation project, not as a partially finished production service.

## 2. Product surface implied by the frontend

The current admin app requires backend support for these business areas:

- Authentication and staff sessions
- Organization and branch settings
- Members and member profiles
- Membership plans and membership lifecycle operations
- Attendance and check-in/out flows
- Payments, invoices, refunds, and revenue tracking
- Trainers and trainer assignments
- Personal training packages and session scheduling
- Leads and CRM pipeline
- Workout exercise library and workout templates
- Staff management and permissions
- Reports and CSV exports
- Hardware integration settings for QR, RFID, and printer workflows

## 3. Production-grade backend capabilities required

These are the non-negotiable backend features needed before calling the application production-grade.

### 3.1 Platform and architecture

- Versioned REST API under `/api/v1`
- OpenAPI/Swagger spec generated from the live server
- Structured request validation and typed response contracts
- Multi-environment config management
- Database migrations and repeatable seed strategy
- Background job support for async work
- File/object storage integration for logos, avatars, and attachments

### 3.2 Security

- Password hashing with Argon2 or bcrypt
- Access tokens plus refresh token rotation
- Session revocation and forced logout
- Role-based access control and permission checks
- Audit logging for sensitive actions
- Rate limiting on auth and public endpoints
- CSRF strategy if cookies are used
- Secure password reset with single-use expiring tokens
- Optional MFA for owner/manager roles
- Tenant isolation if multiple gyms/branches will share the same platform

### 3.3 Operational readiness

- Centralized error handling with stable error codes
- Request IDs and correlation IDs
- Health endpoints for liveness and readiness
- Structured logs
- Metrics and tracing hooks
- Retry-safe idempotency for payment and membership mutation flows
- Backup and restore plan
- PII retention and deletion policy

### 3.4 Data integrity

- Immutable financial ledger entries
- Immutable membership event history
- Soft delete strategy where recovery matters
- Concurrency protection for check-in, check-out, renewal, refund, and assignment flows
- Referential integrity between members, staff, trainers, payments, sessions, and memberships

## 4. Recommended domain model

Core entities to implement:

- `organizations`
- `branches`
- `users`
- `roles`
- `permissions`
- `user_sessions`
- `members`
- `member_emergency_contacts`
- `member_health_profiles`
- `membership_plans`
- `member_memberships`
- `membership_events`
- `attendance_logs`
- `payment_transactions`
- `invoices`
- `invoice_line_items`
- `refunds`
- `trainers`
- `trainer_assignments`
- `pt_packages`
- `pt_sessions`
- `leads`
- `lead_activities`
- `lead_conversions`
- `exercises`
- `workout_templates`
- `workout_template_exercises`
- `member_measurements`
- `staff_audit_logs`
- `settings`
- `hardware_devices`
- `report_exports`

## 5. Endpoint blueprint by module

The tables below describe the backend API surface needed to support the current frontend and near-term production readiness.

### 5.1 Auth and session management

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/auth/login` | Email/password login |
| `POST` | `/auth/refresh` | Rotate refresh token and issue new access token |
| `POST` | `/auth/logout` | Revoke current session |
| `POST` | `/auth/logout-all` | Revoke all sessions for current user |
| `GET` | `/auth/me` | Current authenticated user profile and permissions |
| `POST` | `/auth/forgot-password` | Start password reset flow |
| `POST` | `/auth/reset-password` | Complete reset using token |
| `POST` | `/auth/change-password` | Change password while authenticated |
| `GET` | `/auth/sessions` | List active sessions/devices |
| `DELETE` | `/auth/sessions/:sessionId` | Revoke a device/session |

Production notes:

- Return normalized permission data in `/auth/me`
- Log login success/failure and password resets
- Add brute-force protection and account lockout thresholds

### 5.2 Organizations, branches, and settings

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/org` | Organization profile |
| `PATCH` | `/org` | Update gym profile |
| `GET` | `/branches` | List branches |
| `POST` | `/branches` | Create branch |
| `GET` | `/branches/:branchId` | Branch detail |
| `PATCH` | `/branches/:branchId` | Update branch |
| `GET` | `/settings` | Aggregate settings payload |
| `PATCH` | `/settings/gym-profile` | Gym profile settings |
| `PATCH` | `/settings/branch` | Branch settings |
| `PATCH` | `/settings/attendance` | Attendance policy settings |
| `PATCH` | `/settings/tax` | GST and tax settings |
| `PATCH` | `/settings/invoice` | Invoice numbering and footer settings |
| `PATCH` | `/settings/hardware` | Hardware integration settings | (make mock dummy for now)

### 5.3 Staff, roles, and permissions

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/staff` | Paginated staff list |
| `POST` | `/staff` | Create staff user |
| `GET` | `/staff/:staffId` | Staff detail |
| `PATCH` | `/staff/:staffId` | Update staff profile |
| `PATCH` | `/staff/:staffId/status` | Activate/deactivate staff |
| `GET` | `/roles` | List system roles |
| `GET` | `/permissions` | List permissions |
| `PATCH` | `/staff/:staffId/permissions` | Override direct permissions |
| `PATCH` | `/roles/:roleKey` | Update role permission matrix |
| `GET` | `/audit-logs` | Staff activity audit log |

Production notes:

- Staff creation should support invite flow, not raw password entry
- Separate role defaults from per-user overrides

### 5.4 Members

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/members` | Paginated/filterable member list |
| `POST` | `/members` | Create member |
| `GET` | `/members/:memberId` | Member profile |
| `PATCH` | `/members/:memberId` | Update member profile |
| `PATCH` | `/members/:memberId/status` | Activate/freeze/archive member state |
| `GET` | `/members/:memberId/activity` | Timeline activity |
| `GET` | `/members/:memberId/measurements` | Measurement history |
| `POST` | `/members/:memberId/measurements` | Add assessment |
| `GET` | `/members/:memberId/health-profile` | Health/medical profile |
| `PATCH` | `/members/:memberId/health-profile` | Update health profile |
| `POST` | `/members/:memberId/photo` | Upload member avatar |

Important filters for `GET /members`:

- `search`
- `membershipStatus`
- `paymentStatus`
- `trainerId`
- `branchId`
- `lastVisitBefore`
- `page`
- `pageSize`

### 5.5 Membership plans and lifecycle

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/membership-plans` | List plans |
| `POST` | `/membership-plans` | Create plan |
| `GET` | `/membership-plans/:planId` | Plan detail |
| `PATCH` | `/membership-plans/:planId` | Update plan |
| `PATCH` | `/membership-plans/:planId/status` | Enable/disable plan |
| `GET` | `/members/:memberId/memberships` | Member membership history |
| `GET` | `/members/:memberId/membership-events` | Immutable event timeline |
| `POST` | `/members/:memberId/memberships/create` | Start membership |
| `POST` | `/members/:memberId/memberships/activate` | Activate pending membership |
| `POST` | `/members/:memberId/memberships/renew` | Renew membership |
| `POST` | `/members/:memberId/memberships/upgrade` | Upgrade plan |
| `POST` | `/members/:memberId/memberships/downgrade` | Downgrade plan |
| `POST` | `/members/:memberId/memberships/freeze` | Freeze membership |
| `POST` | `/members/:memberId/memberships/resume` | Resume frozen membership |
| `POST` | `/members/:memberId/memberships/extend` | Extend expiry |
| `POST` | `/members/:memberId/memberships/cancel` | Cancel membership |
| `POST` | `/members/:memberId/memberships/transfer` | Transfer membership/branch |

Production notes:

- These should produce event records, not silent in-place edits
- Use idempotency keys for renewal and plan mutation endpoints

### 5.6 Attendance

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/attendance` | Historical logs with filters |
| `GET` | `/attendance/currently-inside` | Live occupancy list |
| `POST` | `/attendance/check-in` | Manual check-in |
| `POST` | `/attendance/check-out` | Check out a member |
| `POST` | `/attendance/correct` | Correct a historical entry |
| `GET` | `/members/:memberId/attendance` | Member attendance history |
| `GET` | `/attendance/analytics/peak-hours` | Peak hour analytics |
| `GET` | `/attendance/analytics/daily` | Daily attendance trend |
| `POST` | `/attendance/check-in/qr` | QR-based check-in |
| `POST` | `/attendance/check-in/rfid` | RFID-based check-in |

Production notes:

- Prevent duplicate active check-ins
- Enforce membership validity and branch capacity rules
- Record check-in source and operator

### 5.7 Payments, invoices, and refunds

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/payments` | Paginated payment list |
| `POST` | `/payments` | Record payment |
| `GET` | `/payments/:paymentId` | Payment detail |
| `POST` | `/payments/:paymentId/refund` | Refund transaction |
| `GET` | `/members/:memberId/payments` | Member payment history |
| `GET` | `/invoices` | Invoice list |
| `POST` | `/invoices/generate` | Generate invoice |
| `GET` | `/invoices/:invoiceId` | Invoice detail |
| `GET` | `/invoices/:invoiceId/pdf` | Invoice PDF |
| `POST` | `/payments/webhooks/provider` | Payment gateway webhook |

Production notes:

- Use ledger-style immutable transaction records
- Support partial payment, refund, failed, pending, and reconciled states
- Add provider-specific idempotency handling

### 5.8 Trainers and assignments

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/trainers` | List trainers |
| `POST` | `/trainers` | Create trainer |
| `GET` | `/trainers/:trainerId` | Trainer profile |
| `PATCH` | `/trainers/:trainerId` | Update trainer |
| `PATCH` | `/trainers/:trainerId/status` | Active/on-leave/inactive |
| `GET` | `/trainers/:trainerId/members` | Members assigned to trainer |
| `POST` | `/trainers/:trainerId/assign-members` | Bulk assign members |
| `DELETE` | `/trainers/:trainerId/members/:memberId` | Remove trainer assignment |
| `GET` | `/trainers/:trainerId/performance` | Performance summary |

### 5.9 Personal training

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/pt/packages` | List PT packages |
| `POST` | `/pt/packages` | Create PT package |
| `PATCH` | `/pt/packages/:packageId` | Update PT package |
| `GET` | `/pt/sessions` | Session list with filters |
| `POST` | `/pt/sessions` | Book PT session |
| `GET` | `/pt/sessions/today` | Today’s schedule |
| `GET` | `/pt/sessions/:sessionId` | Session detail |
| `PATCH` | `/pt/sessions/:sessionId` | Update date/time/notes |
| `POST` | `/pt/sessions/:sessionId/complete` | Mark session complete |
| `POST` | `/pt/sessions/:sessionId/cancel` | Cancel session |
| `POST` | `/pt/sessions/:sessionId/miss` | Mark session missed |

### 5.10 Leads and CRM  (make mock dummy for now make it simple for now)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/leads` | Paginated leads with filters |
| `POST` | `/leads` | Create lead |
| `GET` | `/leads/:leadId` | Lead detail |
| `PATCH` | `/leads/:leadId` | Update lead |
| `PATCH` | `/leads/:leadId/status` | Move pipeline stage |
| `POST` | `/leads/:leadId/activities` | Add call/note/activity |
| `POST` | `/leads/:leadId/convert` | Convert lead to member |
| `GET` | `/leads/analytics/sources` | Source breakdown |
| `GET` | `/leads/analytics/pipeline` | Pipeline counts |

Production notes:

- Lead conversion should optionally create member, membership, invoice, and initial payment in one workflow

### 5.11 Workouts and exercise library (make mock dummy for now make it simple for now)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/exercises` | Exercise library |
| `POST` | `/exercises` | Create exercise |
| `GET` | `/exercises/:exerciseId` | Exercise detail |
| `PATCH` | `/exercises/:exerciseId` | Update exercise |
| `PATCH` | `/exercises/:exerciseId/status` | Enable/disable exercise |
| `GET` | `/workout-templates` | List workout templates |
| `POST` | `/workout-templates` | Create template |
| `GET` | `/workout-templates/:templateId` | Template detail |
| `PATCH` | `/workout-templates/:templateId` | Update template |
| `POST` | `/workout-templates/:templateId/assign` | Assign template to member(s) |

### 5.12 Reports and exports

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/reports/attendance` | Attendance report |
| `GET` | `/reports/revenue` | Revenue report |
| `GET` | `/reports/memberships` | Membership status report |
| `GET` | `/reports/trainers/performance` | Trainer performance report |
| `GET` | `/reports/pt-sessions` | PT sessions report |
| `POST` | `/reports/export` | Queue CSV/PDF export |
| `GET` | `/reports/exports/:exportId` | Export job status |
| `GET` | `/reports/exports/:exportId/download` | Download generated export |

## 6. Frontend-to-backend gap summary

Current frontend modules and backend readiness:

| Module | Frontend status | Backend status in repo | Needed |
|---|---|---|---|
| Login | Connected to API contract | No visible backend source | Build auth service |
| Members | Mock-driven | Missing | Full CRUD + filters + detail |
| Memberships | Mock-driven | Missing | Plans + operations + event store |
| Attendance | Mock-driven | Missing | Live occupancy + check-in/out + analytics |
| Payments | Mock-driven | Missing | Transactions + invoices + refunds |
| Staff | Mock-driven | Missing | RBAC + invites + audit |
| Trainers | Mock-driven | Missing | Trainer CRUD + assignments |
| PT sessions | Mock-driven | Missing | Scheduling + completion workflow |
| Leads | Mock-driven | Missing | CRM pipeline + conversion |
| Workouts | Mock-driven | Missing | Exercises + templates |
| Reports | Mock-driven | Missing | Query/report/export services |
| Settings | Mock-driven | Missing | Org/branch/system settings service |

## 7. Recommended implementation phases

### Phase 1: Foundation

- Create actual backend source layout
- Add server bootstrap, config, logging, error handling, validation
- Add PostgreSQL schema and migrations
- Add auth, users, roles, permissions
- Add `/auth/login`, `/auth/me`, `/auth/refresh`, `/auth/logout`
- Add health endpoints

### Phase 2: Core gym operations

- Members
- Membership plans and membership events
- Attendance
- Payments and invoices
- Basic settings

This phase should make the dashboard operational for a real gym.

### Phase 3: Operational enrichment

- Trainers
- PT packages and PT sessions
- Leads and conversion
- Workout templates and exercises
- Report queries and export jobs

### Phase 4: Production hardening

- Audit logs
- Refresh token rotation and session management
- Secure password reset
- Background jobs
- File uploads
- Monitoring and tracing
- Rate limits and abuse controls
- Data retention and compliance workflows

## 8. Suggested backend folder structure

Because the current backend has no source, this would be a reasonable starting structure:

```text
backend/
  src/
    app.ts
    server.ts
    config/
    plugins/
    common/
      errors/
      auth/
      validation/
      pagination/
      audit/
    modules/
      auth/
      users/
      roles/
      org/
      branches/
      settings/
      members/
      memberships/
      attendance/
      payments/
      invoices/
      trainers/
      pt/
      leads/
      workouts/
      reports/
    db/
      schema/
      migrations/
      seeds/
    jobs/
    tests/
```

## 9. API contract standards to enforce

- Use cursor or page pagination consistently
- Include `createdAt`, `updatedAt`, and `id` on all resources
- Return machine-readable error codes
- Normalize list responses as:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 0
}
```

- Normalize mutation success responses with updated resource payloads
- Support filtering and sorting via query params rather than many ad hoc endpoints
- Use ISO 8601 timestamps, not UI-formatted strings

## 10. Highest-priority implementation checklist

- [ ] Create actual backend source code in `backend/src`
- [ ] Implement database schema for auth, members, memberships, attendance, payments
- [ ] Implement `POST /api/v1/auth/login`
- [ ] Implement `GET /api/v1/auth/me`
- [ ] Implement secure refresh/logout flow
- [ ] Replace frontend member mock data with real `GET /members`
- [ ] Replace attendance mock data with real occupancy and history endpoints
- [ ] Replace payments mock data with transaction and invoice endpoints
- [ ] Implement staff roles and permission checks
- [ ] Add audit logging for membership, payment, attendance, and staff actions
- [ ] Publish OpenAPI docs
- [ ] Add health/readiness endpoints and structured logs

## 11. Recommended immediate next step

Start with this first vertical slice:

1. Auth
2. Current user profile and permissions
3. Members list and member detail
4. Attendance check-in/check-out
5. Payments list and create payment

That slice unlocks the highest-value front desk workflows while establishing the architecture the rest of the app can grow on.
