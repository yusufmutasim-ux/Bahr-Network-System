// Postgres access. In production (Vercel) this talks to a hosted Postgres such as Neon via DATABASE_URL.
// Without DATABASE_URL it falls back to PGlite (embedded Postgres) for local development and tests.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'employee')),
  phone TEXT,
  job_title TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  check_in_time TEXT NOT NULL,
  check_in_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  distance_m DOUBLE PRECISION,
  check_out_time TEXT,
  check_out_at TIMESTAMPTZ,
  UNIQUE (user_id, work_date)
);

-- Every green / red / black change is an event; balances are sums of deltas.
-- work_date is the day the event counts towards in monthly reports.
CREATE TABLE IF NOT EXISTS points (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('green', 'red', 'black')),
  delta INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT,
  ref_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS points_user_date ON points (user_id, work_date);
CREATE UNIQUE INDEX IF NOT EXISTS points_one_absence ON points (user_id, work_date) WHERE source = 'absent';

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reward_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('instapay', 'vodafone_cash', 'cash')),
  payout_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected', 'cancelled')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

// SQL is written with `?` placeholders and converted to Postgres' $1, $2, ...
const toPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

// Wraps anything with `query(sql, params)` (a pg Pool/Client or PGlite) in a small helper API.
function wrap(conn, txFn) {
  const db = {
    async all(sql, params = []) {
      return (await conn.query(toPg(sql), params)).rows;
    },
    async get(sql, params = []) {
      return (await conn.query(toPg(sql), params)).rows[0];
    },
    async run(sql, params = []) {
      const r = await conn.query(toPg(sql), params);
      return { changes: Number(r.rowCount ?? r.affectedRows ?? 0), rows: r.rows };
    },
    tx: txFn || ((fn) => fn(db)),
  };
  return db;
}

function connect(url = process.env.DATABASE_URL || process.env.POSTGRES_URL, { pgliteDir } = {}) {
  let impl;
  if (url) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: url, max: 5 });
    impl = {
      query: (sql, params) => pool.query(sql, params),
      exec: (sql) => pool.query(sql),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(client);
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    const pg = new PGlite(pgliteDir);
    impl = {
      query: (sql, params) => pg.query(sql, params),
      exec: (sql) => pg.exec(sql),
      transaction: (fn) => pg.transaction(fn),
      close: () => pg.close(),
    };
  }

  // Create tables once per process (retried if it fails, e.g. the database was briefly unreachable).
  // The advisory lock stops parallel cold starts racing on CREATE.
  let ready = null;
  const ensureReady = () => {
    ready ||= impl
      .transaction(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(724001)');
        await (c.exec ? c.exec(SCHEMA) : c.query(SCHEMA));
      })
      .catch((err) => {
        ready = null;
        throw err;
      });
    return ready;
  };

  const tx = async (fn) => {
    await ensureReady();
    return impl.transaction((c) => fn(wrap(c)));
  };
  const base = wrap(
    {
      async query(sql, params) {
        await ensureReady();
        return impl.query(sql, params);
      },
    },
    tx,
  );
  base.ready = ensureReady();
  base.ready.catch(() => {});
  base.close = impl.close;
  return base;
}

async function getSettings(db) {
  const row = await db.get(`SELECT value FROM settings WHERE key = 'app'`);
  return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.value) : {}) };
}

async function saveSettings(db, settings) {
  await db.run(
    `INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(settings)],
  );
}

module.exports = { connect, getSettings, saveSettings, DEFAULT_SETTINGS };
