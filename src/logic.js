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

const holidaySets = new WeakMap();
function isHoliday(dateStr, settings) {
  const list = settings.holiday_dates;
  if (!list?.length) return false;
  if (!holidaySets.has(list)) holidaySets.set(list, new Set(list));
  return holidaySets.get(list).has(dateStr);
}

// A day someone is expected to check in: one of the (department's) work days and not an official holiday.
function isWorkDay(dateStr, settings) {
  return settings.work_days.includes(weekdayOf(dateStr)) && !isHoliday(dateStr, settings);
}

const SCHEDULE_KEYS = ['early_start', 'early_end', 'late_after', 'very_late_after', 'close', 'work_days', 'daily_hours'];

// Company settings with the department's own schedule (check-in windows, work days, hours) applied.
function scheduleFor(settings, department) {
  const own = department && settings.dept_schedules?.[department];
  if (!own) return settings;
  const out = { ...settings };
  for (const k of SCHEDULE_KEYS) if (own[k] != null) out[k] = own[k];
  return out;
}

// Minutes between check-in and check-out ('HH:MM'), 0 if either is missing.
function workedMinutes(a) {
  if (!a?.check_in_time || !a?.check_out_time) return 0;
  return Math.max(0, toMinutes(a.check_out_time) - toMinutes(a.check_in_time));
}

const LEAVE_TYPES = ['annual', 'sick', 'unpaid'];

// Work days of each leave type used (approved) and requested (pending) in a calendar year.
async function leaveUsage(db, settings, user, year) {
  const s = scheduleFor(settings, user.department);
  const rows = await db.all(
    `SELECT type, status, from_date, to_date FROM leave_requests
     WHERE user_id = ? AND status IN ('approved', 'pending') AND from_date <= ? AND to_date >= ?`,
    [user.id, `${year}-12-31`, `${year}-01-01`],
  );
  const out = {};
  for (const type of LEAVE_TYPES) out[type] = { used: 0, pending: 0 };
  for (const r of rows) {
    const from = r.from_date > `${year}-01-01` ? r.from_date : `${year}-01-01`;
    const to = r.to_date < `${year}-12-31` ? r.to_date : `${year}-12-31`;
    const days = eachDate(from, to).filter((d) => isWorkDay(d, s)).length;
    const bucket = out[r.type] || out.annual;
    if (r.status === 'approved') bucket.used += days;
    else bucket.pending += days;
  }
  const allowance = {
    annual: user.annual_leave ?? settings.annual_leave_days,
    sick: user.sick_leave ?? settings.sick_leave_days,
    unpaid: null,
  };
  for (const type of LEAVE_TYPES) {
    out[type].allowance = allowance[type];
    out[type].left = allowance[type] == null ? null : Math.max(0, allowance[type] - out[type].used - out[type].pending);
  }
  return out;
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
    throw new RuleError(`Your location is too imprecise (±${Math.round(accuracy)} m, allowed ±${settings.max_accuracy_m} m). Laptops locate themselves over Wi-Fi and are often imprecise: check in from your phone, or move near a window and try again.`);
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
  const floor = addDays(today, -lookbackDays);
  const lastDay = today;
  const [users, attendance, leaves] = await Promise.all([
    db.all(`SELECT id, start_date, department FROM users WHERE role <> 'owner' AND active = 1`),
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
    const us = scheduleFor(settings, u.department);
    const until = toMinutes(time) >= toMinutes(us.close) ? today : addDays(today, -1);
    const from = u.start_date > floor ? u.start_date : floor;
    if (from > until) continue;
    const userLeaves = leaves.filter((l) => l.user_id === u.id);
    for (const d of eachDate(from, until)) {
      if (!isWorkDay(d, us) || present.has(`${u.id}|${d}`)) continue;
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
  const [users, att, leaves, bal] = await Promise.all([
    db.all(
      `SELECT id, name, username, role, job_title, department, active, salary FROM users WHERE role <> 'owner' ORDER BY name`,
    ),
    db.all(
      'SELECT user_id, work_date, status, check_in_time, check_out_time FROM attendance WHERE work_date BETWEEN ? AND ?',
      [first, last],
    ),
    db.all(
      `SELECT user_id, type, from_date, to_date FROM leave_requests
       WHERE status = 'approved' AND from_date <= ? AND to_date >= ?`,
      [last, first],
    ),
    balancesByUser(db, month),
  ]);
  return users.map((u) => {
    const us = scheduleFor(settings, u.department);
    const mine = att.filter((x) => x.user_id === u.id);
    const a = {
      days: mine.length,
      early: mine.filter((x) => x.status === 'early').length,
      on_time: mine.filter((x) => x.status === 'on_time').length,
      late: mine.filter((x) => x.status === 'late' || x.status === 'very_late').length,
    };
    const dayLimit = Number(us.daily_hours) * 60;
    let worked = 0;
    let overtime = 0;
    for (const x of mine) {
      const m = workedMinutes(x);
      worked += m;
      overtime += Math.max(0, m - dayLimit);
    }
    const b = bal.get(u.id) || emptyBalance();
    let leaveDays = 0;
    let unpaidDays = 0;
    for (const l of leaves.filter((x) => x.user_id === u.id)) {
      const from = l.from_date > first ? l.from_date : first;
      const to = l.to_date < last ? l.to_date : last;
      const n = eachDate(from, to).filter((d) => isWorkDay(d, us)).length;
      leaveDays += n;
      if (l.type === 'unpaid') unpaidDays += n;
    }
    const red = Math.max(0, b.month.red);
    const black = Math.max(0, b.month.black);
    const redDeduction = red * settings.red_value;
    const blackDeduction = black * settings.black_value;
    return {
      user_id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
      salary: u.salary,
      job_title: u.job_title,
      department: u.department,
      active: !!u.active,
      days_present: Number(a.days || 0),
      early: Number(a.early || 0),
      on_time: Number(a.on_time || 0),
      late: Number(a.late || 0),
      leave_days: leaveDays,
      unpaid_days: unpaidDays,
      work_days: eachDate(first, last).filter((d) => isWorkDay(d, us)).length,
      daily_hours: Number(us.daily_hours),
      worked_minutes: worked,
      overtime_minutes: overtime,
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

const round2 = (n) => Math.round(n * 100) / 100;

// Net pay = salary − red/black deductions − unpaid leave + overtime (+ rewards paid, if enabled).
async function payroll(db, settings, month) {
  const { first, last } = monthBounds(month);
  const [rows, rewards] = await Promise.all([
    monthReport(db, settings, month),
    db.all(
      `SELECT user_id, SUM(amount) AS amount FROM reward_requests
       WHERE status = 'paid' AND to_char(decided_at AT TIME ZONE ?, 'YYYY-MM-DD') BETWEEN ? AND ? GROUP BY user_id`,
      [settings.timezone, first, last],
    ),
  ]);
  return rows.map((r) => {
    const salary = Number(r.salary) || 0;
    const dayRate = r.work_days ? salary / r.work_days : 0;
    const hourRate = r.daily_hours ? dayRate / r.daily_hours : 0;
    const overtimeHours = round2(r.overtime_minutes / 60);
    const overtimePay = round2(overtimeHours * hourRate * Number(settings.overtime_rate));
    const unpaidDeduction = round2(r.unpaid_days * dayRate);
    const rewardsPaid = Number(rewards.find((x) => x.user_id === r.user_id)?.amount || 0);
    const net = salary - r.total_deduction - unpaidDeduction + overtimePay + (settings.payroll_add_rewards ? rewardsPaid : 0);
    return {
      ...r,
      salary,
      day_rate: round2(dayRate),
      hours_worked: round2(r.worked_minutes / 60),
      overtime_hours: overtimeHours,
      overtime_pay: overtimePay,
      unpaid_deduction: unpaidDeduction,
      rewards_paid: rewardsPaid,
      rewards_in_net: !!settings.payroll_add_rewards,
      net_pay: round2(Math.max(0, net)),
    };
  });
}

module.exports = {
  RuleError,
  distanceMeters,
  isWorkDay,
  isHoliday,
  scheduleFor,
  workedMinutes,
  leaveUsage,
  LEAVE_TYPES,
  payroll,
  classifyCheckIn,
  checkGeofence,
  addPoints,
  balances,
  balancesByUser,
  hasApprovedLeave,
  runAbsenceJob,
  monthReport,
};
