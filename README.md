# Customer Complaint System

A secure customer complaint management app built with React + Vite on the frontend and Express on the backend.

## Features

- Secure user registration and login
- Password hashing with bcrypt and a backend pepper
- TOTP-based multi-factor authentication
- Role-aware access for customer, support, manager, and administrator users
- Responsive role-aware vertical dashboard navigation
- Complaint activity notifications, staff reports, profile, and dashboard preferences
- Complaint submission and role-based complaint visibility
- Staff complaint status updates and response logging
- Audit logging and admin security report
- PostgreSQL-backed users, complaints, sessions, password recovery, and audit history
- Administrator-only encrypted backup and recovery
- Explicit in-memory mode for local development and tests

## Project structure

- `src/` — React frontend
- `backend/` — Express API server
- `.env.example` — root env example file
- `backend/.env.example` — backend env example file

## Setup

1. Install dependencies:

   npm install
   cd backend && npm install

2. Set environment variables:

   Copy the example files and update values as needed.

   - `.env.example`
   - `backend/.env.example`

3. Start the app:

   npm run dev:all

   This starts the backend and the frontend together.

4. Open the app:

   http://localhost:5173

## Local auth flow

- Register a customer account from the login screen. Public registration always creates a Customer, regardless of any role value sent to the API.
- Save the generated TOTP secret in your authenticator app.
- Customers, managers, and administrators all use the same sign-in form with email, password, and OTP. There is no separate administrator login or public administrator signup.
- Use **Forgot password or authenticator?** to request an email recovery link. The link expires after 30 minutes and resets both the password and authenticator key.

## Administrator and manager accounts

There is no administrator signup page. Public registration creates customer accounts only; the initial administrator must be bootstrapped from the backend machine using its local API and a one-time setup key. Generate a strong key and store it only in `backend/.env`:

   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"

Set the result as `ADMIN_SETUP_KEY` in `backend/.env`, then restart the backend. From a terminal on that same machine, send a request to `http://127.0.0.1:5000/api/bootstrap-admin` with JSON fields `fullName`, `email`, `password`, and `setupKey`. For example:

   curl.exe -X POST http://127.0.0.1:5000/api/bootstrap-admin -H "Content-Type: application/json" -d "{\"fullName\":\"System Administrator\",\"email\":\"admin@example.com\",\"password\":\"Choose-A-Strong-Password\",\"setupKey\":\"YOUR_ADMIN_SETUP_KEY\"}"

The API rejects non-local requests and only permits bootstrap while no administrator exists. Save the returned TOTP setup key for the administrator. Keep the setup key private in `backend/.env`; it cannot be used from the public site or after an administrator exists.

Administrators can create Manager or Administrator accounts from their dashboard. The administrator supplies a temporary password and securely shares it together with the generated authenticator key. Other roles cannot be assigned through this endpoint.

Customers must sign in before submitting a complaint. The API associates each submission with the signed-in customer (it does not trust a name or email supplied in the request), and customers can view only their own complaints. New submissions appear in the shared staff queue, including the Administrator dashboard; use **Refresh** to load complaints submitted since the dashboard was opened. Support, Manager, and Administrator accounts can manage complaints but cannot submit customer complaints.

## Configure account recovery email

Account recovery requires an SMTP account. For local testing with Gmail:

1. Enable 2-Step Verification on the Gmail account you will use to send mail.
2. Create an App Password in your Google Account security settings. Do not use your regular Gmail password.
3. When you run `npm run dev:all` from the project root, copy `.env.example` to the root `.env` and set `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`. If you start the backend from its own folder, use `backend/.env.example` as `backend/.env`. Keep these values private and never commit `.env`.
4. Restart the backend after changing environment variables.
5. On the sign-in form, request a recovery link using the account's registered email. Check the inbox and spam folder.

Recovery email uses `smtp.gmail.com`, port `587`, and STARTTLS (`SMTP_SECURE=false`) by default. Configure `FRONTEND_URL` to the origin that serves the frontend. If SMTP is missing or delivery fails, the API reports an error instead of pretending that mail was sent.

Recovery links are single-use, expire after 30 minutes, and are stored only as SHA-256 hashes. Completing recovery changes the password, replaces the authenticator secret, and invalidates the account's active sessions.

For local development without SMTP, set `RECOVERY_EMAIL_MODE=console` in the environment file used by the backend and restart it. When requested over a loopback connection, the response will include a one-time link in the browser. The backend disables this mode in production and for non-local connections. SMTP is required for emailed recovery.

## PostgreSQL persistence

Set `DATABASE_URL` in the environment file loaded by the backend to a reachable PostgreSQL connection string, for example `postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require`. On startup, the backend creates the required `ccs_*` tables and indexes. When a database URL is configured but PostgreSQL cannot be reached, startup fails instead of silently switching to volatile memory. Production mode also requires PostgreSQL. Set `REQUIRE_DATABASE=true` to require PostgreSQL in other environments. The intentional memory store is available for tests or local-only use with `STORAGE_MODE=memory`; its data is lost on restart.

Administrators can create an encrypted JSON backup from **Settings → Database backup and recovery**. Choose a strong passphrase of at least 12 characters and keep it separate from the downloaded file. The backup includes user credentials and authenticator secrets, complaints, and audit history, encrypted with AES-256-GCM and a scrypt-derived key. Restore requires the backup file, its passphrase, and typing `RESTORE`; it replaces current records and invalidates every session and pending recovery link. Backups cannot be recovered without their passphrase.

Back up the active in-memory data before switching to PostgreSQL if it must be preserved. PostgreSQL enables durable storage only for data written after its connection is configured; it does not automatically migrate data from an already-running in-memory process.
