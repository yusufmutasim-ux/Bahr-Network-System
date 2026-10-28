const path = require('node:path');
const express = require('express');
const { getSettings, saveSettings, tx } = require('./db');
const { localNow, addDays, toMinutes, eachDate, isDate, isTime, isMonth } = require('./time');
const {
  RuleError,
  isWorkDay,
  classifyCheckIn,
  checkGeofence,
  addPoints,
  balances,
  hasApprovedLeave,
  runAbsenceJob,
  monthReport,
} = require('./logic');
const auth = require('./auth');

const PAYOUT_METHODS = ['instapay', 'vodafone_cash', 'cash'];

function fail(message, status = 400) {
  throw new RuleError(message, status);
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const posInt = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

function createApp(db, { now = () => new Date() } = {}) {
  const app = express();
  app.disable('x-powered-by');
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
  const today = () => localNow(settings().timezone, now());

  function requireUser(req, res, next) {
    const user = auth.sessionUser(db, req);
    if (!user) return res.status(401).json({ error: 'Please log in first' });
    req.user = user;
    next();
  }

  function requireOwner(req, res, next) {
    requireUser(req, res, () => {
      if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner access only' });
      next();
    });
  }

  function requireEmployee(req, res, next) {
    requireUser(req, res, () => {
      if (req.user.role !== 'employee') return res.status(403).json({ error: 'Employee access only' });
      next();
    });
  }

  // ---------- Public ----------

  app.get('/api/time', (req, res) => {
    const s = settings();
    res.json({ ...localNow(s.timezone, now()), timezone: s.timezone, company_name: s.company_name });
  });

  app.get('/api/setup', (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    res.json({ needsSetup: count === 0, company_name: settings().company_name });
  });

  app.post('/api/setup', (req, res) => {
    const name = str(req.body.name, 80);
    const username = str(req.body.username, 40);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!name || !username) fail('Name and username are required');
    if (password.length < 6) fail('Password must be at least 6 characters');
    const user = tx(db, () => {
      if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) fail('System is already set up', 409);
      const companyName = str(req.body.company_name, 80);
      if (companyName) saveSettings(db, { ...settings(), company_name: companyName });
      const info = db
        .prepare(`INSERT INTO users (name, username, password_hash, role, start_date) VALUES (?, ?, ?, 'owner', ?)`)
        .run(name, username, auth.hashPassword(password), today().date);
      return Number(info.lastInsertRowid);
    });
    const session = auth.createSession(db, user);
    auth.setSessionCookie(res, session.token, session.expires);
    res.status(201).json({ ok: true });
  });

  app.post('/api/login', (req, res) => {
    const username = str(req.body.username, 40);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (auth.loginBlocked(key)) fail('Too many failed attempts. Try again in 15 minutes.', 429);
    const user = db.prepare('SELECT id, password_hash, active FROM users WHERE username = ?').get(username);
    if (!user || !user.active || !auth.verifyPassword(password, user.password_hash)) {
      auth.recordLoginFailure(key);
      fail('Wrong username or password', 401);
    }
    auth.clearLoginFailures(key);
    const session = auth.createSession(db, user.id);
    auth.setSessionCookie(res, session.token, session.expires);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const user = auth.sessionUser(db, req);
    if (user) db.prepare('DELETE FROM sessions WHERE token = ?').run(user.token);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/me', requireUser, (req, res) => {
    const { token, ...user } = req.user;
    res.json({ user, company_name: settings().company_name });
  });

  app.post('/api/me/password', requireUser, (req, res) => {
    const { current, next } = req.body;
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (typeof current !== 'string' || !auth.verifyPassword(current, row.password_hash)) fail('Current password is wrong');
    if (typeof next !== 'string' || next.length < 6) fail('New password must be at least 6 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(next), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.user.token);
    res.json({ ok: true });
  });

  // ---------- Employee ----------

  app.get('/api/me/dashboard', requireEmployee, (req, res) => {
    const s = settings();
    const t = today();
    const month = t.date.slice(0, 7);
    const attendance = db
      .prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?')
      .get(req.user.id, t.date);
    const b = balances(db, req.user.id, month);
    const red = Math.max(0, b.month.red);
    const black = Math.max(0, b.month.black);
    res.json({
      now: t,
      work_day: isWorkDay(t.date, s),
      on_leave: hasApprovedLeave(db, req.user.id, t.date),
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

  app.post('/api/me/check-in', requireEmployee, (req, res) => {
    const s = settings();
    const t = today();
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    const accuracy = req.body.accuracy == null ? NaN : Number(req.body.accuracy);
    const distance = checkGeofence({ lat, lng, accuracy }, s);
    const result = isWorkDay(t.date, s) ? classifyCheckIn(t.time, s) : { status: 'off_day', green: 0, red: 0 };
    const record = tx(db, () => {
      if (db.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND work_date = ?').get(req.user.id, t.date)) {
        fail('You already checked in today', 409);
      }
      const info = db
        .prepare(
          `INSERT INTO attendance (user_id, work_date, check_in_time, check_in_at, status, lat, lng, accuracy, distance_m)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(req.user.id, t.date, t.time, now().toISOString(), result.status, lat, lng, accuracy || null, distance);
      const id = Number(info.lastInsertRowid);
      if (result.green) {
        addPoints(db, {
          userId: req.user.id, kind: 'green', delta: result.green, workDate: t.date,
          source: 'early', reason: `Early check-in ${t.time}`, refId: id,
        });
      }
      if (result.red) {
        addPoints(db, {
          userId: req.user.id, kind: 'red', delta: result.red, workDate: t.date,
          source: 'late', reason: `Late check-in ${t.time}`, refId: id,
        });
      }
      return db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
    });
    res.status(201).json({ attendance: record, green: result.green, red: result.red });
  });

  app.post('/api/me/check-out', requireEmployee, (req, res) => {
    const t = today();
    const row = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?').get(req.user.id, t.date);
    if (!row) fail('You need to check in first');
    if (row.check_out_time) fail('You already checked out today', 409);
    db.prepare('UPDATE attendance SET check_out_time = ?, check_out_at = ? WHERE id = ?').run(
      t.time,
      now().toISOString(),
      row.id,
    );
    res.json({ attendance: db.prepare('SELECT * FROM attendance WHERE id = ?').get(row.id) });
  });

  // Spend 1 green point to cancel 1 red penalty from the current month.
  app.post('/api/me/redeem', requireEmployee, (req, res) => {
    const t = today();
    tx(db, () => {
      const b = balances(db, req.user.id, t.date.slice(0, 7));
      if (b.green < 1) fail('Not enough green points');
      if (b.month.red < 1) fail('No red penalties this month');
      const reason = 'Used 1 green point to remove 1 red penalty';
      addPoints(db, { userId: req.user.id, kind: 'green', delta: -1, workDate: t.date, source: 'redeem', reason });
      addPoints(db, { userId: req.user.id, kind: 'red', delta: -1, workDate: t.date, source: 'redeem', reason });
    });
    res.json({ ok: true });
  });

  app.get('/api/me/history', requireEmployee, (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : today().date.slice(0, 7);
    res.json(historyFor(req.user.id, month));
  });

  app.get('/api/me/leaves', requireEmployee, (req, res) => {
    res.json(db.prepare('SELECT * FROM leave_requests WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id));
  });

  app.post('/api/me/leaves', requireEmployee, (req, res) => {
    const { from_date: from, to_date: to } = req.body;
    if (!isDate(from) || !isDate(to)) fail('Choose start and end dates');
    if (to < from) fail('End date must be on or after start date');
    if (eachDate(from, to).length > 60) fail('Leave can be at most 60 days');
    const info = db
      .prepare('INSERT INTO leave_requests (user_id, from_date, to_date, reason) VALUES (?, ?, ?, ?)')
      .run(req.user.id, from, to, str(req.body.reason, 500) || null);
    res.status(201).json(db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(info.lastInsertRowid));
  });

  app.post('/api/me/leaves/:id/cancel', requireEmployee, (req, res) => {
    const info = db
      .prepare(`UPDATE leave_requests SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'`)
      .run(req.params.id, req.user.id);
    if (!info.changes) fail('Request not found or no longer pending', 404);
    res.json({ ok: true });
  });

  app.get('/api/me/rewards', requireEmployee, (req, res) => {
    res.json(db.prepare('SELECT * FROM reward_requests WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id));
  });

  // Points are reserved (deducted) when the request is made and refunded if it's rejected or cancelled.
  app.post('/api/me/rewards', requireEmployee, (req, res) => {
    const s = settings();
    const t = today();
    const points = posInt(req.body.points);
    const method = req.body.method;
    const number = str(req.body.payout_number, 40);
    if (!points) fail('Enter the number of points');
    if (points < s.min_reward_points) fail(`Minimum reward request is ${s.min_reward_points} points`);
    if (!PAYOUT_METHODS.includes(method)) fail('Choose a payout method');
    if (method !== 'cash' && !/^[0-9+\s@._a-zA-Z-]{4,40}$/.test(number)) fail('Enter your wallet number / InstaPay address');
    const row = tx(db, () => {
      if (balances(db, req.user.id, t.date.slice(0, 7)).green < points) fail('Not enough green points');
      const info = db
        .prepare('INSERT INTO reward_requests (user_id, points, amount, method, payout_number) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.id, points, points * s.green_value, method, number || null);
      const id = Number(info.lastInsertRowid);
      addPoints(db, {
        userId: req.user.id, kind: 'green', delta: -points, workDate: t.date,
        source: 'reward', reason: 'Reward request', refId: id,
      });
      return db.prepare('SELECT * FROM reward_requests WHERE id = ?').get(id);
    });
    res.status(201).json(row);
  });

  app.post('/api/me/rewards/:id/cancel', requireEmployee, (req, res) => {
    tx(db, () => {
      const r = db
        .prepare(`SELECT * FROM reward_requests WHERE id = ? AND user_id = ? AND status = 'pending'`)
        .get(req.params.id, req.user.id);
      if (!r) fail('Request not found or no longer pending', 404);
      db.prepare(`UPDATE reward_requests SET status = 'cancelled' WHERE id = ?`).run(r.id);
      refundReward(r, null);
    });
    res.json({ ok: true });
  });

  // ---------- Owner ----------

  app.get('/api/admin/overview', requireOwner, (req, res) => {
    const s = settings();
    const t = today();
    const date = isDate(req.query.date) ? req.query.date : t.date;
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.job_title, u.start_date, a.check_in_time, a.check_out_time, a.status, a.distance_m
         FROM users u LEFT JOIN attendance a ON a.user_id = u.id AND a.work_date = ?
         WHERE u.role = 'employee' AND u.active = 1 ORDER BY a.check_in_time IS NULL, a.check_in_time, u.name`,
      )
      .all(date);
    const closed = date < t.date || (date === t.date && toMinutes(t.time) >= toMinutes(s.close));
    for (const r of rows) {
      if (r.status) continue;
      if (date < r.start_date) r.status = 'not_started';
      else if (hasApprovedLeave(db, r.id, date)) r.status = 'leave';
      else if (!isWorkDay(date, s)) r.status = 'off_day';
      else r.status = closed ? 'absent' : 'waiting';
    }
    const count = (sql) => db.prepare(sql).get().n;
    res.json({
      date,
      now: t,
      work_day: isWorkDay(date, s),
      rows,
      pending: {
        leaves: count(`SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'`),
        rewards: count(`SELECT COUNT(*) AS n FROM reward_requests WHERE status = 'pending'`),
      },
      rules: pickRules(s),
    });
  });

  app.get('/api/admin/users', requireOwner, (req, res) => {
    const month = today().date.slice(0, 7);
    const users = db
      .prepare(
        `SELECT id, name, username, role, phone, job_title, active, start_date, created_at
         FROM users ORDER BY role DESC, active DESC, name`,
      )
      .all();
    for (const u of users) if (u.role === 'employee') u.balances = balances(db, u.id, month);
    res.json(users);
  });

  app.post('/api/admin/users', requireOwner, (req, res) => {
    const s = settings();
    const t = today();
    const name = str(req.body.name, 80);
    const username = str(req.body.username, 40);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = req.body.role === 'owner' ? 'owner' : 'employee';
    if (!name || !/^[\w.@-]{3,40}$/.test(username)) fail('Enter a name and a username (3+ letters, no spaces)');
    if (password.length < 6) fail('Password must be at least 6 characters');
    // Absences start counting today, or tomorrow if today's check-in window has already closed.
    const defaultStart = toMinutes(t.time) >= toMinutes(s.close) ? addDays(t.date, 1) : t.date;
    const startDate = isDate(req.body.start_date) ? req.body.start_date : defaultStart;
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail('Username already exists', 409);
    const info = db
      .prepare(
        `INSERT INTO users (name, username, password_hash, role, phone, job_title, start_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(name, username, auth.hashPassword(password), role, str(req.body.phone, 30) || null,
        str(req.body.job_title, 80) || null, startDate);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.patch('/api/admin/users/:id', requireOwner, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) fail('User not found', 404);
    const b = req.body;
    const fields = {};
    if (b.name !== undefined) fields.name = str(b.name, 80) || fail('Name is required');
    if (b.phone !== undefined) fields.phone = str(b.phone, 30) || null;
    if (b.job_title !== undefined) fields.job_title = str(b.job_title, 80) || null;
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
      db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
        ...keys.map((k) => fields[k]),
        user.id,
      );
    }
    if (fields.password_hash || fields.active === 0) {
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND user_id != ?').run(user.id, req.user.id);
    }
    res.json({ ok: true });
  });

  app.get('/api/admin/users/:id/history', requireOwner, (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : today().date.slice(0, 7);
    res.json(historyFor(Number(req.params.id), month));
  });

  app.post('/api/admin/points', requireOwner, (req, res) => {
    const t = today();
    const userId = posInt(req.body.user_id);
    const kind = req.body.kind;
    const delta = Number(req.body.delta);
    const reason = str(req.body.reason, 300);
    const workDate = isDate(req.body.work_date) ? req.body.work_date : t.date;
    if (!['green', 'red', 'black'].includes(kind)) fail('Choose a point type');
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100) fail('Points must be a whole number between -100 and 100');
    if (!reason) fail('Reason is required');
    tx(db, () => {
      const user = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'employee'`).get(userId);
      if (!user) fail('Employee not found', 404);
      if (kind === 'green' && delta < 0 && balances(db, userId, t.date.slice(0, 7)).green + delta < 0) {
        fail('Green balance cannot go below zero');
      }
      addPoints(db, { userId, kind, delta, workDate, source: 'manual', reason, createdBy: req.user.id });
    });
    res.status(201).json({ ok: true });
  });

  app.get('/api/admin/points', requireOwner, (req, res) => {
    const userId = posInt(req.query.user_id);
    const rows = db
      .prepare(
        `SELECT p.*, u.name AS user_name, c.name AS created_by_name
         FROM points p JOIN users u ON u.id = p.user_id LEFT JOIN users c ON c.id = p.created_by
         WHERE (? IS NULL OR p.user_id = ?) ORDER BY p.id DESC LIMIT 200`,
      )
      .all(userId, userId);
    res.json(rows);
  });

  // Manual attendance, e.g. when an employee's GPS failed. Clears that day's automatic absence.
  app.post('/api/admin/attendance', requireOwner, (req, res) => {
    const userId = posInt(req.body.user_id);
    const { work_date: date, time, status } = req.body;
    if (!isDate(date) || !isTime(time)) fail('Enter date and time');
    if (!['early', 'on_time', 'late', 'very_late', 'off_day'].includes(status)) fail('Choose a status');
    if (date > today().date) fail('Cannot record attendance for a future date');
    tx(db, () => {
      if (!db.prepare(`SELECT 1 FROM users WHERE id = ? AND role = 'employee'`).get(userId)) fail('Employee not found', 404);
      if (db.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND work_date = ?').get(userId, date)) {
        fail('Attendance already recorded for that day', 409);
      }
      db.prepare(
        `INSERT INTO attendance (user_id, work_date, check_in_time, check_in_at, status) VALUES (?, ?, ?, ?, ?)`,
      ).run(userId, date, time, now().toISOString(), status);
      db.prepare(`DELETE FROM points WHERE user_id = ? AND work_date = ? AND source = 'absent'`).run(userId, date);
    });
    res.status(201).json({ ok: true });
  });

  app.get('/api/admin/leaves', requireOwner, (req, res) => {
    const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
    res.json(
      db
        .prepare(
          `SELECT l.*, u.name AS user_name FROM leave_requests l JOIN users u ON u.id = l.user_id
           WHERE (? IS NULL OR l.status = ?) ORDER BY l.status = 'pending' DESC, l.id DESC LIMIT 200`,
        )
        .all(status, status),
    );
  });

  app.post('/api/admin/leaves/:id/decision', requireOwner, (req, res) => {
    const decision = req.body.decision;
    if (!['approve', 'reject'].includes(decision)) fail('Invalid decision');
    tx(db, () => {
      const l = db.prepare(`SELECT * FROM leave_requests WHERE id = ? AND status = 'pending'`).get(req.params.id);
      if (!l) fail('Request not found or already decided', 404);
      db.prepare(`UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`).run(
        decision === 'approve' ? 'approved' : 'rejected',
        req.user.id,
        l.id,
      );
      if (decision === 'approve') {
        // Approved leave cancels absences already recorded for those days.
        db.prepare(
          `DELETE FROM points WHERE user_id = ? AND source = 'absent' AND work_date BETWEEN ? AND ?`,
        ).run(l.user_id, l.from_date, l.to_date);
      }
    });
    res.json({ ok: true });
  });

  app.get('/api/admin/rewards', requireOwner, (req, res) => {
    const status = ['pending', 'paid', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
    res.json(
      db
        .prepare(
          `SELECT r.*, u.name AS user_name FROM reward_requests r JOIN users u ON u.id = r.user_id
           WHERE (? IS NULL OR r.status = ?) ORDER BY r.status = 'pending' DESC, r.id DESC LIMIT 200`,
        )
        .all(status, status),
    );
  });

  app.post('/api/admin/rewards/:id/decision', requireOwner, (req, res) => {
    const decision = req.body.decision;
    if (!['paid', 'reject'].includes(decision)) fail('Invalid decision');
    tx(db, () => {
      const r = db.prepare(`SELECT * FROM reward_requests WHERE id = ? AND status = 'pending'`).get(req.params.id);
      if (!r) fail('Request not found or already decided', 404);
      db.prepare(`UPDATE reward_requests SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`).run(
        decision === 'paid' ? 'paid' : 'rejected',
        req.user.id,
        r.id,
      );
      if (decision === 'reject') refundReward(r, req.user.id);
    });
    res.json({ ok: true });
  });

  app.get('/api/admin/report', requireOwner, (req, res) => {
    runAbsenceJob(db, settings(), now());
    const month = isMonth(req.query.month) ? req.query.month : today().date.slice(0, 7);
    res.json({ month, rows: monthReport(db, settings(), month) });
  });

  app.get('/api/admin/report.csv', requireOwner, (req, res) => {
    runAbsenceJob(db, settings(), now());
    const month = isMonth(req.query.month) ? req.query.month : today().date.slice(0, 7);
    const rows = monthReport(db, settings(), month);
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

  app.get('/api/admin/settings', requireOwner, (req, res) => res.json(settings()));

  app.put('/api/admin/settings', requireOwner, (req, res) => {
    const next = validateSettings({ ...settings(), ...req.body });
    saveSettings(db, next);
    res.json(next);
  });

  // ---------- Helpers ----------

  function refundReward(r, by) {
    addPoints(db, {
      userId: r.user_id, kind: 'green', delta: r.points, workDate: today().date,
      source: 'reward_refund', reason: 'Reward request refund', refId: r.id, createdBy: by,
    });
  }

  function historyFor(userId, month) {
    const like = `${month}-%`;
    return {
      month,
      attendance: db
        .prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date LIKE ? ORDER BY work_date DESC')
        .all(userId, like),
      points: db
        .prepare('SELECT * FROM points WHERE user_id = ? AND work_date LIKE ? ORDER BY id DESC')
        .all(userId, like),
      balances: balances(db, userId, month),
    };
  }

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err, req, res, next) => {
    if (err instanceof RuleError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}

function pickRules(s) {
  const keys = [
    'company_name', 'currency', 'early_start', 'early_end', 'late_after', 'very_late_after', 'close',
    'very_late_reds', 'work_days', 'red_value', 'black_value', 'green_value', 'min_reward_points', 'radius_m',
  ];
  return Object.fromEntries(keys.map((k) => [k, s[k]]));
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
  return out;
}

module.exports = { createApp };
