const push = require('./push');
const { monthReport } = require('./logic');
const { monthBounds } = require('./time');
const { canManageClients } = require('./clients');

// Monthly summaries:
//  - Department report: a lead's team (and the lead's own work): attendance, tasks, kudos and a ranking.
//    The lead adds highlights and sends it to the owners.
//  - Client report: what was delivered for a client in a month.

// Ranking score: showing up well, delivering work on time and being appreciated by the team.
const SCORE = { present: 1, early: 1, task_done: 2, task_on_time: 2, kudos: 1, late: -1, absence: -3 };
const scoreOf = (m) =>
  m.days_present * SCORE.present + m.early * SCORE.early + m.tasks_done * SCORE.task_done + m.tasks_on_time * SCORE.task_on_time
  + m.kudos * SCORE.kudos + m.late * SCORE.late + m.black * SCORE.absence;

function registerReports(app, ctx) {
  const { db, settings, localToday, fail, str, posInt, requireUser, audit } = ctx;
  const isMonth = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
  const monthOf = (req, s) => (isMonth(req.query.month || req.body?.month) ? req.query.month || req.body.month : localToday(s).date.slice(0, 7));

  function deptFor(req, s) {
    if (req.user.role === 'owner') {
      const d = str(req.query.department, 40) || s.departments[0];
      if (!s.departments.includes(d)) fail('Unknown department');
      return d;
    }
    if (req.user.role !== 'lead') fail('Only team leads and owners can see department reports', 403);
    if (!req.user.department) fail('You have no department yet. Ask the owner to set it on your profile.');
    return req.user.department;
  }

  async function departmentReport(s, department, month) {
    const { first, last } = monthBounds(month);
    const tz = s.timezone;
    const today = localToday(s).date;
    const [people, kudos, tasks, submitted] = await Promise.all([
      monthReport(db, s, month),
      db.all(
        `SELECT k.to_user, COUNT(*) AS n FROM kudos k WHERE to_char(k.created_at AT TIME ZONE ?, 'YYYY-MM') = ? GROUP BY k.to_user`,
        [tz, month],
      ),
      db.all(
        `SELECT t.id, t.title, t.client, t.status, t.priority, t.due_date, t.assignee_id, a.name AS assignee_name,
                to_char(t.created_at AT TIME ZONE ?, 'YYYY-MM-DD') AS created_on,
                to_char(t.completed_at AT TIME ZONE ?, 'YYYY-MM-DD') AS completed_on
         FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id
         WHERE t.department = ? AND (
           to_char(t.created_at AT TIME ZONE ?, 'YYYY-MM') = ? OR to_char(t.completed_at AT TIME ZONE ?, 'YYYY-MM') = ?
           OR (t.status <> 'done' AND to_char(t.created_at AT TIME ZONE ?, 'YYYY-MM-DD') <= ?))
         ORDER BY t.completed_at DESC NULLS LAST, t.id DESC`,
        [tz, tz, department, tz, month, tz, month, tz, last],
      ),
      db.get(
        `SELECT r.notes, r.submitted_at, u.name AS submitted_by_name FROM dept_reports r LEFT JOIN users u ON u.id = r.submitted_by
         WHERE r.department = ? AND r.month = ?`,
        [department, month],
      ),
    ]);
    const kudosBy = new Map(kudos.map((k) => [k.to_user, Number(k.n)]));
    const members = people
      .filter((p) => p.department === department && p.active)
      .map((p) => {
        const m = {
          user_id: p.user_id, name: p.name, role: p.role, job_title: p.job_title,
          days_present: p.days_present, work_days: p.work_days, early: p.early, on_time: p.on_time, late: p.late, black: p.black,
          leave_days: p.leave_days, worked_minutes: p.worked_minutes, overtime_minutes: p.overtime_minutes,
          green: p.green_month, red: p.red, tasks_done: p.tasks_done, tasks_on_time: p.tasks_on_time, tasks_late: p.tasks_late,
          kudos: kudosBy.get(p.user_id) || 0,
        };
        m.attendance_rate = m.work_days ? Math.round(((m.days_present + m.leave_days) / m.work_days) * 100) : 100;
        m.on_time_rate = m.tasks_done ? Math.round((m.tasks_on_time / m.tasks_done) * 100) : null;
        m.score = scoreOf(m);
        return m;
      })
      .sort((a, b) => b.score - a.score || b.tasks_done - a.tasks_done || a.name.localeCompare(b.name));
    const done = tasks.filter((t) => t.status === 'done' && t.completed_on >= first && t.completed_on <= last);
    const onTime = done.filter((t) => !t.due_date || t.completed_on <= t.due_date);
    const open = tasks.filter((t) => t.status !== 'done');
    const byClient = {};
    for (const t of done) (byClient[t.client || 'Internal'] ||= { client: t.client || 'Internal', done: 0, on_time: 0 }).done += 1;
    for (const t of onTime) byClient[t.client || 'Internal'].on_time += 1;
    const sum = (k) => members.reduce((a, m) => a + (m[k] || 0), 0);
    return {
      department,
      month,
      score_rules: SCORE,
      summary: {
        members: members.length,
        attendance_rate: sum('work_days') ? Math.round(((sum('days_present') + sum('leave_days')) / sum('work_days')) * 100) : 100,
        early: sum('early'),
        late: sum('late'),
        absences: sum('black'),
        hours: Math.round(sum('worked_minutes') / 6) / 10,
        overtime_hours: Math.round(sum('overtime_minutes') / 6) / 10,
        tasks_created: tasks.filter((t) => t.created_on >= first && t.created_on <= last).length,
        tasks_done: done.length,
        tasks_on_time: onTime.length,
        on_time_rate: done.length ? Math.round((onTime.length / done.length) * 100) : null,
        open_tasks: open.length,
        overdue: open.filter((t) => t.due_date && t.due_date < today).length,
        kudos: sum('kudos'),
      },
      members,
      top: members.slice(0, 3).filter((m) => m.score > 0),
      clients: Object.values(byClient).sort((a, b) => b.done - a.done),
      done: done.slice(0, 100),
      open: open.slice(0, 50),
      submitted: submitted || null,
    };
  }

  app.get('/api/reports/department', requireUser, async (req, res) => {
    const s = await settings();
    res.json(await departmentReport(s, deptFor(req, s), monthOf(req, s)));
  });

  // The lead adds highlights and sends the month's summary to the owners (can be re-sent with changes).
  app.post('/api/reports/department/submit', requireUser, async (req, res) => {
    const s = await settings();
    if (req.user.role !== 'lead') fail('Only team leads send department reports', 403);
    const department = deptFor(req, s);
    const month = isMonth(req.body.month) ? req.body.month : localToday(s).date.slice(0, 7);
    const notes = str(req.body.notes, 4000) || null;
    const row = await db.get(
      `INSERT INTO dept_reports (department, month, notes, submitted_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (department, month) DO UPDATE SET notes = excluded.notes, submitted_by = excluded.submitted_by, submitted_at = now()
       RETURNING *`,
      [department, month, notes, req.user.id],
    );
    const owners = await db.all(`SELECT id FROM users WHERE role = 'owner' AND active = 1`);
    await push.notifyUsers(db, owners.map((o) => o.id), {
      title: `📋 ${department} report for ${month}`,
      body: `${req.user.name} sent the monthly summary${notes ? `: ${notes.slice(0, 100)}` : '.'}`,
      url: `/#/team-report?department=${encodeURIComponent(department)}&month=${month}`,
      tag: `dept-report-${department}-${month}`,
    });
    await audit(req.user, 'report.submit', `${department} · ${month}`);
    res.json(row);
  });

  // Owners: which departments sent their report for a month.
  app.get('/api/reports/department/submitted', requireUser, async (req, res) => {
    if (req.user.role !== 'owner') fail('Owner access only', 403);
    const s = await settings();
    const month = monthOf(req, s);
    const rows = await db.all(
      `SELECT r.department, r.month, r.notes, r.submitted_at, u.name AS submitted_by_name
       FROM dept_reports r LEFT JOIN users u ON u.id = r.submitted_by WHERE r.month = ? ORDER BY r.submitted_at DESC`,
      [month],
    );
    res.json({ month, departments: s.departments, rows });
  });

  app.get('/api/reports/client', requireUser, async (req, res) => {
    const s = await settings();
    if (!canManageClients(req.user, s)) fail('Only owners and account managers can see client reports', 403);
    const client = await db.get(
      `SELECT c.*, m.name AS manager_name FROM clients c LEFT JOIN users m ON m.id = c.manager_id WHERE c.id = ?`,
      [posInt(req.query.id) || 0],
    );
    if (!client) fail('Client not found', 404);
    const month = monthOf(req, s);
    const { first, last } = monthBounds(month);
    const tz = s.timezone;
    const today = localToday(s).date;
    const [tasks, files] = await Promise.all([
      db.all(
        `SELECT t.id, t.title, t.department, t.status, t.priority, t.due_date, a.name AS assignee_name,
                to_char(t.created_at AT TIME ZONE ?, 'YYYY-MM-DD') AS created_on,
                to_char(t.completed_at AT TIME ZONE ?, 'YYYY-MM-DD') AS completed_on
         FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id
         WHERE t.client_id = ? AND (
           to_char(t.created_at AT TIME ZONE ?, 'YYYY-MM') = ? OR to_char(t.completed_at AT TIME ZONE ?, 'YYYY-MM') = ?
           OR (t.status <> 'done' AND to_char(t.created_at AT TIME ZONE ?, 'YYYY-MM-DD') <= ?))
         ORDER BY t.completed_at DESC NULLS LAST, t.id DESC`,
        [tz, tz, client.id, tz, month, tz, month, tz, last],
      ),
      db.all(
        `SELECT f.id, f.kind, f.name, f.size, f.mime, f.url, f.created_at, t.title AS task_title, u.name AS user_name
         FROM task_files f JOIN tasks t ON t.id = f.task_id LEFT JOIN users u ON u.id = f.user_id
         WHERE t.client_id = ? AND to_char(f.created_at AT TIME ZONE ?, 'YYYY-MM') = ? ORDER BY f.id DESC LIMIT 200`,
        [client.id, tz, month],
      ),
    ]);
    const done = tasks.filter((t) => t.status === 'done' && t.completed_on >= first && t.completed_on <= last);
    const onTime = done.filter((t) => !t.due_date || t.completed_on <= t.due_date);
    const open = tasks.filter((t) => t.status !== 'done');
    const byDept = {};
    for (const t of done) (byDept[t.department] ||= { department: t.department, done: 0 }).done += 1;
    res.json({
      client: { id: client.id, name: client.name, color: client.color, manager_name: client.manager_name },
      month,
      summary: {
        created: tasks.filter((t) => t.created_on >= first && t.created_on <= last).length,
        done: done.length,
        on_time: onTime.length,
        on_time_rate: done.length ? Math.round((onTime.length / done.length) * 100) : null,
        open: open.length,
        overdue: open.filter((t) => t.due_date && t.due_date < today).length,
        files: files.length,
      },
      departments: Object.values(byDept).sort((a, b) => b.done - a.done),
      done,
      open,
      files: files.map((f) => ({ ...f, size: f.size == null ? null : Number(f.size) })),
    });
  });
}

module.exports = { registerReports, scoreOf, SCORE };
