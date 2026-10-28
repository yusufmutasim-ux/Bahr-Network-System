// Business rules: check-in classification, geofence, balances, absences and deductions.
const { localNow, weekdayOf, addDays, toMinutes, monthBounds, eachDate } = require('./time');

class RuleError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
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

function addPoints(db, { userId, kind, delta, workDate, source, reason = null, refId = null, createdBy = null }) {
  db.prepare(
    `INSERT INTO points (user_id, kind, delta, work_date, source, reason, ref_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, kind, delta, workDate, source, reason, refId, createdBy);
}

function balances(db, userId, month) {
  const all = db
    .prepare(`SELECT kind, COALESCE(SUM(delta), 0) AS total FROM points WHERE user_id = ? GROUP BY kind`)
    .all(userId);
  const { first, last } = monthBounds(month);
  const monthly = db
    .prepare(
      `SELECT kind, COALESCE(SUM(delta), 0) AS total FROM points
       WHERE user_id = ? AND work_date BETWEEN ? AND ? GROUP BY kind`,
    )
    .all(userId, first, last);
  const pick = (rows, k) => Number(rows.find((r) => r.kind === k)?.total || 0);
  return {
    green: pick(all, 'green'),
    month: { green: pick(monthly, 'green'), red: pick(monthly, 'red'), black: pick(monthly, 'black') },
  };
}

function hasApprovedLeave(db, userId, date) {
  return !!db
    .prepare(
      `SELECT 1 FROM leave_requests WHERE user_id = ? AND status = 'approved' AND ? BETWEEN from_date AND to_date LIMIT 1`,
    )
    .get(userId, date);
}

// Gives a black point for every past work day an employee neither checked in nor had approved leave.
// Today counts once check-in has closed. Safe to run repeatedly (unique index on absences).
function runAbsenceJob(db, settings, now = new Date(), lookbackDays = 45) {
  const { date: today, time } = localNow(settings.timezone, now);
  const lastDay = toMinutes(time) >= toMinutes(settings.close) ? today : addDays(today, -1);
  const floor = addDays(today, -lookbackDays);
  const users = db.prepare(`SELECT id, start_date FROM users WHERE role = 'employee' AND active = 1`).all();
  const hasAttendance = db.prepare(`SELECT 1 FROM attendance WHERE user_id = ? AND work_date = ?`);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO points (user_id, kind, delta, work_date, source, reason)
     VALUES (?, 'black', 1, ?, 'absent', 'Absent without approved leave')`,
  );
  let added = 0;
  for (const u of users) {
    const from = u.start_date > floor ? u.start_date : floor;
    if (from > lastDay) continue;
    for (const d of eachDate(from, lastDay)) {
      if (!isWorkDay(d, settings)) continue;
      if (hasAttendance.get(u.id, d) || hasApprovedLeave(db, u.id, d)) continue;
      added += Number(insert.run(u.id, d).changes);
    }
  }
  return added;
}

function monthReport(db, settings, month) {
  const { first, last } = monthBounds(month);
  const users = db
    .prepare(`SELECT id, name, username, job_title, active FROM users WHERE role = 'employee' ORDER BY name`)
    .all();
  const attendanceStats = db.prepare(
    `SELECT COUNT(*) AS days,
            SUM(status = 'early') AS early,
            SUM(status = 'on_time') AS on_time,
            SUM(status IN ('late', 'very_late')) AS late
     FROM attendance WHERE user_id = ? AND work_date BETWEEN ? AND ?`,
  );
  const leaves = db.prepare(
    `SELECT from_date, to_date FROM leave_requests
     WHERE user_id = ? AND status = 'approved' AND from_date <= ? AND to_date >= ?`,
  );
  return users.map((u) => {
    const a = attendanceStats.get(u.id, first, last);
    const b = balances(db, u.id, month);
    let leaveDays = 0;
    for (const l of leaves.all(u.id, last, first)) {
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
  hasApprovedLeave,
  runAbsenceJob,
  monthReport,
};
