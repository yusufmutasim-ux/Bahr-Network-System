// The agency's client list. Owners and account managers maintain it; everyone who creates tasks picks from it.

const COLORS = ['lime', 'teal', 'pink', 'sky', 'amber', 'slate', 'violet', 'orange'];

const isAM = (user, s) => user.role !== 'owner' && !!s.am_department && user.department === s.am_department;
const canManageClients = (user, s) => user.role === 'owner' || isAM(user, s);

// Turns { client_id } or a typed { client } into a client row. Unknown names are added when the user may manage clients.
async function resolveClient(db, user, s, body, fail, { requireActive = true } = {}) {
  if (body.client_id) {
    const c = await db.get('SELECT id, name, active FROM clients WHERE id = ?', [Number(body.client_id) || 0]);
    if (!c) fail('That client no longer exists');
    if (requireActive && !c.active) fail(`${c.name} is archived. Restore it in Clients first.`);
    return c;
  }
  const name = typeof body.client === 'string' ? body.client.trim().slice(0, 80) : '';
  if (!name) return null;
  const found = await db.get('SELECT id, name, active FROM clients WHERE lower(name) = lower(?)', [name]);
  if (found) return found;
  if (!canManageClients(user, s)) fail('Pick a client from the list. Ask an account manager to add new ones.');
  return db.get(`INSERT INTO clients (name, color, manager_id) VALUES (?, ?, ?) RETURNING id, name, active`, [
    name, COLORS[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COLORS.length], user.role === 'owner' ? null : user.id,
  ]);
}

function registerClients(app, ctx) {
  const { db, settings, fail, str, posInt, idParam, requireUser, audit, localToday } = ctx;

  app.get('/api/clients', requireUser, async (req, res) => {
    const s = await settings();
    const manage = canManageClients(req.user, s);
    const rows = await db.all(
      `SELECT c.id, c.name, c.color, c.active, c.notes, c.manager_id, m.name AS manager_name, c.created_at,
              COUNT(t.id) FILTER (WHERE t.status <> 'done') AS open_tasks,
              COUNT(t.id) FILTER (WHERE t.status <> 'done' AND t.due_date < ?) AS overdue,
              COUNT(t.id) FILTER (WHERE t.status = 'done' AND t.completed_at > now() - interval '30 days') AS done_30,
              COUNT(t.id) AS total_tasks, MAX(t.created_at) AS last_task_at
       FROM clients c LEFT JOIN users m ON m.id = c.manager_id LEFT JOIN tasks t ON t.client_id = c.id
       WHERE (? OR c.active = 1)
       GROUP BY c.id, m.name
       ORDER BY c.active DESC, MAX(t.created_at) DESC NULLS LAST, c.name`,
      [localToday(s).date, manage && req.query.all === '1'],
    );
    res.json({
      can_manage: manage,
      rows: rows.map((r) => {
        const out = { ...r, active: !!r.active };
        for (const k of ['open_tasks', 'overdue', 'done_30', 'total_tasks']) out[k] = Number(r[k]);
        if (!manage) delete out.notes;
        return out;
      }),
    });
  });

  const fields = (b, s) => {
    const f = {};
    if (b.name !== undefined) f.name = str(b.name, 80) || fail('Client name is required');
    if (b.color !== undefined) f.color = COLORS.includes(b.color) ? b.color : fail('Pick a colour');
    if (b.notes !== undefined) f.notes = str(b.notes, 1000) || null;
    if (b.active !== undefined) f.active = b.active ? 1 : 0;
    if (b.manager_id !== undefined) f.manager_id = b.manager_id ? posInt(b.manager_id) || fail('Invalid account manager') : null;
    return f;
  };

  async function checkManager(id, s) {
    if (!id) return;
    const m = await db.get(`SELECT role, department FROM users WHERE id = ? AND active = 1`, [id]);
    if (!m || !(m.role === 'owner' || m.department === s.am_department)) fail('The account manager must be an owner or in the account managers department');
  }

  app.post('/api/clients', requireUser, async (req, res) => {
    const s = await settings();
    if (!canManageClients(req.user, s)) fail('Only owners and account managers can add clients', 403);
    const f = fields(req.body, s);
    if (!f.name) fail('Client name is required');
    if (f.manager_id === undefined && req.user.role !== 'owner') f.manager_id = req.user.id;
    await checkManager(f.manager_id, s);
    if (await db.get('SELECT 1 FROM clients WHERE lower(name) = lower(?)', [f.name])) fail(`${f.name} is already in your clients`, 409);
    const row = await db.get(
      `INSERT INTO clients (name, color, notes, manager_id) VALUES (?, ?, ?, ?) RETURNING *`,
      [f.name, f.color || COLORS[[...f.name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COLORS.length], f.notes || null, f.manager_id || null],
    );
    await audit(req.user, 'client.create', row.name);
    res.status(201).json(row);
  });

  app.patch('/api/clients/:id', requireUser, async (req, res) => {
    const s = await settings();
    if (!canManageClients(req.user, s)) fail('Only owners and account managers can edit clients', 403);
    const c = await db.get('SELECT * FROM clients WHERE id = ?', [idParam(req)]);
    if (!c) fail('Client not found', 404);
    const f = fields(req.body, s);
    if (f.name && f.name.toLowerCase() !== c.name.toLowerCase() && (await db.get('SELECT 1 FROM clients WHERE lower(name) = lower(?) AND id <> ?', [f.name, c.id]))) {
      fail(`${f.name} is already in your clients`, 409);
    }
    if (f.manager_id !== undefined) await checkManager(f.manager_id, s);
    const keys = Object.keys(f);
    if (!keys.length) return res.json(c);
    const row = await db.get(`UPDATE clients SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`, [...keys.map((k) => f[k]), c.id]);
    // Tasks keep the client's name for search, notifications and Drive folders.
    if (f.name && f.name !== c.name) await db.run('UPDATE tasks SET client = ? WHERE client_id = ?', [f.name, c.id]);
    const what = [f.name && f.name !== c.name && `renamed to ${f.name}`, f.active === 0 && 'archived', f.active === 1 && !c.active && 'restored'].filter(Boolean);
    await audit(req.user, 'client.update', `${c.name}${what.length ? `: ${what.join(', ')}` : ''}`);
    res.json(row);
  });
}

module.exports = { registerClients, resolveClient, canManageClients, COLORS };
