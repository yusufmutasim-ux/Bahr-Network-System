// Business rules: check-in classification, geofence, balances, absences and deductions.
const { localNow, weekdayOf, addDays, toMinutes, monthBounds, eachDate } = require('./time');

class RuleError extends Error {
  constructor(message, status = 400, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function isWorkDay(dateStr, settings) {
  return settings.work_days.includes(weekdayOf(dateStr));
}

// Decide what a check-in at local time `time` on a work day earns.
function classifyCheckIn(time, settings) {
  const t = toMinutes(time);
  if (t < toMinutes(settings.early_start)) {
    throw new RuleError(`Check-in opens at ${settings.early_start}`);
  }
  if (t >= toMinutes(settings.close)) {
    throw new RuleError(`Check-in closed at ${settings.close}`);
  }
  if (t < toMinutes(settings.early_end)) return { status: 'early', green: 1, red: 0 };
  if (t < toMinutes(settings.late_after)) return { status: 'on_time', green: 0, red: 0 };
  if (t < toMinutes(settings.very_late_after)) return { status: 'late', green: 0, red: 1 };
  return { status: 'very_late', green: 0, red: Number(settings.very_late_reds) || 1 };
}

function checkGeofence({ lat, lng, accuracy }, settings) {
  if (settings.office_lat == null || settings.office_lng == null) {
    throw new RuleError('Office location is not set yet. Ask the owner to set it in Settings.');
  }
  if (![lat, lng].every(Number.isFinite)) throw new RuleError('Location (GPS) is required to check in.');
  if (Number.isFinite(accuracy) && accuracy > settings.max_accuracy_m) {
    throw new RuleError(`GPS accuracy is too low (${Math.round(accuracy)} m). Try again outdoors or near a window.`);
  }
  const distance = distanceMeters(lat, lng, settings.office_lat, settings.office_lng);
  if (distance > settings.radius_m) {
    throw new RuleError(`You are ${Math.round(distance)} m from the office (allowed: ${settings.radius_m} m).`);
  }
  return Math.round(distance);
}

async function addPoints(db, { userId, kind, delta, workDate, source, reason = null, refId = null, createdBy = null }) {
  await db.run(
    `INSERT INTO points (user_id, kind, delta, work_date, source, reason, ref_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, kind, delta, workDate, source, reason, refId, createdBy],
  );
}

const emptyBalance = () => ({ green: 0, month: { green: 0, red: 0, black: 0 } });

// Balances for many users at once: all-time green plus this month's green / red / black.
async function balancesByUser(db, month, userId = null) {
  const { first, last } = monthBounds(month);
  const rows = await db.all(
    `SELECT user_id, kind,
            COALESCE(SUM(delta), 0) AS total,
            COALESCE(SUM(delta) FILTER (WHERE work_date BETWEEN ? AND ?), 0) AS month_total
     FROM points WHERE (?::int IS NULL OR user_id = ?::int) GROUP BY user_id, kind`,
    [first, last, userId, userId],
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.user_id)) map.set(r.user_id, emptyBalance());
    const b = map.get(r.user_id);
    if (r.kind === 'green') b.green = Number(r.total);
    b.month[r.kind] = Number(r.month_total);
  }
  return map;
}

async function balances(db, userId, month) {
  return (await balancesByUser(db, month, userId)).get(userId) || emptyBalance();
}

async function hasApprovedLeave(db, userId, date) {
  return !!(await db.get(
    `SELECT 1 FROM leave_requests WHERE user_id = ? AND status = 'approved' AND ? BETWEEN from_date AND to_date LIMIT 1`,
    [userId, date],
  ));
}

// Gives a black point for every past work day an employee neither checked in nor had approved leave.
// Today counts once check-in has closed. Safe to run repeatedly (unique index on absences).
async function runAbsenceJob(db, settings, now = new Date(), lookbackDays = 45) {
  const { date: today, time } = localNow(settings.timezone, now);
  const lastDay = toMinutes(time) >= toMinutes(settings.close) ? today : addDays(today, -1);
  const floor = addDays(today, -lookbackDays);
  if (floor > lastDay) return 0;
  const [users, attendance, leaves] = await Promise.all([
    db.all(`SELECT id, start_date FROM users WHERE role = 'employee' AND active = 1`),
    db.all(`SELECT user_id, work_date FROM attendance WHERE work_date BETWEEN ? AND ?`, [floor, lastDay]),
    db.all(
      `SELECT user_id, from_date, to_date FROM leave_requests
       WHERE status = 'approved' AND to_date >= ? AND from_date <= ?`,
      [floor, lastDay],
    ),
  ]);
  const present = new Set(attendance.map((a) => `${a.user_id}|${a.work_date}`));
  const ids = [];
  const dates = [];
  for (const u of users) {
    const from = u.start_date > floor ? u.start_date : floor;
    if (from > lastDay) continue;
    const userLeaves = leaves.filter((l) => l.user_id === u.id);
    for (const d of eachDate(from, lastDay)) {
      if (!isWorkDay(d, settings) || present.has(`${u.id}|${d}`)) continue;
      if (userLeaves.some((l) => d >= l.from_date && d <= l.to_date)) continue;
      ids.push(u.id);
      dates.push(d);
    }
  }
  if (!ids.length) return 0;
  const r = await db.run(
    `INSERT INTO points (user_id, kind, delta, work_date, source, reason)
     SELECT u, 'black', 1, d, 'absent', 'Absent without approved leave'
     FROM unnest(?::int[], ?::text[]) AS t(u, d)
     ON CONFLICT DO NOTHING`,
    [ids, dates],
  );
  return r.changes;
}

async function monthReport(db, settings, month) {
  const { first, last } = monthBounds(month);
  const [users, stats, leaves, bal] = await Promise.all([
    db.all(`SELECT id, name, username, job_title, department, active FROM users WHERE role = 'employee' ORDER BY name`),
    db.all(
      `SELECT user_id, COUNT(*) AS days,
              COUNT(*) FILTER (WHERE status = 'early') AS early,
              COUNT(*) FILTER (WHERE status = 'on_time') AS on_time,
              COUNT(*) FILTER (WHERE status IN ('late', 'very_late')) AS late
       FROM attendance WHERE work_date BETWEEN ? AND ? GROUP BY user_id`,
      [first, last],
    ),
    db.all(
      `SELECT user_id, from_date, to_date FROM leave_requests
       WHERE status = 'approved' AND from_date <= ? AND to_date >= ?`,
      [last, first],
    ),
    balancesByUser(db, month),
  ]);
  return users.map((u) => {
    const a = stats.find((s) => s.user_id === u.id) || {};
    const b = bal.get(u.id) || emptyBalance();
    let leaveDays = 0;
    for (const l of leaves.filter((x) => x.user_id === u.id)) {
      const from = l.from_date > first ? l.from_date : first;
      const to = l.to_date < last ? l.to_date : last;
      leaveDays += eachDate(from, to).filter((d) => isWorkDay(d, settings)).length;
    }
    const red = Math.max(0, b.month.red);
    const black = Math.max(0, b.month.black);
    const redDeduction = red * settings.red_value;
    const blackDeduction = black * settings.black_value;
    return {
      user_id: u.id,
      name: u.name,
      username: u.username,
      job_title: u.job_title,
      department: u.department,
      active: !!u.active,
      days_present: Number(a.days || 0),
      early: Number(a.early || 0),
      on_time: Number(a.on_time || 0),
      late: Number(a.late || 0),
      leave_days: leaveDays,
      green_month: b.month.green,
      green_balance: b.green,
      red,
      black,
      red_deduction: redDeduction,
      black_deduction: blackDeduction,
      total_deduction: redDeduction + blackDeduction,
    };
  });
}

module.exports = {
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
};
