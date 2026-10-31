const push = require('./push');

// Client work between account managers and departments.
//  - Account managers (members of settings.am_department), leads and owners create tasks for a department.
//  - The department's lead gets every new task and assigns it to someone on the team.
//  - Everyone sees the tasks assigned to them; owners see everything.
// Flow: To do → In progress → In review → Done. Assignees move their own work up to review;
// the creator, the department lead or an owner approves it (Done) or sends it back.

const STATUSES = ['todo', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', review: 'In review', done: 'Done' };
const MAX_ITEMS = 50;

function registerTasks(app, ctx) {
  const { db, settings, localToday, fail, str, posInt, idParam, requireUser, audit } = ctx;
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
  const optDate = (v, label) => (v === '' || v == null ? null : isDate(v) ? v : fail(`Invalid ${label}`));

  const isAM = (user, s) => user.role !== 'owner' && !!s.am_department && user.department === s.am_department;
  const canCreate = (user, s) => user.role === 'owner' || user.role === 'lead' || isAM(user, s);
  // Owners, the lead of the task's department and the task's creator manage it.
  const manages = (user, t) =>
    user.role === 'owner' || (user.role === 'lead' && !!user.department && user.department === t.department) || t.created_by === user.id;

  // Rows (aliased t) this user may see.
  function visible(user) {
    if (user.role === 'owner') return { sql: 'TRUE', params: [] };
    const parts = ['t.assignee_id = ?', 't.created_by = ?'];
    const params = [user.id, user.id];
    if (user.role === 'lead' && user.department) {
      parts.push('t.department = ?');
      params.push(user.department);
    }
    return { sql: `(${parts.join(' OR ')})`, params };
  }

  async function loadTask(user, id) {
    const v = visible(user);
    const t = await db.get(`SELECT t.* FROM tasks t WHERE t.id = ? AND ${v.sql}`, [id, ...v.params]);
    if (!t) fail('Task not found', 404);
    return t;
  }

  const event = (taskId, userId, body) =>
    db.run(`INSERT INTO task_comments (task_id, user_id, kind, body) VALUES (?, ?, 'event', ?)`, [taskId, userId, body]);

  // Leads of a department, falling back to owners when the department has no lead.
  async function deptManagers(department) {
    const leads = await db.all(`SELECT id FROM users WHERE role = 'lead' AND active = 1 AND department = ?`, [department]);
    if (leads.length) return leads.map((l) => l.id);
    return (await db.all(`SELECT id FROM users WHERE role = 'owner' AND active = 1`)).map((o) => o.id);
  }

  const notify = (ids, actor, payload) => push.notifyUsers(db, ids.filter((x) => x && x !== actor.id), payload);
  const taskUrl = (id) => `/#/tasks?task=${id}`;

  async function assigneeFor(department, assigneeId) {
    if (assigneeId == null) return null;
    const u = await db.get(`SELECT id, name, department FROM users WHERE id = ? AND active = 1 AND role <> 'owner'`, [assigneeId]);
    if (!u) fail('Choose someone from the team');
    if (u.department !== department) fail(`${u.name} is not in ${department}`);
    return u;
  }

  const LIST_SQL = `
    SELECT t.*, a.name AS assignee_name, c.name AS created_by_name,
           (SELECT COUNT(*) FROM task_items i WHERE i.task_id = t.id) AS items_total,
           (SELECT COUNT(*) FROM task_items i WHERE i.task_id = t.id AND i.done = 1) AS items_done,
           (SELECT COUNT(*) FROM task_comments m WHERE m.task_id = t.id AND m.kind = 'comment') AS comments
    FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users c ON c.id = t.created_by`;
  const shape = (r) => ({ ...r, items_total: Number(r.items_total), items_done: Number(r.items_done), comments: Number(r.comments) });

  // scope: mine (assigned to me) · inbox (my department, unassigned) · team (my department) · created (by me) · all
  app.get('/api/tasks', requireUser, async (req, res) => {
    const u = req.user;
    const v = visible(u);
    const where = [v.sql];
    const params = [...v.params];
    const scope = req.query.scope || 'mine';
    if (scope === 'mine') {
      where.push('t.assignee_id = ?');
      params.push(u.id);
    } else if (scope === 'created') {
      where.push('t.created_by = ?');
      params.push(u.id);
    } else if (scope === 'inbox' || scope === 'team') {
      if (u.role !== 'lead' && u.role !== 'owner') fail('Only team leads have a team inbox', 403);
      if (u.role === 'lead') {
        where.push('t.department = ?');
        params.push(u.department || '');
      }
      if (scope === 'inbox') where.push(`t.assignee_id IS NULL AND t.status <> 'done'`);
    }
    if (req.query.department) {
      where.push('t.department = ?');
      params.push(str(req.query.department, 40));
    }
    if (req.query.client) {
      where.push('t.client = ?');
      params.push(str(req.query.client, 80));
    }
    if (req.query.q) {
      where.push(`(t.title ILIKE ? OR t.client ILIKE ? OR t.description ILIKE ?)`);
      const q = `%${str(req.query.q, 80).replace(/[%_]/g, '')}%`;
      params.push(q, q, q);
    }
    // Finished work older than 30 days drops off the board unless asked for.
    if (req.query.done !== 'all') where.push(`(t.status <> 'done' OR t.completed_at > now() - interval '30 days')`);
    const rows = await db.all(
      `${LIST_SQL} WHERE ${where.join(' AND ')}
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                t.due_date IS NULL, t.due_date, t.id DESC
       LIMIT 500`,
      params,
    );
    res.json(rows.map(shape));
  });

  // What the task screens need: who can do what, departments, clients, assignable people with their workload.
  app.get('/api/tasks/meta', requireUser, async (req, res) => {
    const s = await settings();
    const u = req.user;
    const [clients, people, counts] = await Promise.all([
      db.all(`SELECT client, COUNT(*) AS n FROM tasks WHERE client IS NOT NULL AND client <> '' GROUP BY client ORDER BY n DESC, client LIMIT 100`),
      db.all(
        `SELECT u.id, u.name, u.role, u.job_title, u.department,
                (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status <> 'done') AS open_tasks
         FROM users u WHERE u.active = 1 AND u.role <> 'owner' AND u.department IS NOT NULL ORDER BY u.name`,
      ),
      db.get(
        `SELECT (SELECT COUNT(*) FROM tasks WHERE assignee_id = ? AND status <> 'done') AS mine,
                (SELECT COUNT(*) FROM tasks WHERE assignee_id = ? AND status <> 'done' AND due_date < ?) AS overdue,
                (SELECT COUNT(*) FROM tasks WHERE ? AND department = ? AND assignee_id IS NULL AND status <> 'done') AS inbox,
                (SELECT COUNT(*) FROM tasks WHERE created_by = ? AND status = 'review') AS to_review`,
        [u.id, u.id, localToday(s).date, u.role === 'lead', u.department || '', u.id],
      ),
    ]);
    res.json({
      can_create: canCreate(u, s),
      is_am: isAM(u, s),
      am_department: s.am_department,
      departments: s.departments.filter((d) => d !== s.am_department || u.role === 'owner'),
      clients: clients.map((c) => c.client),
      // Leads assign within their department; owners anywhere.
      people: people
        .filter((p) => u.role === 'owner' || (u.role === 'lead' && p.department === u.department))
        .map((p) => ({ ...p, open_tasks: Number(p.open_tasks) })),
      counts: Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, Number(n)])),
    });
  });

  app.post('/api/tasks', requireUser, async (req, res) => {
    const s = await settings();
    const u = req.user;
    if (!canCreate(u, s)) fail('Only account managers, team leads and owners can create tasks', 403);
    const b = req.body;
    const title = str(b.title, 140) || fail('Give the task a title');
    const department = str(b.department, 40);
    if (!s.departments.includes(department)) fail('Choose the department that will do it');
    const priority = PRIORITIES.includes(b.priority) ? b.priority : 'medium';
    const start = optDate(b.start_date, 'start date');
    const due = optDate(b.due_date, 'due date');
    if (start && due && due < start) fail('Due date must be on or after the start date');
    // Only owners and the department's own lead pick a person; everyone else sends it to the lead.
    const assignee = b.assignee_id && (u.role === 'owner' || (u.role === 'lead' && u.department === department))
      ? await assigneeFor(department, posInt(b.assignee_id))
      : null;
    const items = (Array.isArray(b.items) ? b.items : []).map((x) => str(x, 200)).filter(Boolean).slice(0, MAX_ITEMS);
    const t = await db.tx(async (tx) => {
      const t = await tx.get(
        `INSERT INTO tasks (title, description, client, department, assignee_id, created_by, priority, start_date, due_date, assigned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        [title, str(b.description, 4000) || null, str(b.client, 80) || null, department, assignee?.id || null, u.id, priority,
          start, due, assignee ? new Date().toISOString() : null],
      );
      for (const [i, text] of items.entries()) {
        await tx.run('INSERT INTO task_items (task_id, text, position) VALUES (?, ?, ?)', [t.id, text, i]);
      }
      await tx.run(`INSERT INTO task_comments (task_id, user_id, kind, body) VALUES (?, ?, 'event', ?)`, [
        t.id, u.id, assignee ? `created the task and assigned it to ${assignee.name}` : `created the task for ${department}`,
      ]);
      return t;
    });
    const tag = `task-${t.id}`;
    const from = `${u.name}${t.client ? ` · ${t.client}` : ''}`;
    if (assignee) await notify([assignee.id], u, { title: `📌 New task: ${title}`, body: `From ${from}${due ? ` · due ${due}` : ''}`, url: taskUrl(t.id), tag });
    else await notify(await deptManagers(department), u, { title: `📥 New task for ${department}`, body: `${title} · from ${from}. Assign it to someone.`, url: taskUrl(t.id), tag });
    await audit(u, 'task.create', `${title} → ${department}${assignee ? ` (${assignee.name})` : ''}`, assignee?.id || null);
    res.status(201).json(t);
  });

  app.get('/api/tasks/:id', requireUser, async (req, res) => {
    const t = await loadTask(req.user, idParam(req));
    const [row, items, comments] = await Promise.all([
      db.get(`${LIST_SQL} WHERE t.id = ?`, [t.id]),
      db.all('SELECT * FROM task_items WHERE task_id = ? ORDER BY position, id', [t.id]),
      db.all(
        `SELECT m.*, u.name AS user_name FROM task_comments m LEFT JOIN users u ON u.id = m.user_id WHERE m.task_id = ? ORDER BY m.id`,
        [t.id],
      ),
    ]);
    const s = await settings();
    res.json({
      ...shape(row),
      items,
      comments,
      can: {
        manage: manages(req.user, t),
        assign: req.user.role === 'owner' || (req.user.role === 'lead' && req.user.department === t.department),
        work: t.assignee_id === req.user.id || manages(req.user, t),
        delete: req.user.role === 'owner' || (t.created_by === req.user.id && t.status === 'todo'),
        change_department: req.user.role === 'owner' || t.created_by === req.user.id || isAM(req.user, s),
      },
    });
  });

  app.patch('/api/tasks/:id', requireUser, async (req, res) => {
    const u = req.user;
    const s = await settings();
    const t = await loadTask(u, idParam(req));
    const b = req.body;
    const manager = manages(u, t);
    const isAssignee = t.assignee_id === u.id;
    const fields = {};
    const events = [];
    const after = [];

    for (const k of ['title', 'description', 'client', 'priority', 'start_date', 'due_date']) {
      if (b[k] === undefined) continue;
      if (!manager) fail('Only the task owner or the department lead can edit the details', 403);
      if (k === 'title') fields.title = str(b.title, 140) || fail('Title is required');
      else if (k === 'description') fields.description = str(b.description, 4000) || null;
      else if (k === 'client') fields.client = str(b.client, 80) || null;
      else if (k === 'priority') fields.priority = PRIORITIES.includes(b.priority) ? b.priority : fail('Invalid priority');
      else fields[k] = optDate(b[k], k.replace('_', ' '));
    }
    if (fields.due_date !== undefined && fields.due_date !== t.due_date) events.push(fields.due_date ? `set the due date to ${fields.due_date}` : 'removed the due date');
    if (fields.priority && fields.priority !== t.priority) events.push(`set priority to ${fields.priority}`);
    const start = fields.start_date !== undefined ? fields.start_date : t.start_date;
    const due = fields.due_date !== undefined ? fields.due_date : t.due_date;
    if (start && due && due < start) fail('Due date must be on or after the start date');

    let department = t.department;
    if (b.department !== undefined && b.department !== t.department) {
      if (!(u.role === 'owner' || t.created_by === u.id || isAM(u, s))) fail('Only the account manager or an owner can move a task to another department', 403);
      if (!s.departments.includes(b.department)) fail('Unknown department');
      department = fields.department = b.department;
      fields.assignee_id = null;
      fields.assigned_at = null;
      events.push(`moved the task to ${department}`);
      after.push(async () => notify(await deptManagers(department), u, { title: `📥 Task moved to ${department}`, body: `${t.title}. Assign it to someone.`, url: taskUrl(t.id), tag: `task-${t.id}` }));
    }

    if (b.assignee_id !== undefined && fields.assignee_id === undefined) {
      if (!(u.role === 'owner' || (u.role === 'lead' && u.department === department))) fail(`Only the ${department} lead can assign this task`, 403);
      const a = await assigneeFor(department, b.assignee_id ? posInt(b.assignee_id) : null);
      if ((a?.id || null) !== t.assignee_id) {
        fields.assignee_id = a?.id || null;
        fields.assigned_at = a ? new Date().toISOString() : null;
        events.push(a ? `assigned the task to ${a.name}` : 'unassigned the task');
        if (a) after.push(() => notify([a.id], u, { title: `📌 New task: ${t.title}`, body: `From ${u.name}${t.client ? ` · ${t.client}` : ''}${due ? ` · due ${due}` : ''}`, url: taskUrl(t.id), tag: `task-${t.id}` }));
      }
    }

    if (b.status !== undefined && b.status !== t.status) {
      if (!STATUSES.includes(b.status)) fail('Invalid status');
      if (!manager && !isAssignee) fail('Only the person working on it can move this task', 403);
      if (b.status === 'done' && !manager) fail('Send it for review: the account manager or your lead marks it done', 403);
      const assigned = fields.assignee_id !== undefined ? fields.assignee_id : t.assignee_id;
      if (b.status !== 'todo' && !assigned) fail('Assign the task to someone first');
      fields.status = b.status;
      fields.completed_at = b.status === 'done' ? new Date().toISOString() : null;
      const back = STATUSES.indexOf(b.status) < STATUSES.indexOf(t.status);
      events.push(back && t.status === 'review' ? `sent it back to ${STATUS_LABEL[b.status]}` : `moved it to ${STATUS_LABEL[b.status]}`);
      const tag = `task-${t.id}`;
      if (b.status === 'review') {
        after.push(async () => notify([t.created_by, ...(await deptManagers(department))], u, { title: `👀 Ready for review: ${t.title}`, body: `${u.name} finished it. Approve it or send it back.`, url: taskUrl(t.id), tag }));
      } else if (b.status === 'done') {
        after.push(() => notify([assigned, t.created_by], u, { title: `✅ Done: ${t.title}`, body: `Approved by ${u.name}. Great work!`, url: taskUrl(t.id), tag }));
      } else if (back) {
        after.push(() => notify([assigned], u, { title: `↩️ Changes needed: ${t.title}`, body: `${u.name} sent it back. Check the comments.`, url: taskUrl(t.id), tag }));
      }
    }

    const keys = Object.keys(fields);
    if (!keys.length) return res.json({ ok: true });
    await db.run(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = now() WHERE id = ?`, [...keys.map((k) => fields[k]), t.id]);
    for (const e of events) await event(t.id, u.id, e);
    for (const fn of after) await fn();
    if (fields.assignee_id !== undefined || fields.department) {
      await audit(u, 'task.assign', `${t.title}: ${events.join(', ')}`, fields.assignee_id || null);
    }
    res.json({ ok: true });
  });

  app.post('/api/tasks/:id/delete', requireUser, async (req, res) => {
    const t = await loadTask(req.user, idParam(req));
    if (!(req.user.role === 'owner' || (t.created_by === req.user.id && t.status === 'todo'))) {
      fail('Only an owner can delete a task that has started', 403);
    }
    await db.run('DELETE FROM tasks WHERE id = ?', [t.id]);
    await audit(req.user, 'task.delete', `${t.title} (${t.department})`, t.assignee_id);
    res.json({ ok: true });
  });

  // ----- Checklist -----

  app.post('/api/tasks/:id/items', requireUser, async (req, res) => {
    const t = await loadTask(req.user, idParam(req));
    if (!(manages(req.user, t) || t.assignee_id === req.user.id)) fail('Not allowed', 403);
    const text = str(req.body.text, 200) || fail('Write the checklist item');
    const n = await db.get('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS p FROM task_items WHERE task_id = ?', [t.id]);
    if (Number(n.n) >= MAX_ITEMS) fail(`A task can have at most ${MAX_ITEMS} checklist items`);
    const row = await db.get('INSERT INTO task_items (task_id, text, position) VALUES (?, ?, ?) RETURNING *', [t.id, text, Number(n.p) + 1]);
    await db.run('UPDATE tasks SET updated_at = now() WHERE id = ?', [t.id]);
    res.status(201).json(row);
  });

  app.post('/api/tasks/:id/items/:itemId/toggle', requireUser, async (req, res) => {
    const t = await loadTask(req.user, idParam(req));
    if (!(manages(req.user, t) || t.assignee_id === req.user.id)) fail('Not allowed', 403);
    const row = await db.get(
      'UPDATE task_items SET done = 1 - done WHERE id = ? AND task_id = ? RETURNING *',
      [posInt(req.params.itemId) || 0, t.id],
    );
    if (!row) fail('Not found', 404);
    // Ticking the first item starts the task.
    if (row.done && t.status === 'todo' && t.assignee_id === req.user.id) {
      await db.run(`UPDATE tasks SET status = 'in_progress', updated_at = now() WHERE id = ?`, [t.id]);
      await event(t.id, req.user.id, 'moved it to In progress');
    } else {
      await db.run('UPDATE tasks SET updated_at = now() WHERE id = ?', [t.id]);
    }
    res.json(row);
  });

  app.post('/api/tasks/:id/items/:itemId/delete', requireUser, async (req, res) => {
    const t = await loadTask(req.user, idParam(req));
    if (!manages(req.user, t)) fail('Not allowed', 403);
    await db.run('DELETE FROM task_items WHERE id = ? AND task_id = ?', [posInt(req.params.itemId) || 0, t.id]);
    res.json({ ok: true });
  });

  // ----- Comments -----

  app.post('/api/tasks/:id/comments', requireUser, async (req, res) => {
    const u = req.user;
    const t = await loadTask(u, idParam(req));
    const body = str(req.body.body, 2000) || fail('Write a comment');
    const row = await db.get(`INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?) RETURNING *`, [t.id, u.id, body]);
    await db.run('UPDATE tasks SET updated_at = now() WHERE id = ?', [t.id]);
    await notify([t.assignee_id, t.created_by, ...(await deptManagers(t.department))], u, {
      title: `💬 ${u.name} on "${t.title}"`, body: body.slice(0, 140), url: taskUrl(t.id), tag: `task-${t.id}-c`,
    });
    res.status(201).json({ ...row, user_name: u.name });
  });
}

// Morning push: tasks due today and overdue ones, to whoever has them (or the lead, if unassigned).
async function remindDueTasks(db, today) {
  const rows = await db.all(
    `SELECT t.id, t.title, t.due_date, t.department, t.assignee_id FROM tasks t
     WHERE t.status <> 'done' AND t.due_date IS NOT NULL AND t.due_date <= ?`,
    [today],
  );
  const byUser = new Map();
  for (const r of rows) {
    let ids = r.assignee_id ? [r.assignee_id] : null;
    if (!ids) ids = (await db.all(`SELECT id FROM users WHERE role = 'lead' AND active = 1 AND department = ?`, [r.department])).map((x) => x.id);
    for (const id of ids) {
      if (!byUser.has(id)) byUser.set(id, { today: [], late: [] });
      byUser.get(id)[r.due_date === today ? 'today' : 'late'].push(r.title);
    }
  }
  let sent = 0;
  for (const [id, { today: due, late }] of byUser) {
    const parts = [];
    if (due.length) parts.push(`${due.length} due today`);
    if (late.length) parts.push(`${late.length} overdue`);
    sent += await push.notifyUsers(db, [id], {
      title: `🗂️ ${parts.join(' · ')}`,
      body: [...late, ...due].slice(0, 3).join(' · '),
      url: '/#/tasks',
      tag: `tasks-due-${today}`,
    });
  }
  return sent;
}

module.exports = { registerTasks, remindDueTasks, STATUSES, PRIORITIES };
