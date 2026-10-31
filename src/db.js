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

-- Culture / engagement
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS remote_allowed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS mood INTEGER;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'office';

-- Device lock: each employee account is bound to one browser/device (hash of a long-lived cookie).
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_label TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_bound_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS users_device ON users (device_hash) WHERE device_hash IS NOT NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_hash TEXT;
-- Each employee may register one mobile and one desktop/laptop device.
CREATE TABLE IF NOT EXISTS user_devices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('mobile', 'desktop')),
  device_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  UNIQUE (user_id, kind)
);
-- Move single-device bindings from the first version into user_devices (idempotent).
INSERT INTO user_devices (user_id, kind, device_hash, label, bound_at)
  SELECT id, CASE WHEN device_label ~ '^(iPhone|iPad|Android)' THEN 'mobile' ELSE 'desktop' END,
         device_hash, device_label, COALESCE(device_bound_at, now())
  FROM users WHERE device_hash IS NOT NULL
  ON CONFLICT DO NOTHING;
UPDATE users SET device_hash = NULL, device_label = NULL, device_bound_at = NULL WHERE device_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_blocks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  device_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kudos (
  id SERIAL PRIMARY KEY,
  from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kudos_to ON kudos (to_user, created_at);
CREATE INDEX IF NOT EXISTS kudos_from ON kudos (from_user, created_at);

CREATE TABLE IF NOT EXISTS kudos_reactions (
  kudos_id INTEGER NOT NULL REFERENCES kudos(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (kudos_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  kind TEXT NOT NULL DEFAULT 'news',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
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

-- Team leads: employees who approve requests and see attendance for their own department.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'lead', 'employee'));

-- Payroll and leave allowances (NULL allowance = company default from settings).
ALTER TABLE users ADD COLUMN IF NOT EXISTS salary DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS annual_leave INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sick_leave INTEGER;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'annual';

-- Official holidays: no check-in is expected and no absence is recorded.
CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "I forgot to check in / out": approved by the owner or the department lead.
CREATE TABLE IF NOT EXISTS attendance_corrections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  check_in_time TEXT,
  check_out_time TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who did what (owner and lead actions).
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log (created_at DESC);

-- Tasks: account managers send client work to a department; the department lead assigns it to a member.
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  client TEXT,
  department TEXT NOT NULL,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  start_date TEXT,
  due_date TEXT,
  assigned_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks (assignee_id, status);
CREATE INDEX IF NOT EXISTS tasks_department ON tasks (department, status);

-- Checklist inside a task (progress = done / total).
CREATE TABLE IF NOT EXISTS task_items (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS task_items_task ON task_items (task_id);

-- Conversation and history on a task (kind 'event' = automatic: created, assigned, moved...).
CREATE TABLE IF NOT EXISTS task_comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'event')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_comments_task ON task_comments (task_id, id);

-- Deliverables on a task: files uploaded to the connected Google Drive, or links (WeTransfer, Frame.io...).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
CREATE TABLE IF NOT EXISTS task_files (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('drive', 'link')),
  drive_id TEXT UNIQUE,
  name TEXT NOT NULL,
  size BIGINT,
  mime TEXT,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_files_task ON task_files (task_id, id);
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
  // Culture
  departments: ['Creative', 'Content', 'Social Media', 'Media Buying', 'Design', 'Video Production', 'Account Management', 'Development', 'Operations'],
  kudos_daily_limit: 3,
  kudos_green: 0,
  // Security: lock each employee to the first device they log in from.
  device_lock: true,
  // Working hours & overtime
  daily_hours: 8,
  overtime_rate: 1.5,
  // Per-department overrides of the check-in windows / work days / hours, e.g.
  // { "Video Production": { early_start: '09:00', ..., work_days: [...], daily_hours: 9 } }
  dept_schedules: {},
  // Leave allowance per year (work days)
  annual_leave_days: 21,
  sick_leave_days: 7,
  // Payroll
  payroll_add_rewards: false,
  // Members of this department (account managers) can send tasks to other departments.
  am_department: 'Account Management',
  // Largest single upload to Google Drive, in MB.
  max_upload_mb: 20480,
  weekly_summary: true,
};

// Settings keys that are derived on read and never stored.
const DERIVED_KEYS = ['holiday_dates'];

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

// Vercel's Neon integration may add a custom prefix (e.g. STORAGE_DATABASE_URL), so accept those too.
function databaseUrl(env = process.env) {
  if (env.DATABASE_URL || env.POSTGRES_URL) return env.DATABASE_URL || env.POSTGRES_URL;
  const key = Object.keys(env)
    .filter((k) => /(^|_)(DATABASE_URL|POSTGRES_URL)$/.test(k) && /^postgres(ql)?:\/\//.test(env[k] || ''))
    .sort((a, b) => Number(b.endsWith('DATABASE_URL')) - Number(a.endsWith('DATABASE_URL')))[0];
  return key ? env[key] : undefined;
}

function connect(url = databaseUrl(), { pgliteDir } = {}) {
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
  const [row, holidays] = await Promise.all([
    db.get(`SELECT value FROM settings WHERE key = 'app'`),
    db.all('SELECT date FROM holidays'),
  ]);
  return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.value) : {}), holiday_dates: holidays.map((h) => h.date) };
}

async function saveSettings(db, settings) {
  const stored = { ...settings };
  for (const k of DERIVED_KEYS) delete stored[k];
  await db.run(
    `INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(stored)],
  );
}

module.exports = { connect, databaseUrl, getSettings, saveSettings, DEFAULT_SETTINGS };
