# Grizzly Estimator

Web-first MVP for electrical walkthrough capture, AI-assisted takeoff, proposal generation, direct provider notifications, customer approval, and manual Housecall Pro handoff.

## What is implemented

- Mobile-friendly intake and walkthrough workspace
- Browser camera/video capture with fallback phone upload input
- Supabase-backed project/session storage plus private object storage for uploads
- Price-book-backed estimating engine using the local `2026 Price Book.csv` file when available
- Proposal variants with shareable customer routes, owner review alerts, customer delivery, and typed signature capture
- Env-driven Housecall Pro API sync layer with clear failure states when credentials are missing
- Native iPhone capture scaffold in `ios/GrizzlyCapture`
- Unit tests for the estimating rules

## Local setup

```bash
npm install
npm run dev
```

Required authentication environment variables:

```bash
APP_ADMIN_EMAIL="owner@grizzlyelectric.com"
APP_ADMIN_PASSWORD="choose-a-strong-password"
```

Optional authentication hardening:

```bash
APP_ADMIN_PASSWORD_HASH="scrypt:your-salt:your-derived-hex"
APP_SESSION_SECRET="long-random-session-secret"
```

Application environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://your-project-id.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
SUPABASE_PROJECTS_TABLE="app_projects"
SUPABASE_SESSIONS_TABLE="app_sessions"
SUPABASE_UPLOADS_BUCKET="project-attachments"
OWNER_APPROVAL_EMAIL_RECIPIENTS="jaime@grizzlyelectrical.net,carterbarns@grizzlyelectrical.net"
OWNER_APPROVAL_SMS_RECIPIENTS="469-716-9870,469-422-2982"
RESEND_API_KEY="re_xxxxxxxxx"
RESEND_FROM_EMAIL="Grizzly Estimator <notifications@grizzlyelectrical.net>"
TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
TWILIO_AUTH_TOKEN="your-twilio-auth-token"
TWILIO_PHONE_NUMBER="+14690000000"
PRICE_BOOK_PATH="C:\\Users\\carte\\OneDrive\\Documents\\Grizzly\\Price Lists\\2026 Price Book.csv"
HCP_API_KEY="your-housecall-pro-api-key"
HCP_API_BASE_URL="https://api.housecallpro.com/public/v1"
HCP_AUTH_SCHEME="Bearer"
HCP_CUSTOMERS_PATH="/customers"
HCP_CUSTOMER_TEMPLATE="/customers/{customerId}"
HCP_CUSTOMER_ADDRESSES_TEMPLATE="/customers/{customerId}/addresses"
HCP_ESTIMATES_PATH="/estimates"
HCP_ESTIMATE_TEMPLATE="/estimates/{estimateId}"
HCP_JOBS_PATH="/jobs"
HCP_JOB_TEMPLATE="/jobs/{jobId}"
HCP_JOB_ATTACHMENTS_TEMPLATE="/jobs/{jobId}/attachments"
HCP_CREATE_JOB_ON_SYNC="false"
HCP_ALLOW_ESTIMATE_REEXPORT_ON_CHANGE="false"
HCP_ALLOW_JOB_REEXPORT_ON_CHANGE="false"
```

If `APP_ADMIN_PASSWORD_HASH` is set, it takes precedence over `APP_ADMIN_PASSWORD`. `APP_SESSION_SECRET` is recommended; when omitted, the app derives a session secret from the configured admin credentials.

If `PRICE_BOOK_PATH` is not set, the app defaults to the path above and falls back to a seeded mini price book if the CSV cannot be read.

The Housecall Pro defaults are wired from the currently published public API docs and can be overridden with environment variables if your account uses a different base path, auth scheme, or endpoint template.

## Supabase setup

1. Create a Supabase project.
2. Run the SQL in `supabase/migrations/20260420_001_app_storage.sql`.
3. Copy the project URL into `NEXT_PUBLIC_SUPABASE_URL`.
4. Copy the service-role key into `SUPABASE_SERVICE_ROLE_KEY`.
5. Keep the `project-attachments` bucket private.
6. If you need to carry forward local repo data, run:

```bash
npm run migrate:local-data
```

## Commands

```bash
npm run dev
npm run lint
npm run test
npm run build
npm run migrate:local-data
```

## Notes

- New projects are saved to the protected Supabase project table so proposal links keep working across reloads.
- Uploaded walkthroughs, blueprints, photos, and notes are stored in a private Supabase Storage bucket and served back only to authenticated workspace sessions.
- New estimate drafts send direct owner approval notifications.
- Owner approval happens inside the workspace by sending the selected proposal to the customer.
- Customer delivery sends direct customer email plus customer SMS.
- Notification delivery uses:
  - Resend for email
  - Twilio for SMS
- Owner approval sends to:
  - `jaime@grizzlyelectrical.net`
  - `carterbarns@grizzlyelectrical.net`
  - `469-716-9870`
  - `469-422-2982`
- `OWNER_APPROVAL_EMAIL_RECIPIENTS` and `OWNER_APPROVAL_SMS_RECIPIENTS` can still override those defaults if needed later.
- Notification statuses remain `queued`, `sent`, and `failed`, and the resend endpoint only allows retry after failure unless manually overridden.
- Customers approve from the signed proposal link with a typed signature.
- The Housecall Pro sync layer now reuses verified customer matches, remembers remote IDs in project state, and stops when a changed estimate/job would create a duplicate by default.
- Re-running the same sync is replay-safe for already-exported estimates and jobs because the app rechecks stored remote IDs and fingerprints before creating anything new.
- Optional `HCP_ALLOW_ESTIMATE_REEXPORT_ON_CHANGE` and `HCP_ALLOW_JOB_REEXPORT_ON_CHANGE` flags are off by default; only enable them if your team is comfortable creating replacement records in Housecall Pro when a draft changes after export.
- Dashboard routes, upload routes, and Housecall Pro sync are protected by sign-in. Customer proposal links use signed share tokens.
- The web app is intentionally human-in-the-loop. Commercial measurement prompts and `>40A` ampacity review gates are enforced in the estimate engine.
- Direct notification setup:
  1. Add a verified sending identity in Resend and set `RESEND_FROM_EMAIL`.
  2. Add your Twilio account SID, auth token, and sending phone number.
  3. Make sure customer records include both email and phone before sending.
  4. Use the workspace resend control if either email or SMS fails.
