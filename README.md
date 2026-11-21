# Customer Complaint System

A secure customer complaint management app built with React + Vite on the frontend and Express on the backend.

## Features

- Secure user registration and login
- Password hashing with bcrypt and a backend pepper
- TOTP-based multi-factor authentication
- Role-aware access for customer, support, manager, and administrator users
- Complaint submission and role-based complaint visibility
- Staff complaint status updates and response logging
- Audit logging and admin security report
- In-memory fallback for local development when no database is configured

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

- Register a new account from the login screen.
- Save the generated TOTP secret in your authenticator app.
- Sign in using email, password, and OTP.

## Notes

- The app defaults to an in-memory store when no valid PostgreSQL connection is available.
- For a production deployment, configure a real `DATABASE_URL` and replace the fallback storage with persistent database-backed models.
