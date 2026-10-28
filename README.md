# Bahr Network System

Staff attendance and management system for Bahr Network. It covers GPS check-in, green/red/black points, monthly deductions, leave requests and reward payouts.

## Features

**Employees** (mobile-first web app, can be installed to the home screen)
- **GPS check-in / check-out.** Check-in only works within the allowed radius of the office, and inaccurate GPS readings are rejected. Times come from the server clock, so changing the phone's clock has no effect.
- **Check-in windows**, all configurable:
  | Window | Default | Result |
  |---|---|---|
  | Early | 07:00 – 08:00 | 🟢 +1 green point |
  | On time | 08:00 – 10:00 | — |
  | Late | 10:00 – 11:00 | 🔴 1 red penalty |
  | Very late | 11:00 – 12:00 | 🔴 2 red penalties |
  | Closed | after 12:00 | ⚫ black absence if not checked in |
- **Points dashboard** showing the green balance, this month's red and black points, and the live monthly deduction (`Red × 250 EGP + Black × 1,000 EGP`).
- **Swap points:** use 1 green point to remove 1 red penalty from the current month.
- **Reward requests:** turn green points into money (`points × green value`), paid out via InstaPay, Vodafone Cash or cash.
- **Leave requests:** approved leave days are never counted as absences.
- **History:** monthly attendance and a full log of points.

**Owner / manager**
- **Today board:** who checked in, at what time, their status and their distance from the office. Attendance can be recorded manually when someone's GPS fails.
- **Staff:** add, edit, deactivate and reset passwords. Each person has a history page.
- **Adjust points:** add or remove green, red or black points. A reason is required.
- **Approve or reject leave.** Approving leave removes any black absences already recorded for those days.
- **Reward requests:** mark as paid, or reject (the points go back to the employee).
- **Monthly report:** present, early, on-time, late, leave, green, red and black counts, plus deductions per employee. Can be exported to CSV for Excel.
- **Settings:** office location (with a "use my current location" button), radius, GPS accuracy, check-in times, work days, money values and currency.

Absences are recorded automatically. Every 5 minutes, each work day an active employee missed (no check-in and no approved leave) becomes 1 black point.

## Tech

- Node.js ≥ 22.13 and Express 5
- SQLite through Node's built-in `node:sqlite`, so no native modules need to be compiled
- Vanilla JS single-page frontend in `public/`, with no build step
- Passwords are hashed with scrypt. Sessions use HttpOnly cookies, logins are rate-limited, and JSON-only writes protect against CSRF.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000. On the first visit you create the owner account. Then go to **Settings** and set the office location.

Environment variables:

| Var | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `DB_FILE` | `data/bahr.db` | SQLite database file |
| `COOKIE_SECURE` | unset | Set to `1` when served over HTTPS |

> **HTTPS is required in production.** Browsers only allow GPS location on `https://` sites (or on `localhost`). Deploy behind HTTPS (Nginx + Let's Encrypt, Caddy, Render, Railway, etc.) and set `COOKIE_SECURE=1`.

## Tests

```bash
npm test
```

## Project layout

```
src/
  server.js   entry point + absence job timer
  app.js      HTTP API (auth, employee, owner routes)
  logic.js    rules: check-in windows, geofence, balances, absences, monthly report
  db.js       schema + settings
  auth.js     password hashing, sessions, login rate limit
  time.js     timezone/date helpers
public/       frontend (index.html, app.js, styles.css)
test/         API + rules tests
```
