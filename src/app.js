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
} = require('./logic');
const auth = require('./auth');
const { registerCulture } = require('./culture');
const { resolveMapLink } = require('./maplink');

const PAYOUT_METHODS = ['instapay', 'vodafone_cash', 'cash'];
const ABSENCE_JOB_INTERVAL_MS = 5 * 60 * 1000;

function fail(message, status = 400, code = undefined) {
  throw new RuleError(message, status, code);
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
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
    if (user.role === 'employee' && !user.session_device && (await settings()).device_lock) {
      await db.run('DELETE FROM sessions WHERE token = ?', [user.token]);
      return res.status(401).json({ error: 'Please log in again to register this device' });
    }
    delete user.session_device;
    req.user = user;
    next();
  }

  const requireRole = (role, message) => [
    requireUser,
    (req, res, next) => (req.user.role === role ? next() : res.status(403).json({ error: message })),
  ];
  const requireOwner = requireRole('owner', 'Owner access only');
  const requireEmployee = requireRole('employee', 'Employee access only');

  // Locks the user's row so concurrent balance checks (redeem, rewards, adjustments) can't double-spend.
  const lockUser = (t, userId, role = 'employee') =>
    t.get(`SELECT id FROM users WHERE id = ? AND role = ? FOR UPDATE`, [userId, role]);

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
    if (user.role === 'employee' && s.device_lock) await checkDevice(user, device, label);
    const session = await auth.createSession(db, user.id, device);
    auth.setSessionCookie(res, session.token, session.expires);
    res.json({ ok: true });
  });

  // First login binds the account to this device; afterwards only that device may log in,
  // and a device can belong to only one employee (stops logging in on a colleague's behalf).
  async function checkDevice(user, device, label) {
    const block = async (reason, message) => {
      await db.run('INSERT INTO device_blocks (user_id, reason, device_label) VALUES (?, ?, ?)', [user.id, reason, label]);
      fail(message, 403, 'device_locked');
    };
    if (user.device_hash) {
      if (user.device_hash !== device) {
        await block('other_device', 'This account is locked to another device. Ask your manager to reset your device if you changed phones.');
      }
      return;
    }
    const owner = await db.get('SELECT id FROM users WHERE device_hash = ? AND id != ?', [device, user.id]);
    if (owner) await block('device_taken', 'This device is already registered to another employee. Log in from your own phone.');
    const bound = await db.run(
      `UPDATE users SET device_hash = ?, device_label = ?, device_bound_at = now() WHERE id = ? AND device_hash IS NULL`,
      [device, label, user.id],
    );
    if (!bound.changes) await block('other_device', 'This account is locked to another device.');
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
  app.get('/api/cron/absences', async (req, res) => {
    if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const added = await runAbsenceJob(db, await settings(), now());
    res.json({ added });
  });

  // ---------- Employee ----------

  app.get('/api/me/dashboard', requireEmployee, async (req, res) => {
    const s = await settings();
    await maybeRunAbsences(s);
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
    const s = await settings();
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

  app.post('/api/me/leaves', requireEmployee, async (req, res) => {
    const { from_date: from, to_date: to } = req.body;
    if (!isDate(from) || !isDate(to)) fail('Choose start and end dates');
    if (to < from) fail('End date must be on or after start date');
    if (eachDate(from, to).length > 60) fail('Leave can be at most 60 days');
    const row = await db.get(
      'INSERT INTO leave_requests (user_id, from_date, to_date, reason) VALUES (?, ?, ?, ?) RETURNING *',
      [req.user.id, from, to, str(req.body.reason, 500) || null],
    );
    res.status(201).json(row);
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

  app.get('/api/admin/overview', requireOwner, async (req, res) => {
    const s = await settings();
    await maybeRunAbsences(s);
    const t = localToday(s);
    const date = isDate(req.query.date) ? req.query.date : t.date;
    const [rows, leaves, pending] = await Promise.all([
      db.all(
        `SELECT u.id, u.name, u.job_title, u.department, u.start_date, a.check_in_time, a.check_out_time, a.status,
                a.distance_m, a.mood, a.mode
         FROM users u LEFT JOIN attendance a ON a.user_id = u.id AND a.work_date = ?
         WHERE u.role = 'employee' AND u.active = 1 ORDER BY a.check_in_time IS NULL, a.check_in_time, u.name`,
        [date],
      ),
      db.all(`SELECT user_id FROM leave_requests WHERE status = 'approved' AND ? BETWEEN from_date AND to_date`, [date]),
      db.get(
        `SELECT (SELECT COUNT(*) FROM leave_requests WHERE status = 'pending') AS leaves,
                (SELECT COUNT(*) FROM reward_requests WHERE status = 'pending') AS rewards`,
      ),
    ]);
    const onLeave = new Set(leaves.map((l) => l.user_id));
    const closed = date < t.date || (date === t.date && toMinutes(t.time) >= toMinutes(s.close));
    for (const r of rows) {
      if (r.status) continue;
      if (date < r.start_date) r.status = 'not_started';
      else if (onLeave.has(r.id)) r.status = 'leave';
      else if (!isWorkDay(date, s)) r.status = 'off_day';
      else r.status = closed ? 'absent' : 'waiting';
    }
    const trendFrom = addDays(date, -6);
    const trendRows = await db.all(
      `SELECT work_date, COUNT(*) AS present, COUNT(*) FILTER (WHERE status IN ('late', 'very_late')) AS late, AVG(mood) AS mood,
              COUNT(*) FILTER (WHERE status = 'early') AS early
       FROM attendance WHERE work_date BETWEEN ? AND ? GROUP BY work_date`,
      [trendFrom, date],
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
      rows,
      trend,
      mood: {
        avg: moods.length ? avg(moods.map((x) => x.mood)) : null,
        count: moods.length,
        dist: [1, 2, 3, 4, 5].map((m) => moods.filter((x) => x.mood === m).length),
        by_department: Object.entries(byDept).map(([department, m]) => ({ department, avg: avg(m), count: m.length })),
      },
      pending: { leaves: Number(pending.leaves), rewards: Number(pending.rewards) },
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
                device_hash IS NOT NULL AS device_bound, device_label, device_bound_at,
                (SELECT COUNT(*) FROM device_blocks b WHERE b.user_id = users.id AND b.created_at > now() - interval '30 days') AS device_blocks
         FROM users ORDER BY role DESC, active DESC, name`,
      ),
      balancesByUser(db, month),
    ]);
    for (const u of users) {
      if (u.role === 'employee') u.balances = bal.get(u.id) || { green: 0, month: { green: 0, red: 0, black: 0 } };
    }
    res.json(users);
  });

  app.post('/api/admin/users', requireOwner, async (req, res) => {
    const s = await settings();
    const t = localToday(s);
    const name = str(req.body.name, 80);
    const username = str(req.body.username, 40);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = req.body.role === 'owner' ? 'owner' : 'employee';
    if (!name || !/^[\w.@-]{3,40}$/.test(username)) fail('Enter a name and a username (3+ letters, no spaces)');
    if (password.length < 6) fail('Password must be at least 6 characters');
    // Absences start counting today, or tomorrow if today's check-in window has already closed.
    const defaultStart = toMinutes(t.time) >= toMinutes(s.close) ? addDays(t.date, 1) : t.date;
    const startDate = isDate(req.body.start_date) ? req.body.start_date : defaultStart;
    if (await db.get('SELECT 1 FROM users WHERE lower(username) = lower(?)', [username])) {
      fail('Username already exists', 409);
    }
    const row = await db.get(
      `INSERT INTO users (name, username, password_hash, role, phone, job_title, start_date, department, birthday, remote_allowed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [name, username, auth.hashPassword(password), role, str(req.body.phone, 30) || null,
        str(req.body.job_title, 80) || null, startDate, str(req.body.department, 40) || null,
        isDate(req.body.birthday) ? req.body.birthday : null, req.body.remote_allowed ? 1 : 0],
    );
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
    if (b.reset_device) {
      fields.device_hash = null;
      fields.device_label = null;
      fields.device_bound_at = null;
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
    if ((fields.password_hash || fields.active === 0 || b.reset_device) && user.id !== req.user.id) {
      await db.run('DELETE FROM sessions WHERE user_id = ?', [user.id]);
    }
    res.json({ ok: true });
  });

  app.get('/api/admin/users/:id/history', requireOwner, async (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : localToday(await settings()).date.slice(0, 7);
    res.json(await historyFor(idParam(req), month));
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
    res.status(201).json({ ok: true });
  });

  app.get('/api/admin/leaves', requireOwner, async (req, res) => {
    const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
    res.json(
      await db.all(
        `SELECT l.*, u.name AS user_name FROM leave_requests l JOIN users u ON u.id = l.user_id
         WHERE (?::text IS NULL OR l.status = ?::text) ORDER BY l.status = 'pending' DESC, l.id DESC LIMIT 200`,
        [status, status],
      ),
    );
  });

  app.post('/api/admin/leaves/:id/decision', requireOwner, async (req, res) => {
    const decision = req.body.decision;
    if (!['approve', 'reject'].includes(decision)) fail('Invalid decision');
    await db.tx(async (tx) => {
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
    await db.tx(async (tx) => {
      const r = await tx.get(
        `UPDATE reward_requests SET status = ?, decided_by = ?, decided_at = now()
         WHERE id = ? AND status = 'pending' RETURNING *`,
        [decision === 'paid' ? 'paid' : 'rejected', req.user.id, idParam(req)],
      );
      if (!r) fail('Request not found or already decided', 404);
      if (decision === 'reject') await refundReward(tx, s, r, req.user.id);
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
      'Name', 'Job title', 'Days present', 'Early', 'On time', 'Late', 'Leave days',
      'Green (month)', 'Green balance', 'Red', 'Black (absences)', 'Red deduction', 'Black deduction', 'Total deduction',
    ];
    const keys = [
      'name', 'job_title', 'days_present', 'early', 'on_time', 'late', 'leave_days',
      'green_month', 'green_balance', 'red', 'black', 'red_deduction', 'black_deduction', 'total_deduction',
    ];
    const cell = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...rows.map((r) => keys.map((k) => r[k]))].map((line) => line.map(cell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${month}.csv"`);
    res.send(`﻿${csv}`);
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
    const next = validateSettings({ ...(await settings()), ...req.body });
    await saveSettings(db, next);
    res.json(next);
  });

  // ---------- Helpers ----------

  function refundReward(tx, s, r, by) {
    return addPoints(tx, {
      userId: r.user_id, kind: 'green', delta: r.points, workDate: localToday(s).date,
      source: 'reward_refund', reason: 'Reward request refund', refId: r.id, createdBy: by,
    });
  }

  // Current streak of early / on-time work days and this month's attendance rate.
  async function attendanceStats(user, s, t) {
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
    'departments', 'kudos_daily_limit', 'kudos_green',
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
  return out;
}

module.exports = { createApp };
