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

**Culture & engagement** (built for a creative / marketing agency)
- **Team Wall:** anyone can send **kudos** to a teammate (💡 Creative Spark, 🤝 Team Player, 🚀 Extra Mile, 🎯 Client Hero, 😄 Good Vibes, 🧠 Mentor) and react with emojis. There's a daily limit, and the owner can optionally award green points per kudos.
- **Announcements** from the owner (news, celebrations, events, alerts), with pinning to everyone's home page.
- **Departments** with a monthly **department battle** leaderboard, plus a "most appreciated" ranking.
- **XP levels** (Fresh Intern → Legend) and **badges** (Early Bird, On Fire, Flawless Month, Kudos Magnet, …), with a celebration when you level up or unlock one.
- **Mood check-in** after arriving. The owner sees team mood by department and gets a low-energy warning.
- **Birthdays & work anniversaries** shown to the whole team, with a personal birthday celebration.
- **Remote check-in** per person (shoots, client visits, WFH): no geofence, and the distance is still recorded.
- Thought-of-the-day, confetti, emoji bursts, count-up numbers, staggered animations, soft sounds and haptics. Sound can be turned off in Account, and everything respects reduced-motion settings.

**Experience**
- Modern dashboard UI with a collapsible sidebar, a live activity feed, a 7-day attendance chart and a filterable attendance board.
- **Dark mode** (follows the system, or choose in Account).
- **Command palette:** press `⌘K` / `Ctrl+K` or `/` to jump to any page, employee or action.
- **Notifications:** the owner sees pending requests; employees see decisions on their leave and reward requests.
- **Leaderboard** of the month's green points, a personal attendance calendar, an on-time streak and progress toward the next reward.
- **Installable app (PWA)** on Android, iPhone and desktop:
  - Home-screen icon, full-screen and safe-area aware (notch, home bar), app shortcuts and an app-icon badge.
  - Works offline (cached app shell). Dialogs open as bottom sheets, and the browser never zooms into text fields on phones.
- **Push notifications** (Web Push, VAPID keys generated automatically on first use, or set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`):
  - Morning check-in reminders, kudos, leave and reward decisions, owner point adjustments and announcements.
  - Owners also get new requests and blocked sign-ins.
  - On iPhone (iOS 16.4+), notifications work once the app is added to the Home Screen.

Absences are recorded automatically. Each work day an active employee missed (no check-in and no approved leave) becomes 1 black point.

## Tech

- Node.js ≥ 20 and Express 5
- PostgreSQL. In production that's a hosted Postgres such as Neon via `DATABASE_URL`. Locally, with no `DATABASE_URL`, it uses the embedded PGlite automatically, so there's nothing to install.
- Vanilla JS single-page frontend in `public/`, with no build step
- Passwords are hashed with scrypt. Sessions use HttpOnly cookies, logins are rate-limited, and JSON-only writes protect against CSRF.
- **Device lock** (on by default, Settings → Team & culture):
  - Each employee account gets **one phone and one laptop/computer**: the first of each it signs in from, through a long-lived HttpOnly device cookie. Only the cookie's SHA-256 hash is stored.
  - Any other device is refused, and one device can't be bound to two employees. This stops colleagues signing in for each other.
  - Sessions only work together with their device cookie. Blocked attempts are logged and shown to the owner.
  - The owner can reset the phone, the laptop or both from Staff, for example when someone changes devices or clears their browser data.
  - Owner accounts are never locked and can sign in from any device.

## Deploy on Vercel

1. Import the GitHub repo into Vercel. No build settings are needed; `vercel.json` configures everything.
2. In the Vercel project, open **Storage → Create Database → Neon (Postgres)** and connect it to the project. This adds `DATABASE_URL` automatically.
   - Or create a free database at [neon.tech](https://neon.tech) and add its connection string as the `DATABASE_URL` environment variable.
3. Optional: add a `CRON_SECRET` environment variable (any random string). It protects the daily absence job.
4. **Redeploy** so the new environment variables are picked up.
5. Open the site. On the first visit you create the owner account. Then go to **Settings** and set the office location.

Tables are created automatically on first request. Absences are recorded whenever the app is used (at most every 5 minutes). Once a day, Vercel Cron calls `/api/cron/daily` (`vercel.json`, 04:30 UTC, about 06:30–07:30 Cairo time): it records absences and sends the morning check-in reminder.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000. Data is stored in `data/pglite` unless `DATABASE_URL` is set.

| Var | Default | |
|---|---|---|
| `DATABASE_URL` | unset → embedded PGlite | Postgres connection string |
| `PORT` | `3000` | |
| `COOKIE_SECURE` | unset (always on with Vercel) | Set to `1` when served over HTTPS |
| `CRON_SECRET` | unset | If set, `/api/cron/absences` requires `Authorization: Bearer <secret>` |

> Browsers only allow GPS location on `https://` sites (or on `localhost`). Vercel sites are HTTPS by default.

## Tests

```bash
npm test                                                        # embedded PGlite
TEST_DATABASE_URL=postgres://user@host:5432/empty_db npm test   # real Postgres
```

## Project layout

```
api/
  index.js    Vercel serverless entry
src/
  server.js   local server + absence job timer
  app.js      HTTP API (auth, employee, owner routes)
  logic.js    rules: check-in windows, geofence, balances, absences, monthly report
  db.js       Postgres / PGlite connection, schema, settings
  auth.js     password hashing, sessions, login rate limit
  time.js     timezone/date helpers
public/       frontend (index.html, app.js, styles.css)
test/         API + rules tests
```
