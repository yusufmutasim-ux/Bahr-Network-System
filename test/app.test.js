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

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
  };
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

test('rejects non-JSON writes', async () => {
  const res = await fetch(`${base}/api/login`, { method: 'POST', body: 'username=a&password=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 415);
});
