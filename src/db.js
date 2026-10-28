const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'employee')),
  phone TEXT,
  job_title TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  check_in_time TEXT NOT NULL,
  check_in_at TEXT NOT NULL,
  status TEXT NOT NULL,
  lat REAL,
  lng REAL,
  accuracy REAL,
  distance_m REAL,
  check_out_time TEXT,
  check_out_at TEXT,
  UNIQUE (user_id, work_date)
);

-- Every green / red / black change is an event; balances are sums of deltas.
-- work_date is the day the event counts towards in monthly reports.
CREATE TABLE IF NOT EXISTS points (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('green', 'red', 'black')),
  delta INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT,
  ref_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS points_user_date ON points (user_id, work_date);
CREATE UNIQUE INDEX IF NOT EXISTS points_one_absence ON points (user_id, work_date) WHERE source = 'absent';

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reward_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('instapay', 'vodafone_cash', 'cash')),
  payout_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected', 'cancelled')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const DEFAULT_SETTINGS = {
  company_name: 'Bahr Network',
  timezone: 'Africa/Cairo',
  currency: 'EGP',
  // Geofence: the office location staff must be near to check in.
  office_lat: null,
  office_lng: null,
  radius_m: 200,
  max_accuracy_m: 150,
  // Check-in windows (local time):
  // [early_start, early_end) -> early, +1 green
  // [early_end, late_after)  -> on time
  // [late_after, very_late_after) -> late, +1 red
  // [very_late_after, close) -> very late, +very_late_reds red
  // after close -> check-in closed (day becomes a black absence)
  early_start: '07:00',
  early_end: '08:00',
  late_after: '10:00',
  very_late_after: '11:00',
  close: '12:00',
  very_late_reds: 2,
  // 0 = Sunday ... 6 = Saturday. Default: Saturday to Thursday.
  work_days: [6, 0, 1, 2, 3, 4],
  red_value: 250,
  black_value: 1000,
  green_value: 50,
  min_reward_points: 10,
};

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

function getSettings(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get();
  return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.value) : {}) };
}

function saveSettings(db, settings) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify(settings),
  );
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, getSettings, saveSettings, tx, DEFAULT_SETTINGS };
