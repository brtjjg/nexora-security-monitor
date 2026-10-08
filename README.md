# Nexora Security Monitor

Read-only security dashboard for Nexora Academy staff.

## Live
- Production: https://nexora-security-monitor.vercel.app

## Purpose
Watch for suspicious activity on the Nexora API — blocked IPs, probe attempts, rate-limit violations, failed logins — in real time.

## Architecture
- **Frontend**: static SPA (HTML + CSS + vanilla JS) — this repo
- **Backend**: shared Nexora API at `https://nexora-api-sskg.onrender.com/api`
- **Auth**: session cookie shared with the Academy site
- **Database**: same Postgres as the main API

## Access
Only users with these roles can log in:
- `admin` — full monitoring access
- `super_admin` — full monitoring + purge

Any other role is rejected.

## What it shows
- **Dashboard** — KPI cards (events in last 24h, severity breakdown, blocked IP count) and top source IPs
- **Security Events** — every suspicious request, filterable by severity and type
- **Blocked IPs** — auto-blocked and manually blocked IPs, with one-click unblock
- **Thresholds** — tune auto-block limits live (no redeploy needed)

## What it does NOT do
- ❌ Never modifies users, courses, transactions
- ❌ Never approves, rejects, or pays anything
- ❌ Never launches attacks against anyone
- ✅ Only reads security logs and manages blocks

## Backend endpoints used
- `GET    /api/auth/me`
- `POST   /api/auth/login`
- `POST   /api/auth/logout`
- `GET    /api/security/summary`
- `GET    /api/security/events`
- `GET    /api/security/event-types`
- `GET    /api/security/blocked`
- `POST   /api/security/blocked`
- `DELETE /api/security/blocked/:ip`
- `GET    /api/security/thresholds`
- `PUT    /api/security/thresholds/:key`
- `POST   /api/security/purge`

## Deploy
Vercel project: `nexora-security-monitor`, connected to `main` branch. Push to main → auto-deploy.

## Files
- `index.html` — shell (login + sidebar + content root)
- `monitor.css` — dark theme styling
- `monitor.js` — all app logic
- `vercel.json` — deploy config
