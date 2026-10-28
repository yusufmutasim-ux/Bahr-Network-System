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

test('rejects non-JSON writes', async () => {
  const res = await fetch(`${base}/api/login`, { method: 'POST', body: 'username=a&password=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 415);
});
