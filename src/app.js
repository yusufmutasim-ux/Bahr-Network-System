const path = require('node:path');
const express = require('express');
const { getSettings, saveSettings } = require('./db');
const { localNow, addDays, toMinutes, eachDate, isDate, isTime, isMonth } = require('./time');
const {
  RuleError,
  distanceMeters,
  isWorkDay,
  classifyCheckIn,
  checkGeofence,
  addPoints,
  balances,
  balancesByUser,
  hasApprovedLeave,
  runAbsenceJob,
  monthReport,
  scheduleFor,
  workedMinutes,
  leaveUsage,
  LEAVE_TYPES,
  payroll,
} = require('./logic');
const auth = require('./auth');
const { registerCulture } = require('./culture');
const { registerTasks, remindDueTasks } = require('./tasks');
const { registerClients } = require('./clients');
const { registerReports } = require('./reports');
const { resolveMapLink } = require('./maplink');
const push = require('./push');
const drive = require('./drive');

const PAYOUT_METHODS = ['instapay', 'vodafone_cash', 'cash'];
const ROLES = ['owner', 'lead', 'employee'];
const LEAVE_LABEL = { annual: 'Annual leave', sick: 'Sick leave', unpaid: 'Unpaid leave' };
// Fixed-date official holidays in Egypt (Islamic holidays move every year, so they're added by hand).
const EGYPT_HOLIDAYS = [
  ['01-07', 'Coptic Christmas'],
  ['01-25', 'Revolution Day (25 January)'],
  ['04-25', 'Sinai Liberation Day'],
  ['05-01', 'Labour Day'],
  ['06-30', '30 June Revolution'],
  ['07-23', 'Revolution Day (23 July)'],
  ['10-06', 'Armed Forces Day'],
];
const ABSENCE_JOB_INTERVAL_MS = 5 * 60 * 1000;

function fail(message, status = 400, code = undefined) {
  throw new RuleError(message, status, code);
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// Optional numbers from forms: '' / null clears the value.
function optNum(v, min, max, label) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) fail(`${label} must be between ${min} and ${max}`);
  return n;
}
const optInt = (v, label) => {
  const n = optNum(v, 0, 365, label);
  if (n != null && !Number.isInteger(n)) fail(`${label} must be a whole number of days`);
  return n;
};
const posInt = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 2 ** 31 ? Number(v) : null);

function createApp(db, { now = () => new Date() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Cross-site forms can't send JSON without a CORS preflight, so requiring it blocks CSRF.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
      return res.status(415).json({ error: 'Content-Type must be application/json' });
    }
    next();
  });

  const settings = () => getSettings(db);
  const localToday = (s) => localNow(s.timezone, now());
  const idParam = (req) => posInt(req.params.id) || fail('Not found', 404);

  // Serverless has no long-running timer, so absences are also recorded lazily on requests (throttled).
  let lastAbsenceRun = 0;
  async function maybeRunAbsences(s) {
    if (Date.now() - lastAbsenceRun < ABSENCE_JOB_INTERVAL_MS) return;
    lastAbsenceRun = Date.now();
    await runAbsenceJob(db, s, now());
  }

  async function requireUser(req, res, next) {
    const user = await auth.sessionUser(db, req);
    if (!user) return res.status(401).json({ error: 'Please log in first' });
    // Sessions from before the device lock existed: sign in once more so this device gets bound.
    if (user.role !== 'owner' && !user.session_device && (await settings()).device_lock) {
      await db.run('DELETE FROM sessions WHERE token = ?', [user.token]);
      return res.status(401).json({ error: 'Please log in again to register this device' });
    }
    delete user.session_device;
    req.user = user;
    next();
  }

  const requireRole = (roles, message) => [
    requireUser,
    (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: message })),
  ];
  const requireOwner = requireRole(['owner'], 'Owner access only');
  // Team leads are employees too: they check in, collect points and request leave like everyone else.
  const requireEmployee = requireRole(['employee', 'lead'], 'Employee access only');
  // Owners manage everyone; leads manage the employees of their own department.
  const requireManager = requireRole(['owner', 'lead'], 'Manager access only');

  // SQL condition limiting rows (joined as `alias`) to the people this manager is responsible for.
  const teamScope = (user, alias = 'u') =>
    user.role === 'owner'
      ? { sql: 'TRUE', params: [] }
      : { sql: `(${alias}.department = ? AND ${alias}.role = 'employee')`, params: [user.department || ''] };

  async function assertManages(user, targetId) {
    const { sql, params } = teamScope(user);
    const row = await db.get(`SELECT u.id FROM users u WHERE u.id = ? AND ${sql}`, [targetId, ...params]);
    if (!row) fail('Not found', 404);
  }

  // Owners and the department's lead hear about new requests.
  async function notifyManagers(employee, payload) {
    const rows = await db.all(
      `SELECT id FROM users WHERE active = 1 AND id <> ?
         AND (role = 'owner' OR (role = 'lead' AND ? = 'employee' AND department IS NOT NULL AND department = ?))`,
      [employee.id, employee.role, employee.department || ''],
    );
    return push.notifyUsers(db, rows.map((r) => r.id), payload);
  }

  // Activity log of owner / lead actions. Never breaks the action itself.
  async function audit(actor, action, detail = null, targetUserId = null) {
    try {
      await db.run('INSERT INTO audit_log (actor_id, action, target_user_id, detail) VALUES (?, ?, ?, ?)', [
        actor?.id || null, action, targetUserId, detail == null ? null : String(detail).slice(0, 500),
      ]);
    } catch (err) {
      console.error('[audit] failed', err.message);
    }
  }

  // Locks the user's row so concurrent balance checks (redeem, rewards, adjustments) can't double-spend.
  const lockUser = (t, userId) => t.get(`SELECT id FROM users WHERE id = ? AND role <> 'owner' FOR UPDATE`, [userId]);

  // ---------- Public ----------

  app.get('/api/time', async (req, res) => {
    const s = await settings();
    res.json({ ...localToday(s), timezone: s.timezone, company_name: s.company_name });
  });

  app.get('/api/setup', async (req, res) => {
    const [{ n }, s] = await Promise.all([db.get('SELECT COUNT(*) AS n FROM users'), settings()]);
    res.json({ needsSetup: Number(n) === 0, company_name: s.company_name });
  });

  app.post('/api/setup', async (req, res) => {
    const name = str(req.body.name, 80);
    const username = str(req.body.username, 40);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!name || !/^[\w.@-]{3,40}$/.test(username)) fail('Enter a name and a username (3+ letters, no spaces)');
    if (password.length < 6) fail('Password must be at least 6 characters');
    const userId = await db.tx(async (t) => {
      await t.get('SELECT pg_advisory_xact_lock(724002)');
      if (Number((await t.get('SELECT COUNT(*) AS n FROM users')).n) > 0) fail('System is already set up', 409);
      const s = await getSettings(t);
      const companyName = str(req.body.company_name, 80);
      if (companyName) await saveSettings(t, { ...s, company_name: companyName });
      const row = await t.get(
        `INSERT INTO users (name, username, password_hash, role, start_date) VALUES (?, ?, ?, 'owner', ?) RETURNING id`,
        [name, username, auth.hashPassword(password), localToday(s).date],
      );
      return row.id;
    });
    const session = await auth.createSession(db, userId, auth.ensureDevice(req, res));
    auth.setSessionCookie(res, session.token, session.expires);
    res.status(201).json({ ok: true });
  });

  app.post('/api/login', async (req, res) => {
    const username = str(req.body.username, 40);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (auth.loginBlocked(key)) fail('Too many failed attempts. Try again in 15 minutes.', 429);
    const user = await db.get(
      'SELECT id, role, password_hash, active, device_hash FROM users WHERE lower(username) = lower(?)',
      [username],
    );
    if (!user || !user.active || !auth.verifyPassword(password, user.password_hash)) {
      auth.recordLoginFailure(key);
      fail('Wrong username or password', 401);
    }
    auth.clearLoginFailures(key);
    const device = auth.ensureDevice(req, res);
    const label = auth.deviceLabel(req.headers['user-agent']);
    const s = await settings();
    // Owners/managers can sign in from anywhere; only employees are device-locked.
    if (user.role !== 'owner' && s.device_lock) await checkDevice(user, device, label, auth.deviceKind(req));
    const session = await auth.createSession(db, user.id, device);
    auth.setSessionCookie(res, session.token, session.expires);
    res.json({ ok: true });
  });

  // Each employee gets one mobile slot and one desktop slot. The first phone and the first
  // laptop/PC they sign in from are registered; any other device is refused, and a device can
  // belong to only one employee (stops signing in on a colleague's behalf).
  async function checkDevice(user, device, label, kind) {
    const block = async (reason, message) => {
      await db.run('INSERT INTO device_blocks (user_id, reason, device_label) VALUES (?, ?, ?)', [user.id, reason, label]);
      const who = await db.get('SELECT name FROM users WHERE id = ?', [user.id]);
      await push.notifyRole(db, 'owner', {
        title: '🔒 Blocked sign-in',
        body: `${who?.name || 'An employee'}'s account was used on an unknown device (${label}).`,
        url: '/#/employees', tag: `device-${user.id}`,
      });
      fail(message, 403, 'device_locked');
    };
    const known = await db.get('SELECT id, user_id FROM user_devices WHERE device_hash = ?', [device]);
    if (known) {
      if (known.user_id !== user.id) {
        await block('device_taken', 'This device is already registered to another employee. Sign in from your own phone or laptop.');
      }
      await db.run('UPDATE user_devices SET last_seen_at = now(), label = ? WHERE id = ?', [label, known.id]);
      return;
    }
    const what = kind === 'mobile' ? 'phone' : 'laptop / computer';
    const slot = await db.get('SELECT label FROM user_devices WHERE user_id = ? AND kind = ?', [user.id, kind]);
    if (slot) {
      await block('other_device', `Your account already has a ${what} registered (${slot.label || 'another device'}). Ask your manager to reset it if you changed devices.`);
    }
    const added = await db.run(
      `INSERT INTO user_devices (user_id, kind, device_hash, label, last_seen_at) VALUES (?, ?, ?, ?, now()) ON CONFLICT DO NOTHING`,
      [user.id, kind, device, label],
    );
    if (!added.changes) await block('other_device', `Your account already has a ${what} registered.`);
  }

  app.post('/api/logout', async (req, res) => {
    const user = await auth.sessionUser(db, req);
    if (user) await db.run('DELETE FROM sessions WHERE token = ?', [user.token]);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/me', requireUser, async (req, res) => {
    const { token, ...user } = req.user;
    res.json({ user, company_name: (await settings()).company_name });
  });

  app.post('/api/me/password', requireUser, async (req, res) => {
    const { current, next } = req.body;
    const row = await db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (typeof current !== 'string' || !auth.verifyPassword(current, row.password_hash)) fail('Current password is wrong');
    if (typeof next !== 'string' || next.length < 6) fail('New password must be at least 6 characters');
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [auth.hashPassword(next), req.user.id]);
    await db.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [req.user.id, req.user.token]);
    res.json({ ok: true });
  });

  // Called daily by Vercel Cron (see vercel.json). Requests are also covered lazily by maybeRunAbsences.
  const cronAllowed = (req) => !process.env.CRON_SECRET || req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

  app.get('/api/cron/absences', async (req, res) => {
    if (!cronAllowed(req)) return res.status(401).json({ error: 'Unauthorized' });
    const added = await runAbsenceJob(db, await settings(), now());
    res.json({ added });
  });

  // Daily (Vercel Cron, early morning): record absences and remind staff to check in.
  app.get('/api/cron/daily', async (req, res) => {
    if (!cronAllowed(req)) return res.status(401).json({ error: 'Unauthorized' });
    const s = await settings();
    const t = localToday(s);
    const added = await runAbsenceJob(db, s, now());
    const due = await db.all(
      `SELECT u.id, u.department FROM users u
       WHERE u.role <> 'owner' AND u.active = 1 AND u.start_date <= ?
         AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.user_id = u.id AND a.work_date = ?)
         AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.user_id = u.id AND l.status = 'approved' AND ? BETWEEN l.from_date AND l.to_date)`,
      [t.date, t.date, t.date],
    );
    // Group by schedule so each department is reminded of its own early window.
    const groups = new Map();
    for (const u of due) {
      const us = scheduleFor(s, u.department);
      if (!isWorkDay(t.date, us)) continue;
      const key = `${us.early_start}-${us.early_end}`;
      if (!groups.has(key)) groups.set(key, { us, ids: [] });
      groups.get(key).ids.push(u.id);
    }
    let reminded = 0;
    for (const { us, ids } of groups.values()) {
      reminded += await push.notifyUsers(db, ids, {
        title: 'Good morning ☀️',
        body: `Check in between ${us.early_start} and ${us.early_end} to earn a green point. Have a great day!`,
        url: '/#/', tag: `remind-${t.date}`,
      });
    }
    const tasks = await remindDueTasks(db, t.date);
    let backup = null;
    try {
      backup = await backupToDrive(s);
    } catch (err) {
      console.error('[backup] failed', err.message);
      backup = { error: err.message };
    }
    res.json({ added, reminded, tasks, backup });
  });

  // Weekly (Vercel Cron, Thursday afternoon): a summary of the week for the owners.
  app.get('/api/cron/weekly', async (req, res) => {
    if (!cronAllowed(req)) return res.status(401).json({ error: 'Unauthorized' });
    const s = await settings();
    if (!s.weekly_summary) return res.json({ sent: 0, disabled: true });
    const owners = await db.all(`SELECT id FROM users WHERE role = 'owner' AND active = 1`);
    const summary = await weeklySummary(s);
    const sent = await push.notifyUsers(db, owners.map((o) => o.id), summary.push);
    res.json({ sent, summary: summary.data });
  });

  // ----- Push notifications -----

  app.get('/api/push/key', requireUser, async (req, res) => {
    res.json({ publicKey: (await push.getVapid(db)).publicKey });
  });

  app.post('/api/push/subscribe', requireUser, async (req, res) => {
    if (!(await push.saveSubscription(db, req.user.id, req.body, req.headers['user-agent']))) fail('Invalid subscription');
    res.status(201).json({ ok: true });
  });

  app.post('/api/push/unsubscribe', requireUser, async (req, res) => {
    await db.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [str(req.body.endpoint, 1000), req.user.id]);
    res.json({ ok: true });
  });

  app.post('/api/push/test', requireUser, async (req, res) => {
    const sent = await push.notifyUsers(db, [req.user.id], {
      title: 'Notifications are on 🎉', body: `You'll hear about kudos, requests and reminders here.`, url: '/#/', tag: 'test',
    });
    if (!sent) fail('No device of yours is subscribed yet. Turn notifications on first.');
    res.json({ sent });
  });

  // ---------- Employee ----------

  app.get('/api/me/dashboard', requireEmployee, async (req, res) => {
    const company = await settings();
    await maybeRunAbsences(company);
    const s = scheduleFor(company, req.user.department);
    const t = localToday(s);
    const [attendance, b, onLeave] = await Promise.all([
      db.get('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?', [req.user.id, t.date]),
      balances(db, req.user.id, t.date.slice(0, 7)),
      hasApprovedLeave(db, req.user.id, t.date),
    ]);
    const red = Math.max(0, b.month.red);
    const black = Math.max(0, b.month.black);
    res.json({
      now: t,
      work_day: isWorkDay(t.date, s),
      holiday: (await db.get('SELECT name FROM holidays WHERE date = ?', [t.date]))?.name || null,
      on_leave: onLeave,
      ...(await attendanceStats(req.user, s, t)),
      check_in_window:
        toMinutes(t.time) < toMinutes(s.early_start) ? 'not_open' : toMinutes(t.time) >= toMinutes(s.close) ? 'closed' : 'open',
      attendance: attendance || null,
      balances: b,
      deductions: {
        red,
        black,
        red_value: s.red_value,
        black_value: s.black_value,
        total: red * s.red_value + black * s.black_value,
      },
      rules: pickRules(s),
    });
  });

  app.post('/api/me/check-in', requireEmployee, async (req, res) => {
    const s = scheduleFor(await settings(), req.user.department);
    const t = localToday(s);
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    const accuracy = req.body.accuracy == null ? NaN : Number(req.body.accuracy);
    // Remote-enabled staff (shoots, client visits, WFH) skip the geofence; distance is still recorded.
    const remote = !!req.user.remote_allowed;
    let distance = null;
    if (remote) {
      if ([lat, lng].every(Number.isFinite) && s.office_lat != null) {
        distance = Math.round(distanceMeters(lat, lng, s.office_lat, s.office_lng));
      }
    } else {
      distance = checkGeofence({ lat, lng, accuracy }, s);
    }
    const mood = Number.isInteger(req.body.mood) && req.body.mood >= 1 && req.body.mood <= 5 ? req.body.mood : null;
    const result = isWorkDay(t.date, s) ? classifyCheckIn(t.time, s) : { status: 'off_day', green: 0, red: 0 };
    const record = await db.tx(async (tx) => {
      await lockUser(tx, req.user.id);
      if (await tx.get('SELECT 1 FROM attendance WHERE user_id = ? AND work_date = ?', [req.user.id, t.date])) {
        fail('You already checked in today', 409);
      }
      const row = await tx.get(
        `INSERT INTO attendance (user_id, work_date, check_in_time, check_in_at, status, lat, lng, accuracy, distance_m, mode, mood)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        [req.user.id, t.date, t.time, now().toISOString(), result.status, Number.isFinite(lat) ? lat : null,
          Number.isFinite(lng) ? lng : null, accuracy || null, distance, remote ? 'remote' : 'office', mood],
      );
      if (result.green) {
        await addPoints(tx, {
          userId: req.user.id, kind: 'green', delta: result.green, workDate: t.date,
          source: 'early', reason: `Early check-in ${t.time}`, refId: row.id,
        });
      }
      if (result.red) {
        await addPoints(tx, {
          userId: req.user.id, kind: 'red', delta: result.red, workDate: t.date,
          source: 'late', reason: `Late check-in ${t.time}`, refId: row.id,
        });
      }
      return row;
    });
    res.status(201).json({ attendance: record, green: result.green, red: result.red });
  });

  app.post('/api/me/check-out', requireEmployee, async (req, res) => {
    const t = localToday(await settings());
    const row = await db.get(
      `UPDATE attendance SET check_out_time = ?, check_out_at = ?
       WHERE user_id = ? AND work_date = ? AND check_out_time IS NULL RETURNING *`,
      [t.time, now().toISOString(), req.user.id, t.date],
    );
    if (!row) {
      const existing = await db.get('SELECT 1 FROM attendance WHERE user_id = ? AND work_date = ?', [req.user.id, t.date]);
      fail(existing ? 'You already checked out today' : 'You need to check in first', existing ? 409 : 400);
    }
    res.json({ attendance: row });
  });

  // Spend 1 green point to cancel 1 red penalty from the current month.
  app.post('/api/me/redeem', requireEmployee, async (req, res) => {
    const t = localToday(await settings());
    await db.tx(async (tx) => {
      await lockUser(tx, req.user.id);
      const b = await balances(tx, req.user.id, t.date.slice(0, 7));
      if (b.green < 1) fail('Not enough green points');
      if (b.month.red < 1) fail('No red penalties this month');
      const reason = 'Used 1 green point to remove 1 red penalty';
      await addPoints(tx, { userId: req.user.id, kind: 'green', delta: -1, workDate: t.date, source: 'redeem', reason });
      await addPoints(tx, { userId: req.user.id, kind: 'red', delta: -1, workDate: t.date, source: 'redeem', reason });
    });
    res.json({ ok: true });
  });

  app.get('/api/me/history', requireEmployee, async (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : localToday(await settings()).date.slice(0, 7);
    res.json(await historyFor(req.user.id, month));
  });

  app.get('/api/me/leaves', requireEmployee, async (req, res) => {
    res.json(await db.all('SELECT * FROM leave_requests WHERE user_id = ? ORDER BY id DESC LIMIT 100', [req.user.id]));
  });

  app.get('/api/me/leave-balance', requireEmployee, async (req, res) => {
    const s = await settings();
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : localToday(s).date.slice(0, 4);
    const user = await db.get('SELECT id, department, annual_leave, sick_leave FROM users WHERE id = ?', [req.user.id]);
    res.json({ year, balance: await leaveUsage(db, s, user, year) });
  });

  app.post('/api/me/leaves', requireEmployee, async (req, res) => {
    const { from_date: from, to_date: to } = req.body;
    const type = req.body.type == null ? 'annual' : req.body.type;
    if (!LEAVE_TYPES.includes(type)) fail('Choose a leave type');
    if (!isDate(from) || !isDate(to)) fail('Choose start and end dates');
    if (to < from) fail('End date must be on or after start date');
    if (eachDate(from, to).length > 60) fail('Leave can be at most 60 days');
    if (from.slice(0, 4) !== to.slice(0, 4)) fail('Split leave that crosses into a new year into two requests');
    const s = await settings();
    const row = await db.tx(async (tx) => {
      await tx.get('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
      const user = await tx.get('SELECT id, department, annual_leave, sick_leave FROM users WHERE id = ?', [req.user.id]);
      const us = scheduleFor(s, user.department);
      const days = eachDate(from, to).filter((d) => isWorkDay(d, us)).length;
      if (!days) fail('Those dates are all days off or holidays. No leave is needed.');
      const bal = (await leaveUsage(tx, s, user, from.slice(0, 4)))[type];
      if (bal.left != null && days > bal.left) {
        fail(`Not enough ${LEAVE_LABEL[type].toLowerCase()}: this request needs ${days} work day${days === 1 ? '' : 's'}, you have ${bal.left} left this year.`);
      }
      return tx.get(
        'INSERT INTO leave_requests (user_id, from_date, to_date, reason, type) VALUES (?, ?, ?, ?, ?) RETURNING *',
        [req.user.id, from, to, str(req.body.reason, 500) || null, type],
      );
    });
    await notifyManagers(req.user, {
      title: `🗓️ ${LEAVE_LABEL[type]} request from ${req.user.name}`,
      body: `${from === to ? from : `${from} → ${to}`}${row.reason ? ` · ${row.reason}` : ''}`,
      url: '/#/leaves', tag: `leave-${row.id}`,
    });
    res.status(201).json(row);
  });

  // ----- Attendance corrections ("I forgot to check in / out") -----

  app.get('/api/me/corrections', requireEmployee, async (req, res) => {
    res.json(await db.all('SELECT * FROM attendance_corrections WHERE user_id = ? ORDER BY id DESC LIMIT 100', [req.user.id]));
  });

  app.post('/api/me/corrections', requireEmployee, async (req, res) => {
    const t = localToday(await settings());
    const date = req.body.work_date;
    const inTime = req.body.check_in_time || null;
    const outTime = req.body.check_out_time || null;
    const reason = str(req.body.reason, 500);
    if (!isDate(date)) fail('Choose the day');
    if (date > t.date) fail('You can only correct days that already happened');
    if (date < addDays(t.date, -30)) fail('Corrections are only possible for the last 30 days');
    if (inTime && !isTime(inTime)) fail('Invalid check-in time');
    if (outTime && !isTime(outTime)) fail('Invalid check-out time');
    if (!inTime && !outTime) fail('Enter the check-in or check-out time');
    if (inTime && outTime && outTime <= inTime) fail('Check-out must be after check-in');
    if (!reason) fail('Tell your manager what happened');
    const existing = await db.get('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?', [req.user.id, date]);
    if (existing && inTime) fail('You already checked in that day. Only a missing check-out can be corrected.');
    if (existing && existing.check_out_time) fail('That day already has a check-in and a check-out');
    if (!existing && !inTime) fail('You did not check in that day. Enter your check-in time.');
    if (existing && outTime <= existing.check_in_time) fail(`Check-out must be after your check-in (${existing.check_in_time})`);
    if (await db.get(`SELECT 1 FROM attendance_corrections WHERE user_id = ? AND work_date = ? AND status = 'pending'`, [req.user.id, date])) {
      fail('You already have a pending correction for that day', 409);
    }
    const row = await db.get(
      `INSERT INTO attendance_corrections (user_id, work_date, check_in_time, check_out_time, reason) VALUES (?, ?, ?, ?, ?) RETURNING *`,
      [req.user.id, date, inTime, outTime, reason],
    );
    await notifyManagers(req.user, {
      title: `🛠️ Attendance fix from ${req.user.name}`,
      body: `${date}: ${[inTime && `in ${inTime}`, outTime && `out ${outTime}`].filter(Boolean).join(', ')} · ${reason}`,
      url: '/#/corrections', tag: `correction-${row.id}`,
    });
    res.status(201).json(row);
  });

  app.post('/api/me/corrections/:id/cancel', requireEmployee, async (req, res) => {
    const info = await db.run(
      `UPDATE attendance_corrections SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'`,
      [idParam(req), req.user.id],
    );
    if (!info.changes) fail('Request not found or no longer pending', 404);
    res.json({ ok: true });
  });

  app.get('/api/me/payslip', requireEmployee, async (req, res) => {
    const s = await settings();
    const t = localToday(s);
    const month = isMonth(req.query.month) ? req.query.month : t.date.slice(0, 7);
    if (month > t.date.slice(0, 7)) fail('That month has not started yet');
    const row = (await payroll(db, s, month)).find((r) => r.user_id === req.user.id);
    res.json({ month, company_name: s.company_name, currency: s.currency, red_value: s.red_value, black_value: s.black_value, overtime_rate: s.overtime_rate, row });
  });

  app.post('/api/me/leaves/:id/cancel', requireEmployee, async (req, res) => {
    const info = await db.run(
      `UPDATE leave_requests SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'`,
      [idParam(req), req.user.id],
    );
    if (!info.changes) fail('Request not found or no longer pending', 404);
    res.json({ ok: true });
  });

  app.get('/api/me/rewards', requireEmployee, async (req, res) => {
    res.json(await db.all('SELECT * FROM reward_requests WHERE user_id = ? ORDER BY id DESC LIMIT 100', [req.user.id]));
  });

  // Points are reserved (deducted) when the request is made and refunded if it's rejected or cancelled.
  app.post('/api/me/rewards', requireEmployee, async (req, res) => {
    const s = await settings();
    const t = localToday(s);
    const points = posInt(req.body.points);
    const method = req.body.method;
    const number = str(req.body.payout_number, 40);
    if (!points) fail('Enter the number of points');
    if (points < s.min_reward_points) fail(`Minimum reward request is ${s.min_reward_points} points`);
    if (!PAYOUT_METHODS.includes(method)) fail('Choose a payout method');
    if (method !== 'cash' && !/^[0-9+\s@._a-zA-Z-]{4,40}$/.test(number)) fail('Enter your wallet number / InstaPay address');
    const row = await db.tx(async (tx) => {
      await lockUser(tx, req.user.id);
      if ((await balances(tx, req.user.id, t.date.slice(0, 7))).green < points) fail('Not enough green points');
      const r = await tx.get(
        'INSERT INTO reward_requests (user_id, points, amount, method, payout_number) VALUES (?, ?, ?, ?, ?) RETURNING *',
        [req.user.id, points, points * s.green_value, method, number || null],
      );
      await addPoints(tx, {
        userId: req.user.id, kind: 'green', delta: -points, workDate: t.date,
        source: 'reward', reason: 'Reward request', refId: r.id,
      });
      return r;
    });
    await push.notifyRole(db, 'owner', {
      title: `🎁 Reward request from ${req.user.name}`,
      body: `${row.points} points = ${row.amount} ${s.currency} via ${row.method.replace('_', ' ')}`,
      url: '/#/rewards', tag: `reward-${row.id}`,
    });
    res.status(201).json(row);
  });

  app.post('/api/me/rewards/:id/cancel', requireEmployee, async (req, res) => {
    const s = await settings();
    await db.tx(async (tx) => {
      const r = await tx.get(
        `UPDATE reward_requests SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending' RETURNING *`,
        [idParam(req), req.user.id],
      );
      if (!r) fail('Request not found or no longer pending', 404);
      await refundReward(tx, s, r, null);
    });
    res.json({ ok: true });
  });

  // ---------- Owner ----------

  app.get('/api/admin/overview', requireManager, async (req, res) => {
    const s = await settings();
    await maybeRunAbsences(s);
    const t = localToday(s);
    const date = isDate(req.query.date) ? req.query.date : t.date;
    const scope = teamScope(req.user);
    const [rows, leaves, pending, holiday] = await Promise.all([
      db.all(
        `SELECT u.id, u.name, u.role, u.job_title, u.department, u.start_date, a.check_in_time, a.check_out_time, a.status,
                a.distance_m, a.mood, a.mode
         FROM users u LEFT JOIN attendance a ON a.user_id = u.id AND a.work_date = ?
         WHERE u.role <> 'owner' AND u.active = 1 AND ${scope.sql}
         ORDER BY a.check_in_time IS NULL, a.check_in_time, u.name`,
        [date, ...scope.params],
      ),
      db.all(`SELECT user_id FROM leave_requests WHERE status = 'approved' AND ? BETWEEN from_date AND to_date`, [date]),
      db.get(
        `SELECT (SELECT COUNT(*) FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE l.status = 'pending' AND ${scope.sql}) AS leaves,
                (SELECT COUNT(*) FROM reward_requests WHERE status = 'pending' AND ?) AS rewards,
                (SELECT COUNT(*) FROM attendance_corrections c JOIN users u ON u.id = c.user_id WHERE c.status = 'pending' AND ${scope.sql}) AS corrections`,
        [...scope.params, req.user.role === 'owner', ...scope.params],
      ),
      db.get('SELECT name FROM holidays WHERE date = ?', [date]),
    ]);
    const onLeave = new Set(leaves.map((l) => l.user_id));
    for (const r of rows) {
      if (!r.status) {
        const us = scheduleFor(s, r.department);
        const closed = date < t.date || (date === t.date && toMinutes(t.time) >= toMinutes(us.close));
        if (date < r.start_date) r.status = 'not_started';
        else if (onLeave.has(r.id)) r.status = 'leave';
        else if (holiday) r.status = 'holiday';
        else if (!isWorkDay(date, us)) r.status = 'off_day';
        else r.status = closed ? 'absent' : 'waiting';
      }
      r.worked_minutes = workedMinutes(r);
    }
    const trendFrom = addDays(date, -6);
    const trendRows = await db.all(
      `SELECT a.work_date, COUNT(*) AS present, COUNT(*) FILTER (WHERE a.status IN ('late', 'very_late')) AS late, AVG(a.mood) AS mood,
              COUNT(*) FILTER (WHERE a.status = 'early') AS early
       FROM attendance a JOIN users u ON u.id = a.user_id
       WHERE a.work_date BETWEEN ? AND ? AND ${scope.sql} GROUP BY a.work_date`,
      [trendFrom, date, ...scope.params],
    );
    const trend = eachDate(trendFrom, date).map((d) => {
      const r = trendRows.find((x) => x.work_date === d) || {};
      return {
        date: d, work_day: isWorkDay(d, s), present: Number(r.present || 0), late: Number(r.late || 0),
        early: Number(r.early || 0), mood: r.mood == null ? null : Math.round(Number(r.mood) * 10) / 10,
      };
    });
    const moods = rows.filter((x) => x.mood);
    const byDept = {};
    for (const x of moods) (byDept[x.department || 'Other'] ||= []).push(x.mood);
    const avg = (a) => Math.round((a.reduce((p, c) => p + c, 0) / a.length) * 10) / 10;
    res.json({
      date,
      now: t,
      work_day: isWorkDay(date, s),
      holiday: holiday?.name || null,
      scope: req.user.role === 'owner' ? null : req.user.department || null,
      rows,
      trend,
      mood: {
        avg: moods.length ? avg(moods.map((x) => x.mood)) : null,
        count: moods.length,
        dist: [1, 2, 3, 4, 5].map((m) => moods.filter((x) => x.mood === m).length),
        by_department: Object.entries(byDept).map(([department, m]) => ({ department, avg: avg(m), count: m.length })),
      },
      pending: { leaves: Number(pending.leaves), rewards: Number(pending.rewards), corrections: Number(pending.corrections) },
      rules: pickRules(s),
    });
  });

  // Recent activity across the company for the owner's live feed.
  app.get('/api/admin/feed', requireOwner, async (req, res) => {
    const rows = await db.all(
      `SELECT * FROM (
         (SELECT 'checkin' AS type, a.user_id, u.name, a.status AS detail, a.check_in_at AS at,
                 a.check_in_time AS extra, a.distance_m AS amount
          FROM attendance a JOIN users u ON u.id = a.user_id ORDER BY a.check_in_at DESC LIMIT 25)
         UNION ALL
         (SELECT 'leave', l.user_id, u.name, l.status, l.created_at, l.from_date || ' → ' || l.to_date, NULL
          FROM leave_requests l JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 15)
         UNION ALL
         (SELECT 'reward', r.user_id, u.name, r.status, r.created_at, r.method, r.amount
          FROM reward_requests r JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 15)
         UNION ALL
         (SELECT 'points', p.user_id, u.name, p.kind, p.created_at, p.reason, p.delta
          FROM points p JOIN users u ON u.id = p.user_id WHERE p.source IN ('manual', 'absent', 'redeem')
          ORDER BY p.created_at DESC LIMIT 15)
         UNION ALL
         (SELECT 'device', b.user_id, u.name, b.reason, b.created_at, b.device_label, NULL
          FROM device_blocks b JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC LIMIT 10)
         UNION ALL
         (SELECT 'kudos', k.from_user, f.name, k.category, k.created_at, t.name, NULL
          FROM kudos k JOIN users f ON f.id = k.from_user JOIN users t ON t.id = k.to_user ORDER BY k.created_at DESC LIMIT 15)
       ) feed ORDER BY at DESC LIMIT 40`,
    );
    res.json(rows);
  });

  // Monthly ranking by green points (fewer red / black breaks ties). Visible to everyone as motivation.
  app.get('/api/leaderboard', requireUser, async (req, res) => {
    const s = await settings();
    const month = isMonth(req.query.month) ? req.query.month : localToday(s).date.slice(0, 7);
    const report = (await monthReport(db, s, month)).filter((r) => r.active);
    const rows = report
      .map((r) => ({
        user_id: r.user_id, name: r.name, job_title: r.job_title, department: r.department, green: r.green_month, red: r.red,
        black: r.black, early: r.early, days_present: r.days_present,
        tasks_done: r.tasks_done, tasks_on_time: r.tasks_on_time,
      }))
      .sort((a, b) => b.green - a.green || a.red + a.black * 2 - (b.red + b.black * 2) || b.days_present - a.days_present);
    // Department battle: average score per member so small teams can win too.
    const depts = {};
    for (const r of report) {
      const d = (depts[r.department || 'Other'] ||= { department: r.department || 'Other', members: 0, green: 0, red: 0, black: 0, present: 0, early: 0 });
      d.members += 1;
      d.green += r.green_month;
      d.red += r.red;
      d.black += r.black;
      d.present += r.days_present;
      d.early += r.early;
    }
    const departments = Object.values(depts)
      .map((d) => ({ ...d, score: Math.round(((d.green - d.red - d.black * 2) / d.members) * 10) / 10 }))
      .sort((a, b) => b.score - a.score);
    const kudos = await db.all(
      `SELECT u.id AS user_id, u.name, u.job_title, u.department, COUNT(*) AS kudos
       FROM kudos k JOIN users u ON u.id = k.to_user
       WHERE u.active = 1 AND to_char(k.created_at AT TIME ZONE ?, 'YYYY-MM') = ? GROUP BY u.id ORDER BY kudos DESC, u.name LIMIT 20`,
      [s.timezone, month],
    );
    res.json({ month, rows, departments, kudos: kudos.map((k) => ({ ...k, kudos: Number(k.kudos) })) });
  });

  app.get('/api/admin/users', requireOwner, async (req, res) => {
    const month = localToday(await settings()).date.slice(0, 7);
    const [users, bal] = await Promise.all([
      db.all(
        `SELECT id, name, username, role, phone, job_title, department, birthday, remote_allowed, active, start_date, created_at,
                salary, annual_leave, sick_leave,
                (SELECT COALESCE(json_agg(json_build_object('kind', d.kind, 'label', d.label, 'bound_at', d.bound_at, 'last_seen_at', d.last_seen_at)
                                 ORDER BY d.kind DESC), '[]'::json) FROM user_devices d WHERE d.user_id = users.id) AS devices,
                (SELECT COUNT(*) FROM device_blocks b WHERE b.user_id = users.id AND b.created_at > now() - interval '30 days') AS device_blocks
         FROM users ORDER BY role = 'owner' DESC, active DESC, name`,
      ),
      balancesByUser(db, month),
    ]);
    for (const u of users) {
      if (u.role !== 'owner') u.balances = bal.get(u.id) || { green: 0, month: { green: 0, red: 0, black: 0 } };
    }
    res.json(users);
  });

  app.post('/api/admin/users', requireOwner, async (req, res) => {
    const s = await settings();
    const t = localToday(s);
    const name = str(req.body.name, 80);
    const username = str(req.body.username, 40);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = ROLES.includes(req.body.role) ? req.body.role : 'employee';
    if (!name || !/^[\w.@-]{3,40}$/.test(username)) fail('Enter a name and a username (3+ letters, no spaces)');
    if (password.length < 6) fail('Password must be at least 6 characters');
    // Absences start counting today, or tomorrow if today's check-in window has already closed.
    const defaultStart = toMinutes(t.time) >= toMinutes(s.close) ? addDays(t.date, 1) : t.date;
    const startDate = isDate(req.body.start_date) ? req.body.start_date : defaultStart;
    if (await db.get('SELECT 1 FROM users WHERE lower(username) = lower(?)', [username])) {
      fail('Username already exists', 409);
    }
    const row = await db.get(
      `INSERT INTO users (name, username, password_hash, role, phone, job_title, start_date, department, birthday, remote_allowed,
                          salary, annual_leave, sick_leave)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [name, username, auth.hashPassword(password), role, str(req.body.phone, 30) || null,
        str(req.body.job_title, 80) || null, startDate, str(req.body.department, 40) || null,
        isDate(req.body.birthday) ? req.body.birthday : null, req.body.remote_allowed ? 1 : 0,
        optNum(req.body.salary, 0, 1e8, 'Salary'), optInt(req.body.annual_leave, 'Annual leave'), optInt(req.body.sick_leave, 'Sick leave')],
    );
    await audit(req.user, 'user.create', `${name} (@${username}, ${role})`, row.id);
    res.status(201).json({ id: row.id });
  });

  app.patch('/api/admin/users/:id', requireOwner, async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [idParam(req)]);
    if (!user) fail('User not found', 404);
    const b = req.body;
    const fields = {};
    if (b.name !== undefined) fields.name = str(b.name, 80) || fail('Name is required');
    if (b.phone !== undefined) fields.phone = str(b.phone, 30) || null;
    if (b.job_title !== undefined) fields.job_title = str(b.job_title, 80) || null;
    if (b.department !== undefined) fields.department = str(b.department, 40) || null;
    if (b.birthday !== undefined) fields.birthday = b.birthday === '' || b.birthday === null ? null : isDate(b.birthday) ? b.birthday : fail('Invalid birthday');
    if (b.remote_allowed !== undefined) fields.remote_allowed = b.remote_allowed ? 1 : 0;
    if (b.salary !== undefined) fields.salary = optNum(b.salary, 0, 1e8, 'Salary');
    if (b.annual_leave !== undefined) fields.annual_leave = optInt(b.annual_leave, 'Annual leave');
    if (b.sick_leave !== undefined) fields.sick_leave = optInt(b.sick_leave, 'Sick leave');
    if (b.role !== undefined && b.role !== user.role) {
      if (!ROLES.includes(b.role)) fail('Invalid role');
      if (user.id === req.user.id) fail('You cannot change your own role');
      fields.role = b.role;
    }
    // reset_device: 'mobile' | 'desktop' | true (both). Signs out sessions on the removed devices.
    if (b.reset_device) {
      const kinds = b.reset_device === 'mobile' || b.reset_device === 'desktop' ? [b.reset_device] : ['mobile', 'desktop'];
      const removed = await db.all(
        'DELETE FROM user_devices WHERE user_id = ? AND kind = ANY(?::text[]) RETURNING device_hash',
        [user.id, kinds],
      );
      if (removed.length) {
        await db.run('DELETE FROM sessions WHERE user_id = ? AND device_hash = ANY(?::text[])', [user.id, removed.map((r) => r.device_hash)]);
      }
    }
    if (b.start_date !== undefined) fields.start_date = isDate(b.start_date) ? b.start_date : fail('Invalid date');
    if (b.active !== undefined) {
      if (user.id === req.user.id && !b.active) fail('You cannot deactivate your own account');
      fields.active = b.active ? 1 : 0;
    }
    if (b.password) {
      if (typeof b.password !== 'string' || b.password.length < 6) fail('Password must be at least 6 characters');
      fields.password_hash = auth.hashPassword(b.password);
    }
    const keys = Object.keys(fields);
    if (keys.length) {
      await db.run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [
        ...keys.map((k) => fields[k]),
        user.id,
      ]);
    }
    if ((fields.password_hash || fields.active === 0 || fields.role) && user.id !== req.user.id) {
      await db.run('DELETE FROM sessions WHERE user_id = ?', [user.id]);
    }
    const changed = [...keys.map((k) => (k === 'password_hash' ? 'password' : k)), ...(b.reset_device ? ['device reset'] : [])];
    if (changed.length) {
      const extra = [fields.role && `role → ${fields.role}`, fields.salary !== undefined && `salary → ${fields.salary ?? '—'}`].filter(Boolean);
      await audit(req.user, 'user.update', `${user.name}: ${changed.join(', ')}${extra.length ? ` (${extra.join('; ')})` : ''}`, user.id);
    }
    res.json({ ok: true });
  });

  app.get('/api/admin/users/:id/history', requireManager, async (req, res) => {
    const id = idParam(req);
    await assertManages(req.user, id);
    const month = isMonth(req.query.month) ? req.query.month : localToday(await settings()).date.slice(0, 7);
    res.json(await historyFor(id, month));
  });

  app.post('/api/admin/points', requireOwner, async (req, res) => {
    const t = localToday(await settings());
    const userId = posInt(req.body.user_id);
    const kind = req.body.kind;
    const delta = Number(req.body.delta);
    const reason = str(req.body.reason, 300);
    const workDate = isDate(req.body.work_date) ? req.body.work_date : t.date;
    if (!['green', 'red', 'black'].includes(kind)) fail('Choose a point type');
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100) fail('Points must be a whole number between -100 and 100');
    if (!reason) fail('Reason is required');
    await db.tx(async (tx) => {
      if (!userId || !(await lockUser(tx, userId))) fail('Employee not found', 404);
      if (kind === 'green' && delta < 0 && (await balances(tx, userId, t.date.slice(0, 7))).green + delta < 0) {
        fail('Green balance cannot go below zero');
      }
      await addPoints(tx, { userId, kind, delta, workDate, source: 'manual', reason, createdBy: req.user.id });
    });
    await audit(req.user, 'points.adjust', `${delta > 0 ? '+' : ''}${delta} ${kind} on ${workDate}: ${reason}`, userId);
    const em = { green: '🟢', red: '🔴', black: '⚫' }[kind];
    await push.notifyUsers(db, [userId], {
      title: `${em} ${delta > 0 ? '+' : ''}${delta} ${kind} point${Math.abs(delta) === 1 ? '' : 's'}`,
      body: reason,
      url: '/#/history', tag: `points-${userId}`,
    });
    res.status(201).json({ ok: true });
  });

  app.get('/api/admin/points', requireOwner, async (req, res) => {
    const userId = posInt(req.query.user_id);
    const rows = await db.all(
      `SELECT p.*, u.name AS user_name, c.name AS created_by_name
       FROM points p JOIN users u ON u.id = p.user_id LEFT JOIN users c ON c.id = p.created_by
       WHERE (?::int IS NULL OR p.user_id = ?::int) ORDER BY p.id DESC LIMIT 200`,
      [userId, userId],
    );
    res.json(rows);
  });

  // Manual attendance, e.g. when an employee's GPS failed. Clears that day's automatic absence.
  app.post('/api/admin/attendance', requireOwner, async (req, res) => {
    const t = localToday(await settings());
    const userId = posInt(req.body.user_id);
    const { work_date: date, time, status } = req.body;
    if (!isDate(date) || !isTime(time)) fail('Enter date and time');
    if (!['early', 'on_time', 'late', 'very_late', 'off_day'].includes(status)) fail('Choose a status');
    if (date > t.date) fail('Cannot record attendance for a future date');
    await db.tx(async (tx) => {
      if (!userId || !(await lockUser(tx, userId))) fail('Employee not found', 404);
      if (await tx.get('SELECT 1 FROM attendance WHERE user_id = ? AND work_date = ?', [userId, date])) {
        fail('Attendance already recorded for that day', 409);
      }
      await tx.run(
        `INSERT INTO attendance (user_id, work_date, check_in_time, check_in_at, status) VALUES (?, ?, ?, ?, ?)`,
        [userId, date, time, now().toISOString(), status],
      );
      await tx.run(`DELETE FROM points WHERE user_id = ? AND work_date = ? AND source = 'absent'`, [userId, date]);
    });
    await audit(req.user, 'attendance.manual', `${date} at ${time} (${status})`, userId);
    res.status(201).json({ ok: true });
  });

  app.get('/api/admin/leaves', requireManager, async (req, res) => {
    const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
    const scope = teamScope(req.user);
    res.json(
      await db.all(
        `SELECT l.*, u.name AS user_name, u.department, d.name AS decided_by_name
         FROM leave_requests l JOIN users u ON u.id = l.user_id LEFT JOIN users d ON d.id = l.decided_by
         WHERE (?::text IS NULL OR l.status = ?::text) AND ${scope.sql}
         ORDER BY l.status = 'pending' DESC, l.id DESC LIMIT 200`,
        [status, status, ...scope.params],
      ),
    );
  });

  app.post('/api/admin/leaves/:id/decision', requireManager, async (req, res) => {
    const decision = req.body.decision;
    if (!['approve', 'reject'].includes(decision)) fail('Invalid decision');
    const pendingRow = await db.get('SELECT user_id FROM leave_requests WHERE id = ?', [idParam(req)]);
    if (!pendingRow) fail('Request not found', 404);
    await assertManages(req.user, pendingRow.user_id);
    const l = await db.tx(async (tx) => {
      const l = await tx.get(
        `UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = now()
         WHERE id = ? AND status = 'pending' RETURNING *`,
        [decision === 'approve' ? 'approved' : 'rejected', req.user.id, idParam(req)],
      );
      if (!l) fail('Request not found or already decided', 404);
      if (decision === 'approve') {
        // Approved leave cancels absences already recorded for those days.
        await tx.run(`DELETE FROM points WHERE user_id = ? AND source = 'absent' AND work_date BETWEEN ? AND ?`, [
          l.user_id,
          l.from_date,
          l.to_date,
        ]);
      }
      return l;
    });
    await audit(req.user, `leave.${decision}`, `${LEAVE_LABEL[l.type] || 'Leave'} ${l.from_date === l.to_date ? l.from_date : `${l.from_date} → ${l.to_date}`}`, l.user_id);
    await push.notifyUsers(db, [l.user_id], {
      title: decision === 'approve' ? '✅ Leave approved' : '❌ Leave request declined',
      body: `${l.from_date === l.to_date ? l.from_date : `${l.from_date} → ${l.to_date}`}${decision === 'approve' ? '. Enjoy your time off!' : ''}`,
      url: '/#/leaves', tag: `leave-${l.id}`,
    });
    res.json({ ok: true });
  });

  app.get('/api/admin/rewards', requireOwner, async (req, res) => {
    const status = ['pending', 'paid', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
    res.json(
      await db.all(
        `SELECT r.*, u.name AS user_name FROM reward_requests r JOIN users u ON u.id = r.user_id
         WHERE (?::text IS NULL OR r.status = ?::text) ORDER BY r.status = 'pending' DESC, r.id DESC LIMIT 200`,
        [status, status],
      ),
    );
  });

  app.post('/api/admin/rewards/:id/decision', requireOwner, async (req, res) => {
    const decision = req.body.decision;
    if (!['paid', 'reject'].includes(decision)) fail('Invalid decision');
    const s = await settings();
    const r = await db.tx(async (tx) => {
      const r = await tx.get(
        `UPDATE reward_requests SET status = ?, decided_by = ?, decided_at = now()
         WHERE id = ? AND status = 'pending' RETURNING *`,
        [decision === 'paid' ? 'paid' : 'rejected', req.user.id, idParam(req)],
      );
      if (!r) fail('Request not found or already decided', 404);
      if (decision === 'reject') await refundReward(tx, s, r, req.user.id);
      return r;
    });
    await audit(req.user, `reward.${decision === 'paid' ? 'paid' : 'reject'}`, `${r.points} points = ${r.amount} ${s.currency}`, r.user_id);
    await push.notifyUsers(db, [r.user_id], {
      title: decision === 'paid' ? '💸 Your reward was paid!' : 'Reward request declined',
      body: decision === 'paid' ? `${r.amount} ${s.currency} is on its way. Well deserved!` : `Your ${r.points} points were returned to your balance.`,
      url: '/#/rewards', tag: `reward-${r.id}`,
    });
    res.json({ ok: true });
  });

  async function reportFor(req) {
    const s = await settings();
    await runAbsenceJob(db, s, now());
    const month = isMonth(req.query.month) ? req.query.month : localToday(s).date.slice(0, 7);
    return { month, rows: await monthReport(db, s, month) };
  }

  app.get('/api/admin/report', requireOwner, async (req, res) => {
    res.json(await reportFor(req));
  });

  app.get('/api/admin/report.csv', requireOwner, async (req, res) => {
    const { month, rows } = await reportFor(req);
    const header = [
      'Name', 'Department', 'Job title', 'Days present', 'Early', 'On time', 'Late', 'Leave days', 'Hours worked', 'Overtime hours',
      'Green (month)', 'Green balance', 'Red', 'Black (absences)', 'Red deduction', 'Black deduction', 'Total deduction',
    ];
    const keys = [
      'name', 'department', 'job_title', 'days_present', 'early', 'on_time', 'late', 'leave_days', 'hours', 'overtime',
      'green_month', 'green_balance', 'red', 'black', 'red_deduction', 'black_deduction', 'total_deduction',
    ];
    for (const r of rows) {
      r.hours = Math.round((r.worked_minutes / 60) * 100) / 100;
      r.overtime = Math.round((r.overtime_minutes / 60) * 100) / 100;
    }
    sendCsv(res, `attendance-${month}.csv`, header, rows.map((r) => keys.map((k) => r[k])));
  });

  // ----- Payroll -----

  async function payrollFor(req) {
    const s = await settings();
    await runAbsenceJob(db, s, now());
    const month = isMonth(req.query.month) ? req.query.month : localToday(s).date.slice(0, 7);
    return { month, currency: s.currency, overtime_rate: s.overtime_rate, rewards_in_net: !!s.payroll_add_rewards, rows: await payroll(db, s, month) };
  }

  app.get('/api/admin/payroll', requireOwner, async (req, res) => {
    res.json(await payrollFor(req));
  });

  app.get('/api/admin/payroll.csv', requireOwner, async (req, res) => {
    const { month, rows } = await payrollFor(req);
    const header = [
      'Name', 'Department', 'Salary', 'Work days', 'Days present', 'Hours worked', 'Overtime hours', 'Overtime pay',
      'Red', 'Black', 'Red/black deduction', 'Unpaid leave days', 'Unpaid leave deduction', 'Rewards paid', 'Net pay',
    ];
    const keys = [
      'name', 'department', 'salary', 'work_days', 'days_present', 'hours_worked', 'overtime_hours', 'overtime_pay',
      'red', 'black', 'total_deduction', 'unpaid_days', 'unpaid_deduction', 'rewards_paid', 'net_pay',
    ];
    await audit(req.user, 'payroll.export', month);
    sendCsv(res, `payroll-${month}.csv`, header, rows.filter((r) => r.active).map((r) => keys.map((k) => r[k])));
  });

  // ----- Attendance corrections (owner / lead) -----

  app.get('/api/admin/corrections', requireManager, async (req, res) => {
    const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
    const scope = teamScope(req.user);
    res.json(
      await db.all(
        `SELECT c.*, u.name AS user_name, u.department, d.name AS decided_by_name
         FROM attendance_corrections c JOIN users u ON u.id = c.user_id LEFT JOIN users d ON d.id = c.decided_by
         WHERE (?::text IS NULL OR c.status = ?::text) AND ${scope.sql}
         ORDER BY c.status = 'pending' DESC, c.id DESC LIMIT 200`,
        [status, status, ...scope.params],
      ),
    );
  });

  // Approving a missing check-in records it like a real one (points by the department's windows) and clears the absence.
  app.post('/api/admin/corrections/:id/decision', requireManager, async (req, res) => {
    const decision = req.body.decision;
    if (!['approve', 'reject'].includes(decision)) fail('Invalid decision');
    const company = await settings();
    const pendingRow = await db.get('SELECT user_id FROM attendance_corrections WHERE id = ?', [idParam(req)]);
    if (!pendingRow) fail('Request not found', 404);
    await assertManages(req.user, pendingRow.user_id);
    const c = await db.tx(async (tx) => {
      const c = await tx.get(
        `UPDATE attendance_corrections SET status = ?, decided_by = ?, decided_at = now()
         WHERE id = ? AND status = 'pending' RETURNING *`,
        [decision === 'approve' ? 'approved' : 'rejected', req.user.id, idParam(req)],
      );
      if (!c) fail('Request not found or already decided', 404);
      if (decision === 'reject') return c;
      await lockUser(tx, c.user_id);
      const user = await tx.get('SELECT department FROM users WHERE id = ?', [c.user_id]);
      const us = scheduleFor(company, user.department);
      const existing = await tx.get('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?', [c.user_id, c.work_date]);
      if (existing) {
        if (!c.check_out_time) fail('That day was already recorded in the meantime', 409);
        if (existing.check_out_time) fail('That day already has a check-out', 409);
        await tx.run('UPDATE attendance SET check_out_time = ?, check_out_at = now() WHERE id = ?', [c.check_out_time, existing.id]);
        return c;
      }
      let result;
      if (!isWorkDay(c.work_date, us)) result = { status: 'off_day', green: 0, red: 0 };
      else if (toMinutes(c.check_in_time) < toMinutes(us.early_start)) result = { status: 'early', green: 1, red: 0 };
      else if (toMinutes(c.check_in_time) >= toMinutes(us.close)) result = { status: 'very_late', green: 0, red: Number(us.very_late_reds) || 1 };
      else result = classifyCheckIn(c.check_in_time, us);
      const row = await tx.get(
        `INSERT INTO attendance (user_id, work_date, check_in_time, check_in_at, status, check_out_time, check_out_at, mode)
         VALUES (?, ?, ?, now(), ?, ?, ?, 'office') RETURNING id`,
        [c.user_id, c.work_date, c.check_in_time, result.status, c.check_out_time, c.check_out_time ? now().toISOString() : null],
      );
      await tx.run(`DELETE FROM points WHERE user_id = ? AND work_date = ? AND source = 'absent'`, [c.user_id, c.work_date]);
      if (result.green) {
        await addPoints(tx, {
          userId: c.user_id, kind: 'green', delta: result.green, workDate: c.work_date,
          source: 'early', reason: `Early check-in ${c.check_in_time} (correction)`, refId: row.id, createdBy: req.user.id,
        });
      }
      if (result.red) {
        await addPoints(tx, {
          userId: c.user_id, kind: 'red', delta: result.red, workDate: c.work_date,
          source: 'late', reason: `Late check-in ${c.check_in_time} (correction)`, refId: row.id, createdBy: req.user.id,
        });
      }
      return c;
    });
    await audit(req.user, `correction.${decision}`, `${c.work_date}: ${[c.check_in_time && `in ${c.check_in_time}`, c.check_out_time && `out ${c.check_out_time}`].filter(Boolean).join(', ')}`, c.user_id);
    await push.notifyUsers(db, [c.user_id], {
      title: decision === 'approve' ? '✅ Attendance fixed' : '❌ Attendance fix declined',
      body: `${c.work_date}${decision === 'approve' ? ' is now recorded.' : ''}`,
      url: '/#/corrections', tag: `correction-${c.id}`,
    });
    res.json({ ok: true });
  });

  // ----- Official holidays -----

  app.get('/api/holidays', requireUser, async (req, res) => {
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : null;
    res.json(await db.all(`SELECT * FROM holidays WHERE (?::text IS NULL OR date LIKE ?::text || '-%') ORDER BY date`, [year, year]));
  });

  // Adding a holiday also removes absences already recorded for that day.
  async function addHoliday(date, name) {
    const row = await db.get(
      'INSERT INTO holidays (date, name) VALUES (?, ?) ON CONFLICT (date) DO UPDATE SET name = excluded.name RETURNING *',
      [date, name],
    );
    await db.run(`DELETE FROM points WHERE work_date = ? AND source = 'absent'`, [date]);
    return row;
  }

  app.post('/api/admin/holidays', requireOwner, async (req, res) => {
    const name = str(req.body.name, 80);
    const from = req.body.date;
    const to = req.body.to_date || from;
    if (!isDate(from) || !isDate(to) || to < from) fail('Choose the date(s)');
    if (!name) fail('Give the holiday a name');
    if (eachDate(from, to).length > 14) fail('A holiday can be at most 14 days. Add longer breaks as leave.');
    for (const d of eachDate(from, to)) await addHoliday(d, name);
    await audit(req.user, 'holiday.add', `${name}: ${from === to ? from : `${from} → ${to}`}`);
    res.status(201).json({ ok: true });
  });

  app.post('/api/admin/holidays/preset', requireOwner, async (req, res) => {
    const year = /^\d{4}$/.test(String(req.body.year || '')) ? String(req.body.year) : localToday(await settings()).date.slice(0, 4);
    for (const [md, name] of EGYPT_HOLIDAYS) await addHoliday(`${year}-${md}`, name);
    await audit(req.user, 'holiday.preset', `Egypt fixed holidays ${year}`);
    res.status(201).json({ added: EGYPT_HOLIDAYS.length });
  });

  app.post('/api/admin/holidays/:id/delete', requireOwner, async (req, res) => {
    const row = await db.get('DELETE FROM holidays WHERE id = ? RETURNING *', [idParam(req)]);
    if (!row) fail('Not found', 404);
    await audit(req.user, 'holiday.remove', `${row.name}: ${row.date}`);
    res.json({ ok: true });
  });

  // ----- Google Drive (task files) -----

  const callbackUrl = (req) => `${req.protocol}://${req.get('host')}/api/drive/callback`;

  app.get('/api/admin/drive', requireOwner, async (req, res) => {
    const st = await drive.getState(db);
    let quota = null;
    let error = null;
    if (st?.refresh_token) {
      try {
        quota = await drive.about(db);
      } catch (err) {
        error = err.message;
      }
    }
    const files = await db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM task_files WHERE kind = 'drive'`);
    const lastBackup = await db.get(`SELECT value FROM settings WHERE key = 'drive_backup_last'`);
    res.json({
      configured: drive.configured(),
      config_problem: drive.configProblem(),
      client_id_hint: drive.configured() ? `${String(process.env.GOOGLE_CLIENT_ID).trim().replace(/^["']/, '').slice(0, 12)}…` : null,
      connected: !!st?.refresh_token,
      email: quota?.email || st?.email || null,
      connected_at: st?.connected_at || null,
      quota,
      error,
      redirect_uri: callbackUrl(req),
      files: Number(files.n),
      bytes: Number(files.bytes),
      last_backup: lastBackup ? JSON.parse(lastBackup.value) : null,
    });
  });

  // Browser navigation (not fetch): sends the owner to Google's consent screen.
  app.get('/api/admin/drive/connect', requireOwner, async (req, res) => {
    if (!drive.configured()) fail('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel first (see Settings → File storage).');
    if (drive.configProblem()) fail(drive.configProblem());
    res.redirect(await drive.startAuth(db, req.user.id, callbackUrl(req)));
  });

  app.get('/api/drive/callback', requireOwner, async (req, res) => {
    const back = (q) => res.redirect(`/#/settings?${new URLSearchParams(q)}`);
    if (req.query.error) return back({ drive: 'error', msg: req.query.error === 'access_denied' ? 'You cancelled the Google sign-in.' : String(req.query.error) });
    try {
      const email = await drive.finishAuth(db, { code: String(req.query.code || ''), state: String(req.query.state || ''), userId: req.user.id, redirectUri: callbackUrl(req) });
      await audit(req.user, 'drive.connect', email || 'Google Drive');
      back({ drive: 'connected' });
    } catch (err) {
      back({ drive: 'error', msg: err.message });
    }
  });

  app.post('/api/admin/drive/disconnect', requireOwner, async (req, res) => {
    await drive.disconnect(db);
    await audit(req.user, 'drive.disconnect', 'Google Drive');
    res.json({ ok: true });
  });

  // ----- Activity log, weekly summary, backup -----

  app.get('/api/admin/audit', requireOwner, async (req, res) => {
    const before = posInt(req.query.before);
    res.json(
      await db.all(
        `SELECT a.*, u.name AS actor_name, u.role AS actor_role, t.name AS target_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN users t ON t.id = a.target_user_id
         WHERE (?::int IS NULL OR a.id < ?::int) ORDER BY a.id DESC LIMIT 100`,
        [before, before],
      ),
    );
  });

  app.post('/api/admin/weekly-summary', requireOwner, async (req, res) => {
    const summary = await weeklySummary(await settings());
    const sent = await push.notifyUsers(db, [req.user.id], summary.push);
    res.json({ sent, summary: summary.data });
  });

  // Full backup: one sheet per table (passwords, sessions and device hashes are left out).
  async function buildBackup(s) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = s.company_name;
    wb.created = now();
    const sheets = [
      ['Staff', `SELECT id, name, username, role, department, job_title, phone, birthday, start_date, active, remote_allowed,
                        salary, annual_leave, sick_leave, created_at FROM users ORDER BY id`],
      ['Attendance', `SELECT a.id, a.user_id, u.name, a.work_date, a.check_in_time, a.check_out_time, a.status, a.mode,
                             a.distance_m, a.accuracy, a.mood FROM attendance a JOIN users u ON u.id = a.user_id ORDER BY a.work_date, u.name`],
      ['Points', `SELECT p.id, p.user_id, u.name, p.kind, p.delta, p.work_date, p.source, p.reason, c.name AS created_by, p.created_at
                  FROM points p JOIN users u ON u.id = p.user_id LEFT JOIN users c ON c.id = p.created_by ORDER BY p.id`],
      ['Leave', `SELECT l.id, l.user_id, u.name, l.type, l.from_date, l.to_date, l.reason, l.status, d.name AS decided_by, l.decided_at, l.created_at
                 FROM leave_requests l JOIN users u ON u.id = l.user_id LEFT JOIN users d ON d.id = l.decided_by ORDER BY l.id`],
      ['Corrections', `SELECT c.id, c.user_id, u.name, c.work_date, c.check_in_time, c.check_out_time, c.reason, c.status,
                              d.name AS decided_by, c.decided_at, c.created_at
                       FROM attendance_corrections c JOIN users u ON u.id = c.user_id LEFT JOIN users d ON d.id = c.decided_by ORDER BY c.id`],
      ['Rewards', `SELECT r.id, r.user_id, u.name, r.points, r.amount, r.method, r.payout_number, r.status, d.name AS decided_by, r.decided_at, r.created_at
                   FROM reward_requests r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.decided_by ORDER BY r.id`],
      ['Holidays', 'SELECT id, date, name FROM holidays ORDER BY date'],
      ['Task files', `SELECT f.id, f.task_id, t.title AS task, f.kind, f.name, f.size, f.mime, f.url, u.name AS added_by, f.created_at
                      FROM task_files f JOIN tasks t ON t.id = f.task_id LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id`],
      ['Clients', `SELECT c.id, c.name, c.color, c.active, m.name AS account_manager, c.notes, c.created_at
                   FROM clients c LEFT JOIN users m ON m.id = c.manager_id ORDER BY c.name`],
      ['Tasks', `SELECT t.id, t.title, t.client, t.department, a.name AS assignee, c.name AS created_by, t.status, t.priority,
                        t.start_date, t.due_date, t.completed_at, t.created_at, t.description,
                        (SELECT COUNT(*) FROM task_items i WHERE i.task_id = t.id AND i.done = 1) || '/' ||
                        (SELECT COUNT(*) FROM task_items i WHERE i.task_id = t.id) AS checklist
                 FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users c ON c.id = t.created_by ORDER BY t.id`],
      ['Kudos', `SELECT k.id, f.name AS "from", t.name AS "to", k.category, k.message, k.created_at
                 FROM kudos k JOIN users f ON f.id = k.from_user JOIN users t ON t.id = k.to_user ORDER BY k.id`],
      ['Announcements', `SELECT a.id, a.title, a.body, a.kind, a.pinned, u.name AS author, a.created_at
                         FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.id`],
      ['Activity log', `SELECT a.id, a.created_at, u.name AS by, a.action, t.name AS about, a.detail
                        FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN users t ON t.id = a.target_user_id ORDER BY a.id`],
    ];
    for (const [title, sql] of sheets) {
      const rows = await db.all(sql);
      const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] });
      const cols = rows.length ? Object.keys(rows[0]) : [];
      ws.columns = cols.map((k) => ({ header: k, key: k, width: Math.min(40, Math.max(10, k.length + 2)) }));
      for (const r of rows) ws.addRow(r);
      ws.getRow(1).font = { bold: true };
    }
    const settingsSheet = wb.addWorksheet('Settings');
    settingsSheet.columns = [{ header: 'key', key: 'k', width: 24 }, { header: 'value', key: 'v', width: 80 }];
    for (const [k, v] of Object.entries(s)) {
      if (k !== 'holiday_dates') settingsSheet.addRow({ k, v: typeof v === 'object' ? JSON.stringify(v) : v });
    }
    settingsSheet.getRow(1).font = { bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  app.get('/api/admin/export.xlsx', requireOwner, async (req, res) => {
    const s = await settings();
    const buf = await buildBackup(s);
    await audit(req.user, 'data.export', 'Full Excel backup');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bahr-backup-${localToday(s).date}.xlsx"`);
    res.send(buf);
  });

  // Daily copy of the full backup in the connected Google Drive (Bahr Network Files / Backups), keeping the last 30.
  async function backupToDrive(s) {
    const st = await drive.getState(db);
    if (!st?.refresh_token || s.drive_backup === false) return null;
    const date = localToday(s).date;
    const info = await drive.saveBackup(db, `bahr-backup-${date}.xlsx`, await buildBackup(s), 30);
    await db.run(
      `INSERT INTO settings (key, value) VALUES ('drive_backup_last', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify({ ...info, at: now().toISOString() })],
    );
    return info;
  }

  app.post('/api/admin/drive/backup', requireOwner, async (req, res) => {
    let info;
    try {
      info = await backupToDrive({ ...(await settings()), drive_backup: true });
    } catch (err) {
      fail(err.message, 502);
    }
    if (!info) fail('Connect Google Drive first');
    await audit(req.user, 'data.backup', `Backup saved to Google Drive: ${info.name}`);
    res.json(info);
  });

  app.get('/api/admin/settings', requireOwner, async (req, res) => res.json(await settings()));

  // Turns a pasted Google Maps link (incl. maps.app.goo.gl short links) into coordinates.
  app.post('/api/admin/resolve-map-link', requireOwner, async (req, res) => {
    const link = str(req.body.url, 2000);
    if (!link) fail('Paste a Google Maps link');
    let coords = null;
    try {
      coords = await resolveMapLink(link);
    } catch {
      coords = null;
    }
    if (!coords) fail("Couldn't read a location from that link. Open the place in Google Maps, tap Share → Copy link, and paste it here.");
    res.json(coords);
  });

  app.put('/api/admin/settings', requireOwner, async (req, res) => {
    const prev = await settings();
    const next = validateSettings({ ...prev, ...req.body });
    await saveSettings(db, next);
    const changed = Object.keys(next).filter((k) => k !== 'holiday_dates' && JSON.stringify(next[k]) !== JSON.stringify(prev[k]));
    if (changed.length) await audit(req.user, 'settings.update', changed.join(', '));
    res.json({ ...next, holiday_dates: prev.holiday_dates });
  });

  // ---------- Helpers ----------

  function sendCsv(res, filename, header, rows) {
    const cell = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...rows].map((line) => line.map(cell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\ufeff${csv}`);
  }

  // The last 7 days (ending today): attendance rate, lateness, absences, stars and what's waiting.
  async function weeklySummary(s) {
    const t = localToday(s);
    const from = addDays(t.date, -6);
    const [users, att, absences, greens, pending] = await Promise.all([
      db.all(`SELECT id, name, department, start_date FROM users WHERE role <> 'owner' AND active = 1`),
      db.all('SELECT user_id, work_date, status FROM attendance WHERE work_date BETWEEN ? AND ?', [from, t.date]),
      db.get(`SELECT COUNT(*) AS n FROM points WHERE source = 'absent' AND work_date BETWEEN ? AND ?`, [from, t.date]),
      db.all(
        `SELECT u.name, SUM(p.delta) AS green FROM points p JOIN users u ON u.id = p.user_id
         WHERE p.kind = 'green' AND p.delta > 0 AND p.work_date BETWEEN ? AND ? AND u.active = 1
         GROUP BY u.id ORDER BY green DESC, u.name LIMIT 3`,
        [from, t.date],
      ),
      db.get(
        `SELECT (SELECT COUNT(*) FROM leave_requests WHERE status = 'pending') AS leaves,
                (SELECT COUNT(*) FROM reward_requests WHERE status = 'pending') AS rewards,
                (SELECT COUNT(*) FROM attendance_corrections WHERE status = 'pending') AS corrections`,
      ),
    ]);
    let expected = 0;
    for (const u of users) {
      const us = scheduleFor(s, u.department);
      expected += eachDate(from, t.date).filter((d) => d >= u.start_date && isWorkDay(d, us)).length;
    }
    const present = att.filter((a) => a.status !== 'off_day').length;
    const late = att.filter((a) => a.status === 'late' || a.status === 'very_late').length;
    const data = {
      from, to: t.date, expected, present, late,
      rate: expected ? Math.min(100, Math.round((present / expected) * 100)) : 100,
      absences: Number(absences.n),
      stars: greens.map((g) => ({ name: g.name, green: Number(g.green) })),
      pending: { leaves: Number(pending.leaves), rewards: Number(pending.rewards), corrections: Number(pending.corrections) },
    };
    const waiting = data.pending.leaves + data.pending.rewards + data.pending.corrections;
    const body = [
      `Attendance ${data.rate}% · ${late} late · ${data.absences} absence${data.absences === 1 ? '' : 's'}`,
      data.stars.length ? `⭐ ${data.stars.map((x) => x.name.split(' ')[0]).join(', ')}` : null,
      waiting ? `${waiting} request${waiting === 1 ? '' : 's'} waiting` : 'Nothing waiting for you',
    ].filter(Boolean).join(' · ');
    return { data, push: { title: '📊 Your week at a glance', body, url: '/#/reports', tag: `weekly-${t.date}` } };
  }

  function refundReward(tx, s, r, by) {
    return addPoints(tx, {
      userId: r.user_id, kind: 'green', delta: r.points, workDate: localToday(s).date,
      source: 'reward_refund', reason: 'Reward request refund', refId: r.id, createdBy: by,
    });
  }

  // Current streak of early / on-time work days and this month's attendance rate.
  async function attendanceStats(user, company, t) {
    const s = scheduleFor(company, user.department);
    const from = addDays(t.date, -90);
    const [att, leaves] = await Promise.all([
      db.all('SELECT work_date, status FROM attendance WHERE user_id = ? AND work_date >= ?', [user.id, from]),
      db.all(
        `SELECT from_date, to_date FROM leave_requests WHERE user_id = ? AND status = 'approved' AND to_date >= ?`,
        [user.id, from],
      ),
    ]);
    const byDate = new Map(att.map((a) => [a.work_date, a.status]));
    const onLeave = (d) => leaves.some((l) => d >= l.from_date && d <= l.to_date);
    let streak = 0;
    for (let d = t.date; d >= from && d >= user.start_date; d = addDays(d, -1)) {
      if (!isWorkDay(d, s) || onLeave(d)) continue;
      const st = byDate.get(d);
      if (!st && d === t.date) continue; // today isn't over yet
      if (st === 'early' || st === 'on_time') streak += 1;
      else break;
    }
    const monthStart = `${t.date.slice(0, 7)}-01`;
    const start = user.start_date > monthStart ? user.start_date : monthStart;
    const checkedToday = byDate.has(t.date) || toMinutes(t.time) >= toMinutes(s.close);
    const end = checkedToday ? t.date : addDays(t.date, -1);
    const due = start <= end ? eachDate(start, end).filter((d) => isWorkDay(d, s) && !onLeave(d)) : [];
    const present = due.filter((d) => byDate.has(d)).length;
    return {
      streak,
      month_stats: { work_days: due.length, present, rate: due.length ? Math.round((present / due.length) * 100) : 100 },
    };
  }

  async function historyFor(userId, month) {
    const like = `${month}-%`;
    const [attendance, points, b] = await Promise.all([
      db.all('SELECT * FROM attendance WHERE user_id = ? AND work_date LIKE ? ORDER BY work_date DESC', [userId, like]),
      db.all('SELECT * FROM points WHERE user_id = ? AND work_date LIKE ? ORDER BY id DESC', [userId, like]),
      balances(db, userId, month),
    ]);
    return { month, attendance, points, balances: b };
  }

  registerCulture(app, {
    db, settings, localToday, now, fail, str, posInt, idParam, requireUser, requireOwner, attendanceStats, addPoints,
  });
  registerTasks(app, { db, settings, localToday, fail, str, posInt, idParam, requireUser, audit, addPoints, now });
  registerClients(app, { db, settings, localToday, fail, str, posInt, idParam, requireUser, audit });
  registerReports(app, { db, settings, localToday, fail, str, posInt, requireUser, audit });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err, req, res, next) => {
    if (err instanceof RuleError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.code === '23505') return res.status(409).json({ error: 'That record already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}

function pickRules(s) {
  const keys = [
    'company_name', 'currency', 'early_start', 'early_end', 'late_after', 'very_late_after', 'close',
    'very_late_reds', 'work_days', 'red_value', 'black_value', 'green_value', 'min_reward_points', 'radius_m',
    'departments', 'kudos_daily_limit', 'kudos_green', 'daily_hours', 'annual_leave_days', 'sick_leave_days', 'am_department', 'task_green',
  ];
  return { ...Object.fromEntries(keys.map((k) => [k, s[k]])), location_set: s.office_lat != null };
}

function validateSettings(s) {
  const out = { ...s };
  out.company_name = str(s.company_name, 80) || 'Bahr Network';
  try {
    new Intl.DateTimeFormat('en', { timeZone: s.timezone });
  } catch {
    fail('Invalid timezone');
  }
  for (const k of ['early_start', 'early_end', 'late_after', 'very_late_after', 'close']) {
    if (!isTime(s[k])) fail(`${k} must be in HH:MM format`);
  }
  const order = ['early_start', 'early_end', 'late_after', 'very_late_after', 'close'].map((k) => toMinutes(s[k]));
  if (order.some((m, i) => i > 0 && m < order[i - 1])) {
    fail('Times must be in order: early start ≤ early end ≤ late after ≤ very late after ≤ close');
  }
  if (s.office_lat === null || s.office_lat === '' || s.office_lng === null || s.office_lng === '') {
    out.office_lat = null;
    out.office_lng = null;
  } else {
    out.office_lat = Number(s.office_lat);
    out.office_lng = Number(s.office_lng);
    if (!(Math.abs(out.office_lat) <= 90) || !(Math.abs(out.office_lng) <= 180)) fail('Invalid office coordinates');
  }
  const num = (k, min, max) => {
    const v = Number(s[k]);
    if (!Number.isFinite(v) || v < min || v > max) fail(`${k} must be between ${min} and ${max}`);
    out[k] = v;
  };
  num('radius_m', 10, 50000);
  num('max_accuracy_m', 5, 10000);
  num('very_late_reds', 1, 10);
  num('red_value', 0, 1e7);
  num('black_value', 0, 1e7);
  num('green_value', 0, 1e7);
  num('min_reward_points', 1, 100000);
  if (!Array.isArray(s.work_days) || s.work_days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    fail('Invalid work days');
  }
  out.work_days = [...new Set(s.work_days)];
  out.currency = str(s.currency, 10) || 'EGP';
  out.device_lock = s.device_lock !== false;
  num('kudos_daily_limit', 0, 50);
  num('kudos_green', 0, 10);
  if (!Array.isArray(s.departments) || s.departments.length > 40) fail('Invalid departments');
  out.departments = [...new Set(s.departments.map((d) => str(d, 40)).filter(Boolean))];
  num('daily_hours', 1, 24);
  num('overtime_rate', 0, 10);
  num('annual_leave_days', 0, 365);
  num('sick_leave_days', 0, 365);
  out.payroll_add_rewards = !!s.payroll_add_rewards;
  out.weekly_summary = s.weekly_summary !== false;
  out.dept_schedules = validateSchedules(s.dept_schedules, out.departments);
  out.am_department = out.departments.includes(s.am_department) ? s.am_department : '';
  num('max_upload_mb', 1, 5 * 1024 * 1024);
  out.drive_backup = s.drive_backup !== false;
  num('task_green', 0, 10);
  delete out.holiday_dates;
  return out;
}

const TIME_KEYS = ['early_start', 'early_end', 'late_after', 'very_late_after', 'close'];

// { department: { early_start..close, work_days, daily_hours } }. A department without an entry uses the company schedule.
function validateSchedules(input, departments) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) fail('Invalid department schedules');
  const out = {};
  for (const [dept, sch] of Object.entries(input)) {
    if (!departments.includes(dept) || !sch || typeof sch !== 'object') continue;
    for (const k of TIME_KEYS) if (!isTime(sch[k])) fail(`${dept}: ${k.replace(/_/g, ' ')} must be in HH:MM format`);
    const order = TIME_KEYS.map((k) => toMinutes(sch[k]));
    if (order.some((m, i) => i > 0 && m < order[i - 1])) fail(`${dept}: times must be in order`);
    if (!Array.isArray(sch.work_days) || !sch.work_days.length || sch.work_days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      fail(`${dept}: choose the work days`);
    }
    const hours = Number(sch.daily_hours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 24) fail(`${dept}: daily hours must be between 1 and 24`);
    out[dept] = { ...Object.fromEntries(TIME_KEYS.map((k) => [k, sch[k]])), work_days: [...new Set(sch.work_days)], daily_hours: hours };
  }
  return out;
}

module.exports = { createApp };
