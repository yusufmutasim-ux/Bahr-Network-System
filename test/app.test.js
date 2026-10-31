const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connect, getSettings } = require('../src/db');
const { createApp } = require('../src/app');
const { runAbsenceJob, classifyCheckIn, distanceMeters } = require('../src/logic');

// Office at a fixed point; "near" is ~50 m away, "far" is ~1.1 km away.
const OFFICE = { lat: 27.9158, lng: 34.33 };
const NEAR = { lat: 27.9162, lng: 34.33, accuracy: 20 };
const FAR = { lat: 27.9258, lng: 34.33, accuracy: 20 };

// Cairo is UTC+2 (or +3 in summer); build a Date for a given Cairo wall-clock time.
function cairo(date, time) {
  for (const offset of [2, 3]) {
    const d = new Date(`${date}T${time}:00+0${offset}:00`);
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    if (local === time) return d;
  }
  throw new Error('bad time');
}

let server;
let base;
let db;
let clock = cairo('2026-01-04', '09:00'); // Sunday

// A tiny browser: keeps a cookie jar (session + device cookies). `jar` is exposed for device tests.
const UA = {
  phone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  laptop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};
function client(ua = UA.phone) {
  const jar = new Map();
  const call = async (path, { method = 'GET', body } = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'User-Agent': ua, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const [k, v] = [pair.slice(0, i), pair.slice(i + 1)];
      if (/Max-Age=0/.test(c)) jar.delete(k);
      else jar.set(k, v);
    }
    const text = await res.text();
    return { status: res.status, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
  };
  call.jar = jar;
  return call;
}

const owner = client();
const emp = client();
let empId;

before(async () => {
  // Uses embedded PGlite by default; set TEST_DATABASE_URL to run against a real (empty) Postgres.
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  db = connect(process.env.TEST_DATABASE_URL);
  await db.ready;
  const app = createApp(db, { now: () => clock });
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await db.close();
});

test('pure rules', async () => {
  const s = await getSettings(db);
  assert.equal(classifyCheckIn('07:30', s).status, 'early');
  assert.equal(classifyCheckIn('09:59', s).status, 'on_time');
  assert.deepEqual(classifyCheckIn('10:30', s), { status: 'late', green: 0, red: 1 });
  assert.deepEqual(classifyCheckIn('11:15', s), { status: 'very_late', green: 0, red: 2 });
  assert.throws(() => classifyCheckIn('06:00', s));
  assert.throws(() => classifyCheckIn('12:00', s));
  assert.ok(Math.abs(distanceMeters(0, 0, 0, 1) - 111195) < 10);
});

test('setup, settings and staff', async () => {
  assert.equal((await owner('/setup')).body.needsSetup, true);
  assert.equal((await owner('/setup', { method: 'POST', body: { name: 'Boss', username: 'boss', password: 'secret1' } })).status, 201);
  assert.equal((await owner('/setup', { method: 'POST', body: { name: 'X', username: 'xyz', password: 'secret1' } })).status, 409);
  const s = (await owner('/admin/settings')).body;
  const put = await owner('/admin/settings', { method: 'PUT', body: { ...s, office_lat: OFFICE.lat, office_lng: OFFICE.lng } });
  assert.equal(put.status, 200);
  const bad = await owner('/admin/settings', { method: 'PUT', body: { ...s, early_end: '06:00' } });
  assert.equal(bad.status, 400);
  const add = await owner('/admin/users', { method: 'POST', body: { name: 'Omar', username: 'omar', password: 'pass123' } });
  assert.equal(add.status, 201);
  empId = add.body.id;
  assert.equal((await emp('/login', { method: 'POST', body: { username: 'omar', password: 'nope' } })).status, 401);
  assert.equal((await emp('/login', { method: 'POST', body: { username: 'omar', password: 'pass123' } })).status, 200);
  assert.equal((await emp('/admin/users')).status, 403);
});

test('early check-in gives a green point, geofence enforced', async () => {
  clock = cairo('2026-01-04', '07:30');
  const far = await emp('/me/check-in', { method: 'POST', body: FAR });
  assert.equal(far.status, 400);
  assert.match(far.body.error, /from the office/);
  const ok = await emp('/me/check-in', { method: 'POST', body: NEAR });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.attendance.status, 'early');
  assert.equal(ok.body.green, 1);
  assert.equal((await emp('/me/check-in', { method: 'POST', body: NEAR })).status, 409);
  assert.equal((await emp('/me/check-out', { method: 'POST', body: {} })).status, 200);
});

test('late check-in gives red, redeem swaps green for red', async () => {
  clock = cairo('2026-01-05', '10:15');
  const r = await emp('/me/check-in', { method: 'POST', body: NEAR });
  assert.equal(r.body.red, 1);
  let d = (await emp('/me/dashboard')).body;
  assert.equal(d.balances.green, 1);
  assert.equal(d.balances.month.red, 1);
  assert.equal(d.deductions.total, 250);
  assert.equal((await emp('/me/redeem', { method: 'POST', body: {} })).status, 200);
  d = (await emp('/me/dashboard')).body;
  assert.equal(d.balances.green, 0);
  assert.equal(d.deductions.total, 0);
  assert.equal((await emp('/me/redeem', { method: 'POST', body: {} })).status, 400);
});

test('absences become black points unless leave is approved', async () => {
  // Jan 6 (Tue) & Jan 7 (Wed) missed, Jan 8 (Thu) after close.
  const leave = await emp('/me/leaves', { method: 'POST', body: { from_date: '2026-01-07', to_date: '2026-01-07', reason: 'Sick leave' } });
  assert.equal(leave.status, 201);
  clock = cairo('2026-01-08', '12:30');
  const s = await getSettings(db);
  assert.equal(await runAbsenceJob(db, s, clock), 3); // 6th, 7th (leave still pending), 8th
  assert.equal(await runAbsenceJob(db, s, clock), 0); // idempotent
  assert.equal((await owner(`/admin/leaves/${leave.body.id}/decision`, { method: 'POST', body: { decision: 'approve' } })).status, 200);
  assert.equal(await runAbsenceJob(db, s, clock), 0);
  const d = (await emp('/me/dashboard')).body;
  assert.equal(d.balances.month.black, 2);
  assert.equal(d.deductions.total, 2000);
  // Manual attendance clears the absence for that day.
  assert.equal((await owner('/admin/attendance', { method: 'POST', body: { user_id: empId, work_date: '2026-01-06', time: '09:00', status: 'on_time' } })).status, 201);
  const rep = (await owner('/admin/report?month=2026-01')).body.rows[0];
  assert.equal(rep.black, 1);
  assert.equal(rep.leave_days, 1);
  assert.equal(rep.days_present, 3);
  assert.equal(rep.total_deduction, 1000);
  // Friday Jan 9 is not a work day: no black.
  clock = cairo('2026-01-10', '07:10');
  assert.equal(await runAbsenceJob(db, s, clock), 0);
});

test('owner adjusts points and reward requests reserve/refund points', async () => {
  const adj = await owner('/admin/points', { method: 'POST', body: { user_id: empId, kind: 'green', delta: 12, reason: 'Great month' } });
  assert.equal(adj.status, 201);
  assert.equal((await owner('/admin/points', { method: 'POST', body: { user_id: empId, kind: 'green', delta: 1 } })).status, 400);
  assert.equal((await emp('/me/rewards', { method: 'POST', body: { points: 5, method: 'instapay', payout_number: '01012345678' } })).status, 400);
  const req = await emp('/me/rewards', { method: 'POST', body: { points: 10, method: 'vodafone_cash', payout_number: '01012345678' } });
  assert.equal(req.status, 201);
  assert.equal(req.body.amount, 500);
  assert.equal((await emp('/me/dashboard')).body.balances.green, 2);
  await owner(`/admin/rewards/${req.body.id}/decision`, { method: 'POST', body: { decision: 'reject' } });
  assert.equal((await emp('/me/dashboard')).body.balances.green, 12);
  const csv = await owner('/admin/report.csv?month=2026-01');
  assert.match(csv.body, /Total deduction/);
});

test('concurrent check-ins only record one', async () => {
  const c = client();
  await owner('/admin/users', { method: 'POST', body: { name: 'Race', username: 'race', password: 'pass123' } });
  await c('/login', { method: 'POST', body: { username: 'race', password: 'pass123' } });
  clock = cairo('2026-01-11', '09:00');
  const results = await Promise.all([1, 2, 3].map(() => c('/me/check-in', { method: 'POST', body: NEAR })));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
});

test('feed, leaderboard, streak and trend', async () => {
  const feed = await owner('/admin/feed');
  assert.equal(feed.status, 200);
  assert.ok(feed.body.some((f) => f.type === 'checkin'));
  assert.ok(feed.body.some((f) => f.type === 'reward'));
  const lb = await emp('/leaderboard?month=2026-01');
  assert.equal(lb.status, 200);
  assert.equal(lb.body.rows[0].name, 'Omar');
  clock = cairo('2026-01-12', '07:45');
  const d = (await emp('/me/dashboard')).body;
  assert.equal(typeof d.streak, 'number');
  assert.ok(d.month_stats.work_days > 0);
  const o = (await owner('/admin/overview')).body;
  assert.equal(o.trend.length, 7);
});

test('culture: kudos, reactions, limits, mood, announcements, achievements', async () => {
  clock = cairo('2026-01-13', '09:30');
  const people = (await emp('/people')).body;
  const boss = people.find((p) => p.role === 'owner');
  const race = people.find((p) => p.name === 'Race');
  assert.ok(boss && race);
  assert.equal((await emp('/kudos', { method: 'POST', body: { to_user_id: empId, category: 'creative' } })).status, 400);
  const k = await emp('/kudos', { method: 'POST', body: { to_user_id: race.id, category: 'creative', message: 'Great reel!' } });
  assert.equal(k.status, 201);
  await emp('/kudos', { method: 'POST', body: { to_user_id: race.id, category: 'teamwork' } });
  await emp('/kudos', { method: 'POST', body: { to_user_id: boss.id, category: 'mentor' } });
  assert.equal((await emp('/kudos', { method: 'POST', body: { to_user_id: race.id, category: 'good_vibes' } })).status, 429);
  assert.equal((await owner('/kudos', { method: 'POST', body: { to_user_id: empId, category: 'client_hero' } })).status, 201);
  assert.equal((await owner(`/kudos/${k.body.id}/react`, { method: 'POST', body: { emoji: '🔥' } })).body.reacted, true);
  const wall = (await emp('/kudos')).body;
  assert.equal(wall.sent_today, 3);
  assert.deepEqual(wall.rows.find((r) => r.id === k.body.id).reactions, [{ emoji: '🔥', n: 1, mine: false }]);
  assert.equal((await owner(`/kudos/${k.body.id}/react`, { method: 'POST', body: { emoji: '🔥' } })).body.reacted, false);

  assert.equal((await emp('/me/mood', { method: 'POST', body: { mood: 4 } })).status, 400); // not checked in on 13th
  await emp('/me/check-in', { method: 'POST', body: NEAR });
  assert.equal((await emp('/me/mood', { method: 'POST', body: { mood: 4 } })).status, 200);
  const o = (await owner('/admin/overview')).body;
  assert.equal(o.mood.avg, 4);

  const a = await owner('/admin/announcements', { method: 'POST', body: { title: 'Team lunch Thursday 🍕', kind: 'event', pinned: true } });
  assert.equal(a.status, 201);
  assert.equal((await emp('/admin/announcements', { method: 'POST', body: { title: 'x' } })).status, 403);
  assert.equal((await emp('/announcements')).body[0].title, 'Team lunch Thursday 🍕');

  const ach = (await emp('/me/achievements')).body;
  assert.ok(ach.level.xp > 0);
  assert.ok(ach.badges.find((b) => b.key === 'cheerleader').progress === 3);
  const profile = (await emp(`/people/${race.id}`)).body;
  assert.equal(profile.kudos.length, 2);
  const lb = (await emp('/leaderboard?month=2026-01')).body;
  assert.ok(Array.isArray(lb.departments) && lb.kudos[0].name === 'Race');
});

test('remote-enabled staff can check in away from the office', async () => {
  const add = await owner('/admin/users', { method: 'POST', body: { name: 'Shooter', username: 'shooter', password: 'pass123', remote_allowed: true, department: 'Video Production' } });
  const c = client();
  await c('/login', { method: 'POST', body: { username: 'shooter', password: 'pass123' } });
  clock = cairo('2026-01-14', '09:00');
  const r = await c('/me/check-in', { method: 'POST', body: FAR });
  assert.equal(r.status, 201);
  assert.equal(r.body.attendance.mode, 'remote');
  assert.ok(r.body.attendance.distance_m > 1000);
  assert.ok(add.body.id);
});

test('device lock: one phone + one laptop per employee, owner unrestricted', async () => {
  await owner('/admin/users', { method: 'POST', body: { name: 'Dev One', username: 'devone', password: 'pass123' } });
  await owner('/admin/users', { method: 'POST', body: { name: 'Dev Two', username: 'devtwo', password: 'pass123' } });
  const login = (c, username) => c('/login', { method: 'POST', body: { username, password: 'pass123' } });
  const phoneA = client(UA.phone);
  const laptopA = client(UA.laptop);
  const phoneB = client(UA.phone);
  const laptopB = client(UA.laptop);
  // First phone and first laptop are both registered.
  assert.equal((await login(phoneA, 'devone')).status, 200);
  assert.equal((await login(laptopA, 'devone')).status, 200);
  // A second phone or a second laptop is refused.
  const other = await login(phoneB, 'devone');
  assert.equal(other.status, 403);
  assert.equal(other.body.code, 'device_locked');
  assert.match(other.body.error, /phone registered/);
  assert.equal((await login(laptopB, 'devone')).status, 403);
  // Phone A can't be used for a colleague's account either.
  assert.equal((await login(phoneA, 'devtwo')).status, 403);
  // A copied session cookie without the device cookie is useless.
  const thief = client();
  thief.jar.set('bahr_sid', phoneA.jar.get('bahr_sid'));
  assert.equal((await thief('/me')).status, 401);
  assert.equal((await phoneA('/me')).status, 200);
  // Owner sees both devices + blocked attempts, then resets only the phone.
  const one = (await owner('/admin/users')).body.find((u) => u.username === 'devone');
  assert.deepEqual(one.devices.map((d) => d.kind).sort(), ['desktop', 'mobile']);
  assert.ok(Number(one.device_blocks) >= 2);
  assert.ok((await owner('/admin/feed')).body.some((f) => f.type === 'device'));
  await owner(`/admin/users/${one.id}`, { method: 'PATCH', body: { reset_device: 'mobile' } });
  assert.equal((await phoneA('/me')).status, 401); // phone signed out
  assert.equal((await laptopA('/me')).status, 200); // laptop untouched
  assert.equal((await login(phoneB, 'devone')).status, 200); // new phone registers
  // The owner can sign in from any number of devices.
  for (const ua of [UA.phone, UA.phone, UA.laptop, UA.laptop]) {
    assert.equal((await client(ua)('/login', { method: 'POST', body: { username: 'boss', password: 'secret1' } })).status, 200);
  }
  // With the lock turned off, any device works for employees too.
  const s = (await owner('/admin/settings')).body;
  await owner('/admin/settings', { method: 'PUT', body: { ...s, device_lock: false } });
  assert.equal((await login(client(), 'devone')).status, 200);
  await owner('/admin/settings', { method: 'PUT', body: { ...s, device_lock: true } });
});

test('push: key, subscribe, triggers never break requests, daily cron', async () => {
  const key = await emp('/push/key');
  assert.equal(key.status, 200);
  assert.ok(key.body.publicKey.length > 40);
  assert.equal((await emp('/push/subscribe', { method: 'POST', body: { endpoint: 'nope' } })).status, 400);
  // An unreachable push endpoint: sending fails, but the request that triggered it must still succeed.
  const sub = { endpoint: 'https://127.0.0.1:9/push/abc', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
  assert.equal((await owner('/push/subscribe', { method: 'POST', body: sub })).status, 201);
  assert.equal((await emp('/me/leaves', { method: 'POST', body: { from_date: '2026-02-01', to_date: '2026-02-01' } })).status, 201);
  assert.equal((await owner('/push/test', { method: 'POST', body: {} })).status, 400); // nothing delivered
  assert.equal((await owner('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } })).status, 200);
  const daily = await emp('/cron/daily');
  assert.equal(daily.status, 200);
  assert.equal(typeof daily.body.reminded, 'number');
});

test('official holidays: no absence, preset, dashboard', async () => {
  assert.equal((await emp('/admin/holidays', { method: 'POST', body: { date: '2026-02-03', name: 'Test Day' } })).status, 403);
  assert.equal((await owner('/admin/holidays', { method: 'POST', body: { date: '2026-02-03', name: 'Test Day' } })).status, 201);
  clock = cairo('2026-02-03', '13:00');
  await runAbsenceJob(db, await getSettings(db), clock);
  const absent = (d) => db.get(`SELECT 1 FROM points WHERE user_id = ? AND work_date = ? AND source = 'absent'`, [empId, d]);
  assert.ok(await absent('2026-02-02'));
  assert.ok(!(await absent('2026-02-03')));
  const d = (await emp('/me/dashboard')).body;
  assert.equal(d.work_day, false);
  assert.equal(d.holiday, 'Test Day');
  assert.equal((await owner('/admin/overview')).body.rows.find((r) => r.id === empId).status, 'holiday');
  assert.equal((await owner('/admin/holidays/preset', { method: 'POST', body: { year: 2026 } })).body.added, 7);
  const list = (await emp('/holidays?year=2026')).body;
  assert.ok(list.some((h) => h.date === '2026-01-25'));
  const extra = list.find((h) => h.name === 'Test Day');
  // Removing a holiday is allowed; the absence job may then record that day again.
  assert.equal((await owner(`/admin/holidays/${extra.id}/delete`, { method: 'POST', body: {} })).status, 200);
  await owner('/admin/holidays', { method: 'POST', body: { date: '2026-02-03', name: 'Test Day' } });
});

test('leave types and yearly balances', async () => {
  assert.equal((await owner(`/admin/users/${empId}`, { method: 'PATCH', body: { annual_leave: 3 } })).status, 200);
  const b = (await emp('/me/leave-balance?year=2026')).body.balance;
  // Jan 7 became a holiday (Coptic Christmas), so the approved day off no longer counts; Feb 1 is pending.
  assert.deepEqual(b.annual, { used: 0, pending: 1, allowance: 3, left: 2 });
  assert.equal(b.sick.allowance, 7);
  const tooMuch = await emp('/me/leaves', { method: 'POST', body: { type: 'annual', from_date: '2026-02-08', to_date: '2026-02-11' } });
  assert.equal(tooMuch.status, 400);
  assert.match(tooMuch.body.error, /2 left/);
  assert.equal((await emp('/me/leaves', { method: 'POST', body: { type: 'sick', from_date: '2026-02-08', to_date: '2026-02-11' } })).status, 201);
  assert.equal((await emp('/me/leaves', { method: 'POST', body: { type: 'holiday', from_date: '2026-02-08', to_date: '2026-02-08' } })).status, 400);
  assert.equal((await emp('/me/leaves', { method: 'POST', body: { from_date: '2026-02-06', to_date: '2026-02-06' } })).status, 400); // Friday off
  const unpaid = await emp('/me/leaves', { method: 'POST', body: { type: 'unpaid', from_date: '2026-03-15', to_date: '2026-03-15' } });
  assert.equal(unpaid.status, 201);
  await owner(`/admin/leaves/${unpaid.body.id}/decision`, { method: 'POST', body: { decision: 'approve' } });
  assert.equal((await emp('/me/leave-balance?year=2026')).body.balance.sick.left, 3);
});

test('attendance corrections: missing check-in and missing check-out', async () => {
  clock = cairo('2026-02-04', '13:00');
  await runAbsenceJob(db, await getSettings(db), clock);
  const body = { work_date: '2026-02-04', check_in_time: '09:30', check_out_time: '18:30', reason: 'Forgot to check in' };
  assert.equal((await emp('/me/corrections', { method: 'POST', body: { ...body, work_date: '2026-02-05' } })).status, 400); // future
  const c = await emp('/me/corrections', { method: 'POST', body });
  assert.equal(c.status, 201);
  assert.equal((await emp('/me/corrections', { method: 'POST', body })).status, 409);
  assert.equal((await owner(`/admin/corrections/${c.body.id}/decision`, { method: 'POST', body: { decision: 'approve' } })).status, 200);
  const att = await db.get('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?', [empId, '2026-02-04']);
  assert.equal(att.status, 'on_time');
  assert.equal(att.check_out_time, '18:30');
  assert.ok(!(await db.get(`SELECT 1 FROM points WHERE user_id = ? AND work_date = '2026-02-04' AND source = 'absent'`, [empId])));
  // Jan 13: checked in but never checked out.
  assert.equal((await emp('/me/corrections', { method: 'POST', body: { work_date: '2026-01-13', check_in_time: '09:00', reason: 'x' } })).status, 400);
  const out = await emp('/me/corrections', { method: 'POST', body: { work_date: '2026-01-13', check_out_time: '17:00', reason: 'Left in a hurry' } });
  assert.equal(out.status, 201);
  await owner(`/admin/corrections/${out.body.id}/decision`, { method: 'POST', body: { decision: 'approve' } });
  assert.equal((await db.get(`SELECT check_out_time FROM attendance WHERE user_id = ? AND work_date = '2026-01-13'`, [empId])).check_out_time, '17:00');
  assert.equal((await emp('/me/corrections')).body.length, 2);
});

const lead = client(UA.laptop);
const dina = client();
let dinaId;

test('team lead: department-scoped approvals and team board, no money or settings', async () => {
  const l = await owner('/admin/users', { method: 'POST', body: { name: 'Lina Lead', username: 'lina', password: 'pass123', role: 'lead', department: 'Design' } });
  const d = await owner('/admin/users', { method: 'POST', body: { name: 'Dina', username: 'dina', password: 'pass123', department: 'Design', start_date: '2026-02-01' } });
  dinaId = d.body.id;
  assert.equal((await lead('/login', { method: 'POST', body: { username: 'lina', password: 'pass123' } })).status, 200);
  assert.equal((await dina('/login', { method: 'POST', body: { username: 'dina', password: 'pass123' } })).status, 200);
  assert.equal((await lead('/me')).body.user.role, 'lead');
  assert.equal((await lead('/me/dashboard')).status, 200); // leads check in like everyone else
  const board = (await lead('/admin/overview')).body;
  assert.deepEqual(board.rows.map((r) => r.name), ['Dina']);
  assert.equal(board.scope, 'Design');
  const leave = await dina('/me/leaves', { method: 'POST', body: { from_date: '2026-02-10', to_date: '2026-02-10' } });
  const leaves = (await lead('/admin/leaves')).body;
  assert.ok(leaves.length && leaves.every((x) => x.user_name === 'Dina'));
  const omarLeave = (await owner('/admin/leaves?status=pending')).body.find((x) => x.user_id === empId);
  assert.equal((await lead(`/admin/leaves/${omarLeave.id}/decision`, { method: 'POST', body: { decision: 'approve' } })).status, 404);
  assert.equal((await lead(`/admin/leaves/${leave.body.id}/decision`, { method: 'POST', body: { decision: 'approve' } })).status, 200);
  assert.equal((await lead(`/admin/users/${empId}/history`)).status, 404);
  assert.equal((await lead(`/admin/users/${dinaId}/history`)).status, 200);
  for (const path of ['/admin/payroll', '/admin/settings', '/admin/users', '/admin/audit', '/admin/export.xlsx', '/admin/feed']) {
    assert.equal((await lead(path)).status, 403, path);
  }
  assert.equal((await lead('/admin/points', { method: 'POST', body: { user_id: dinaId, kind: 'green', delta: 1, reason: 'x' } })).status, 403);
  assert.ok(l.body.id);
});

test('department schedules, hours, overtime and payroll', async () => {
  const s = (await owner('/admin/settings')).body;
  const design = { early_start: '09:00', early_end: '10:00', late_after: '11:00', very_late_after: '12:00', close: '13:00', work_days: [0, 1, 2, 3, 4], daily_hours: 8 };
  const bad = await owner('/admin/settings', { method: 'PUT', body: { ...s, dept_schedules: { Design: { ...design, close: '08:00' } } } });
  assert.equal(bad.status, 400);
  assert.equal((await owner('/admin/settings', { method: 'PUT', body: { ...s, dept_schedules: { Design: design } } })).status, 200);
  assert.equal((await owner(`/admin/users/${dinaId}`, { method: 'PATCH', body: { salary: 22000 } })).status, 200);
  clock = cairo('2026-03-01', '10:30'); // Sunday: late for the company, on time for Design
  const r = await dina('/me/check-in', { method: 'POST', body: NEAR });
  assert.equal(r.body.attendance.status, 'on_time');
  clock = cairo('2026-03-01', '20:30');
  await dina('/me/check-out', { method: 'POST', body: {} });
  // Saturday is a day off for Design only.
  clock = cairo('2026-03-07', '23:00');
  await runAbsenceJob(db, await getSettings(db), clock);
  const absent = (u, d) => db.get(`SELECT 1 FROM points WHERE user_id = ? AND work_date = ? AND source = 'absent'`, [u, d]);
  assert.ok(!(await absent(dinaId, '2026-03-07')));
  assert.ok(await absent(empId, '2026-03-07'));
  assert.ok(await absent(dinaId, '2026-03-02'));

  const slip = (await dina('/me/payslip?month=2026-03')).body.row;
  assert.equal(slip.work_days, 23); // Sun–Thu in March 2026
  assert.equal(slip.hours_worked, 10);
  assert.equal(slip.overtime_hours, 2);
  const dayRate = 22000 / 23;
  assert.equal(slip.overtime_pay, Math.round(2 * (dayRate / 8) * 1.5 * 100) / 100);
  assert.equal(slip.net_pay, Math.round((22000 - slip.total_deduction + slip.overtime_pay) * 100) / 100);
  assert.equal((await dina('/me/payslip?month=2026-09')).status, 400);
  const pay = (await owner('/admin/payroll?month=2026-03')).body;
  const omar = pay.rows.find((x) => x.user_id === empId);
  assert.equal(omar.unpaid_days, 1);
  assert.equal(omar.salary, 0);
  assert.match((await owner('/admin/payroll.csv?month=2026-03')).body, /Net pay/);
});

test('weekly summary, activity log and Excel backup', async () => {
  const w = await emp('/cron/weekly');
  assert.equal(w.status, 200);
  assert.equal(typeof w.body.summary.rate, 'number');
  assert.equal((await owner('/admin/weekly-summary', { method: 'POST', body: {} })).status, 200);
  const log = (await owner('/admin/audit')).body;
  const actions = new Set(log.map((x) => x.action));
  for (const a of ['user.create', 'user.update', 'holiday.add', 'holiday.preset', 'correction.approve', 'leave.approve', 'settings.update', 'payroll.export']) {
    assert.ok(actions.has(a), a);
  }
  assert.ok(log.some((x) => x.action === 'leave.approve' && x.actor_name === 'Lina Lead' && x.target_name === 'Dina'));
  const res = await fetch(`${base}/api/admin/export.xlsx`, { headers: { Cookie: [...owner.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'User-Agent': UA.phone } });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.ok(wb.getWorksheet('Attendance').rowCount > 5);
  assert.ok(!wb.getWorksheet('Staff').getRow(1).values.includes('password_hash'));
});

test('tasks: account manager → department lead → team member, with review', async () => {
  const am = client(UA.laptop);
  await owner('/admin/users', { method: 'POST', body: { name: 'Amira AM', username: 'amira', password: 'pass123', department: 'Account Management' } });
  assert.equal((await am('/login', { method: 'POST', body: { username: 'amira', password: 'pass123' } })).status, 200);
  const body = { title: 'Ramadan reel', client: 'Nike', department: 'Design', priority: 'urgent', due_date: '2026-03-10', items: ['Script', 'Shoot', 'Edit'], assignee_id: dinaId };
  assert.equal((await emp('/tasks', { method: 'POST', body })).status, 403); // regular employee
  assert.equal((await am('/tasks', { method: 'POST', body: { ...body, department: 'Nope' } })).status, 400);
  const created = await am('/tasks', { method: 'POST', body });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.assignee_id, null); // AMs send work to the department, the lead picks the person
  assert.equal((await am('/tasks/meta')).body.is_am, true);

  // The Design lead sees it in the inbox; Dina doesn't see it yet.
  assert.deepEqual((await lead('/tasks?scope=inbox')).body.map((t) => t.id), [id]);
  assert.equal((await lead('/tasks/meta')).body.counts.inbox, 1);
  assert.ok((await lead('/tasks/meta')).body.people.every((p) => p.department === 'Design'));
  assert.equal((await dina(`/tasks/${id}`)).status, 404);
  assert.equal((await am(`/tasks/${id}`, { method: 'PATCH', body: { assignee_id: dinaId } })).status, 403);
  assert.equal((await lead(`/tasks/${id}`, { method: 'PATCH', body: { assignee_id: empId } })).status, 400); // not in Design
  assert.equal((await lead(`/tasks/${id}`, { method: 'PATCH', body: { assignee_id: dinaId } })).status, 200);

  // Dina works on it: ticking an item starts it; she can send it for review but not close it.
  const mine = (await dina('/tasks?scope=mine')).body;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].items_total, 3);
  const detail = (await dina(`/tasks/${id}`)).body;
  assert.equal(detail.can.manage, false);
  assert.equal(detail.can.work, true);
  await dina(`/tasks/${id}/items/${detail.items[0].id}/toggle`, { method: 'POST', body: {} });
  assert.equal((await dina(`/tasks/${id}`)).body.status, 'in_progress');
  assert.equal((await dina(`/tasks/${id}`, { method: 'PATCH', body: { title: 'x' } })).status, 403);
  assert.equal((await dina(`/tasks/${id}`, { method: 'PATCH', body: { status: 'done' } })).status, 403);
  assert.equal((await dina(`/tasks/${id}`, { method: 'PATCH', body: { status: 'review' } })).status, 200);
  assert.equal((await am('/tasks/meta')).body.counts.to_review, 1);
  // The AM sends it back with a comment, then approves the second round.
  assert.equal((await am(`/tasks/${id}/comments`, { method: 'POST', body: { body: 'Logo needs to be bigger' } })).status, 201);
  assert.equal((await am(`/tasks/${id}`, { method: 'PATCH', body: { status: 'in_progress' } })).status, 200);
  await dina(`/tasks/${id}`, { method: 'PATCH', body: { status: 'review' } });
  assert.equal((await am(`/tasks/${id}`, { method: 'PATCH', body: { status: 'done' } })).status, 200);
  const done = (await dina(`/tasks/${id}`)).body;
  assert.equal(done.status, 'done');
  assert.ok(done.completed_at);
  assert.ok(done.comments.some((c) => c.kind === 'comment' && c.user_name === 'Amira AM'));
  assert.ok(done.comments.some((c) => c.kind === 'event' && /sent it back/.test(c.body)));
  assert.ok(done.comments.some((c) => c.kind === 'event' && /assigned the task to Dina/.test(c.body)));

  // Moving a task to another department sends it to that department's inbox and out of Design's view.
  const t2 = (await am('/tasks', { method: 'POST', body: { title: 'Caption pack', department: 'Design' } })).body;
  assert.equal((await am(`/tasks/${t2.id}`, { method: 'PATCH', body: { department: 'Content' } })).status, 200);
  assert.equal((await lead(`/tasks/${t2.id}`)).status, 404);
  assert.equal((await owner('/tasks?scope=all')).body.length, 2);
  // Only owners delete started work; a creator can delete their own task while it's still To do.
  assert.equal((await am(`/tasks/${id}/delete`, { method: 'POST', body: {} })).status, 403);
  assert.equal((await am(`/tasks/${t2.id}/delete`, { method: 'POST', body: {} })).status, 200);
  const log = (await owner('/admin/audit')).body;
  assert.ok(log.some((x) => x.action === 'task.assign' && x.actor_name === 'Lina Lead'));
  assert.equal(typeof (await emp('/cron/daily')).body.tasks, 'number');
});

test('task files: links, Google Drive connect, chunked direct upload, sync and share', async () => {
  const { startFakeGoogle } = require('./fake-google');
  const g = await startFakeGoogle();
  try {
    const task = (await owner('/tasks', { method: 'POST', body: { title: 'Launch video', client: 'Kiko', department: 'Design', assignee_id: dinaId } })).body;
    const before = (await dina(`/tasks/${task.id}`)).body;
    assert.deepEqual(before.uploads, { drive: false, max_mb: 20480, allowed: true });
    const notConnected = await dina(`/tasks/${task.id}/uploads`, { method: 'POST', body: { name: 'a.mp4', size: 10 } });
    assert.equal(notConnected.status, 502);
    assert.match(notConnected.body.error, /not connected/);
    // Links work without Drive.
    assert.equal((await dina(`/tasks/${task.id}/links`, { method: 'POST', body: { url: 'javascript:alert(1)' } })).status, 400);
    assert.equal((await dina(`/tasks/${task.id}/links`, { method: 'POST', body: { url: 'https://we.tl/t-abc', name: 'Raw footage' } })).status, 201);
    assert.equal((await emp(`/tasks/${task.id}/links`, { method: 'POST', body: { url: 'https://x.com' } })).status, 404);

    // Owner connects Drive through the OAuth redirect dance.
    const cookie = [...owner.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const hop = async (u) => fetch(u, { redirect: 'manual', headers: u.startsWith(base) ? { Cookie: cookie, 'User-Agent': UA.phone } : {} });
    assert.equal((await dina('/admin/drive')).status, 403);
    let r = await hop(`${base}/api/admin/drive/connect`);
    assert.equal(r.status, 302);
    r = await hop(r.headers.get('location')); // Google consent → back to our callback
    r = await hop(r.headers.get('location'));
    assert.match(r.headers.get('location'), /drive=connected/);
    const st = (await owner('/admin/drive')).body;
    assert.equal(st.connected, true);
    assert.equal(st.email, 'owner@bahr.network');
    assert.ok(st.quota.limit > 4e12);

    // Too big for the limit → refused before anything reaches Google.
    assert.equal((await dina(`/tasks/${task.id}/uploads`, { method: 'POST', body: { name: 'huge.mov', size: 30 * 1024 ** 3 } })).status, 400);
    // Upload in 256 KB chunks straight to the session URL, resuming after a dropped chunk.
    const size = 700000;
    const up = await dina(`/tasks/${task.id}/uploads`, { method: 'POST', body: { name: 'final cut.mp4', size, mime: 'video/mp4' } });
    assert.equal(up.status, 200);
    assert.ok(up.body.upload_url.startsWith(g.base));
    const data = Buffer.alloc(size, 7);
    const chunk = 256 * 1024;
    let offset = 0;
    g.state.failNextChunk = true;
    while (offset < size) {
      const end = Math.min(size, offset + chunk);
      let res;
      try {
        res = await fetch(up.body.upload_url, { method: 'PUT', headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${size}` }, body: data.subarray(offset, end) });
      } catch {
        // Ask Google how much it has, then continue from there.
        res = await fetch(up.body.upload_url, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } });
        offset = Number((res.headers.get('range') || 'bytes=0--1').split('-')[1]) + 1;
        continue;
      }
      if (res.status === 308) offset = Number((res.headers.get('range') || 'bytes=0--1').split('-')[1]) + 1;
      else { assert.equal(res.status, 200); offset = size; }
    }
    const synced = (await dina(`/tasks/${task.id}/files/sync`, { method: 'POST', body: { names: ['final cut.mp4'] } })).body;
    assert.equal(synced.length, 1);
    assert.equal(Number(synced[0].size), size);
    assert.equal(synced[0].user_id, dinaId);
    assert.ok(g.state.shared.includes(synced[0].drive_id)); // shared by link so the team can open it
    assert.equal((await dina(`/tasks/${task.id}/files/sync`, { method: 'POST', body: {} })).body.length, 0); // idempotent
    // Folder layout: Bahr Network Files / Kiko / #id Launch video
    const f = g.state.files.get(synced[0].drive_id);
    const folder = g.state.files.get(f.parents[0]);
    assert.equal(folder.name, `#${task.id} Launch video`);
    assert.equal(g.state.files.get(folder.parents[0]).name, 'Kiko');

    const detail = (await owner(`/tasks/${task.id}`)).body;
    assert.deepEqual(detail.files.map((x) => x.kind).sort(), ['drive', 'link']);
    assert.ok(detail.comments.some((c) => /added final cut\.mp4/.test(c.body)));
    // Removing a file moves it to the Drive trash.
    assert.equal((await dina(`/tasks/${task.id}/files/${synced[0].id}/delete`, { method: 'POST', body: {} })).status, 200);
    assert.equal(f.trashed, true);
    // Two uploads starting at the same moment on a new task share one folder.
    const t2 = (await owner('/tasks', { method: 'POST', body: { title: 'Teaser', client: 'Kiko', department: 'Design', assignee_id: dinaId } })).body;
    const [a, b2] = await Promise.all(['a.png', 'b.png'].map((name) => dina(`/tasks/${t2.id}/uploads`, { method: 'POST', body: { name, size: 10 } })));
    assert.equal(a.body.folder_id, b2.body.folder_id);
    const live = [...g.state.files.values()].filter((x) => x.name === `#${t2.id} Teaser` && !x.trashed);
    assert.equal(live.length, 1);
    assert.equal((await owner('/admin/drive/disconnect', { method: 'POST', body: {} })).status, 200);
    assert.equal((await owner('/admin/drive')).body.connected, false);
  } finally {
    g.close();
  }
});

test('clients: a managed list that tasks pick from', async () => {
  const am = client(UA.phone); // Amira's laptop slot is taken by the earlier test
  await am('/login', { method: 'POST', body: { username: 'amira', password: 'pass123' } });
  // Tasks created earlier with typed client names were turned into clients.
  const listed = (await am('/clients')).body;
  assert.equal(listed.can_manage, true);
  assert.ok(listed.rows.some((c) => c.name === 'Nike'));
  assert.equal((await dina('/clients', { method: 'POST', body: { name: 'Nope Co' } })).status, 403);
  const add = await am('/clients', { method: 'POST', body: { name: 'Vodafone Egypt', color: 'pink' } });
  assert.equal(add.status, 201);
  assert.equal((await am('/clients', { method: 'POST', body: { name: 'vodafone egypt' } })).status, 409);
  // The AM who added it becomes its account manager.
  assert.equal(add.body.manager_id, (await am('/me')).body.user.id);

  const t = await am('/tasks', { method: 'POST', body: { title: 'Ramadan OOH', client_id: add.body.id, department: 'Design' } });
  assert.equal(t.status, 201);
  assert.equal(t.body.client, 'Vodafone Egypt');
  // A lead can't invent clients by typing a new name.
  const typed = await lead('/tasks', { method: 'POST', body: { title: 'x', client: 'Brand New Co', department: 'Design' } });
  assert.equal(typed.status, 400);
  assert.match(typed.body.error, /Pick a client/);
  assert.equal((await lead('/tasks', { method: 'POST', body: { title: 'y', client: 'vodafone EGYPT', department: 'Design' } })).body.client_id, add.body.id);
  const meta = (await lead('/tasks/meta')).body;
  assert.ok(meta.clients.find((c) => c.id === add.body.id).open_tasks >= 2);
  assert.equal(meta.can_manage_clients, false);

  // Renaming updates the tasks; archiving hides it from pickers and blocks new tasks.
  await am(`/clients/${add.body.id}`, { method: 'PATCH', body: { name: 'Vodafone EG' } });
  assert.equal((await am(`/tasks/${t.body.id}`)).body.client, 'Vodafone EG');
  assert.equal((await owner(`/tasks?scope=all&client_id=${add.body.id}`)).body.length, 2);
  await am(`/clients/${add.body.id}`, { method: 'PATCH', body: { active: false } });
  assert.ok(!(await lead('/tasks/meta')).body.clients.some((c) => c.id === add.body.id));
  assert.equal((await am('/tasks', { method: 'POST', body: { title: 'z', client_id: add.body.id, department: 'Design' } })).status, 400);
  assert.ok((await am('/clients?all=1')).body.rows.some((c) => c.id === add.body.id && !c.active));
  // Switching a task to another client.
  const nike = listed.rows.find((c) => c.name === 'Nike');
  await am(`/tasks/${t.body.id}`, { method: 'PATCH', body: { client_id: nike.id } });
  assert.equal((await am(`/tasks/${t.body.id}`)).body.client, 'Nike');
});

test('mentions, on-time points, department & client reports, Drive backup', async () => {
  const amira = (await owner('/admin/users')).body.find((u) => u.username === 'amira');
  await owner(`/admin/users/${amira.id}`, { method: 'PATCH', body: { reset_device: true } }); // her phone and laptop are taken by earlier tests
  const am = client(UA.phone);
  await am('/login', { method: 'POST', body: { username: 'amira', password: 'pass123' } });
  const realMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const kiko = (await am('/clients')).body.rows.find((c) => c.name === 'Kiko');
  const t = (await owner('/tasks', { method: 'POST', body: { title: 'Story set', client_id: kiko.id, department: 'Design', assignee_id: dinaId, due_date: '2026-03-20' } })).body;

  // @mention: Omar (not on the task, other department) can now see it and finds it under "My tasks".
  assert.equal((await emp(`/tasks/${t.id}`)).status, 404);
  await dina(`/tasks/${t.id}/comments`, { method: 'POST', body: { body: 'Can you check the copy @omar?' } });
  assert.equal((await emp(`/tasks/${t.id}`)).status, 200);
  assert.ok((await emp('/tasks?scope=mine')).body.some((x) => x.id === t.id));
  assert.equal((await emp(`/tasks/${t.id}`, { method: 'PATCH', body: { status: 'review' } })).status, 403); // watching ≠ working on it

  // Delivered before the due date (clock is 2026-03-07) → one green point, even if reopened and finished again.
  const greenBefore = (await dina('/me/dashboard')).body.balances.green;
  await dina(`/tasks/${t.id}`, { method: 'PATCH', body: { status: 'in_progress' } });
  await dina(`/tasks/${t.id}`, { method: 'PATCH', body: { status: 'review' } });
  await owner(`/tasks/${t.id}`, { method: 'PATCH', body: { status: 'done' } });
  await owner(`/tasks/${t.id}`, { method: 'PATCH', body: { status: 'in_progress' } });
  await owner(`/tasks/${t.id}`, { method: 'PATCH', body: { status: 'done' } });
  assert.equal((await dina('/me/dashboard')).body.balances.green, greenBefore + 1);
  const rep = (await owner(`/admin/report?month=${realMonth}`)).body.rows.find((r) => r.user_id === dinaId);
  // completed_at is the database's real time while the app clock is March 2026, so here these count as late.
  assert.ok(rep.tasks_done >= 2);
  assert.equal(rep.tasks_done, rep.tasks_on_time + rep.tasks_late);

  // Department report: the lead sees their own department, ranked; employees can't.
  assert.equal((await dina('/reports/department')).status, 403);
  const dr = (await lead(`/reports/department?month=${realMonth}&department=Content`)).body; // a lead can't pick another department
  assert.equal(dr.department, 'Design');
  assert.deepEqual(dr.members.map((m) => m.name).sort(), ['Dina', 'Lina Lead']);
  assert.equal(dr.members[0].name, 'Dina'); // most tasks delivered
  assert.equal(dr.top[0].user_id, dinaId);
  assert.ok(dr.summary.tasks_done >= 2);
  assert.ok(dr.clients.some((c) => c.client === 'Kiko'));
  assert.equal((await lead('/reports/department/submit', { method: 'POST', body: { month: realMonth, notes: 'Great month, Dina carried the Kiko launch.' } })).status, 200);
  const sub = (await owner(`/reports/department/submitted?month=${realMonth}`)).body;
  assert.equal(sub.rows[0].department, 'Design');
  assert.equal((await owner(`/reports/department?month=${realMonth}&department=Design`)).body.submitted.notes, 'Great month, Dina carried the Kiko launch.');

  // Client report for account managers and owners.
  assert.equal((await dina(`/reports/client?id=${kiko.id}`)).status, 403);
  const cr = (await am(`/reports/client?id=${kiko.id}&month=${realMonth}`)).body;
  assert.equal(cr.client.name, 'Kiko');
  assert.ok(cr.summary.done >= 1);
  assert.ok(cr.files.some((f) => f.kind === 'link'));

  // Daily backup to Drive: lands in Bahr Network Files / Backups, one file per day.
  const { startFakeGoogle } = require('./fake-google');
  const g = await startFakeGoogle();
  try {
    const cookie = [...owner.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const hop = async (u) => fetch(u, { redirect: 'manual', headers: u.startsWith(base) ? { Cookie: cookie, 'User-Agent': UA.phone } : {} });
    let r = await hop(`${base}/api/admin/drive/connect`);
    r = await hop(r.headers.get('location'));
    await hop(r.headers.get('location'));
    const daily = (await emp('/cron/daily')).body;
    assert.ok(daily.backup && daily.backup.name.startsWith('bahr-backup-'));
    await emp('/cron/daily'); // same day again replaces, doesn't duplicate
    const files = [...g.state.files.values()];
    const backups = files.filter((f) => f.name.startsWith('bahr-backup-') && !f.trashed);
    assert.equal(backups.length, 1);
    assert.equal(files.find((f) => f.id === backups[0].parents[0]).name, 'Backups');
    assert.equal(backups[0].data.subarray(0, 2).toString(), 'PK');
    assert.equal((await owner('/admin/drive')).body.last_backup.name, backups[0].name);
    await owner('/admin/drive/disconnect', { method: 'POST', body: {} });
  } finally {
    g.close();
  }
});

test('rejects non-JSON writes', async () => {
  const res = await fetch(`${base}/api/login`, { method: 'POST', body: 'username=a&password=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 415);
});
