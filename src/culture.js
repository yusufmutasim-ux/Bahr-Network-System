const push = require('./push');

// Team culture features: kudos wall, announcements, people directory, XP levels and badges.

const KUDOS_CATEGORIES = ['creative', 'teamwork', 'extra_mile', 'client_hero', 'good_vibes', 'mentor'];
const REACTIONS = ['🔥', '👏', '❤️', '😂', '🚀', '💯'];
const ANNOUNCEMENT_KINDS = ['news', 'celebration', 'event', 'alert'];

// Agency-flavoured career ladder. XP needed to reach each level.
const LEVELS = [
  [0, 'Fresh Intern'],
  [150, 'Rookie'],
  [400, 'Creator'],
  [800, 'Storyteller'],
  [1400, 'Strategist'],
  [2200, 'Brand Builder'],
  [3200, 'Creative Lead'],
  [4500, 'Mastermind'],
  [6000, 'Legend'],
];

function levelFor(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i += 1;
  const [from, name] = LEVELS[i];
  const next = LEVELS[i + 1];
  return { xp, level: i + 1, name, from, to: next ? next[0] : null, next_name: next ? next[1] : null };
}

// Badges are computed from activity, so nothing to store or backfill.
async function achievements(db, userId, month, streak) {
  const like = `${month}-%`;
  const r = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM attendance WHERE user_id = $1) AS present,
       (SELECT COUNT(*) FROM attendance WHERE user_id = $1 AND status = 'early') AS early,
       (SELECT COUNT(*) FROM attendance WHERE user_id = $1 AND work_date LIKE $2) AS present_month,
       (SELECT COUNT(*) FROM attendance WHERE user_id = $1 AND status = 'early' AND work_date LIKE $2) AS early_month,
       (SELECT COUNT(*) FROM attendance WHERE user_id = $1 AND mood IS NOT NULL) AS moods,
       (SELECT COUNT(*) FROM kudos WHERE to_user = $1) AS kudos_in,
       (SELECT COUNT(*) FROM kudos WHERE from_user = $1) AS kudos_out,
       (SELECT COALESCE(SUM(delta), 0) FROM points WHERE user_id = $1 AND kind = 'red' AND work_date LIKE $2) AS red_month,
       (SELECT COALESCE(SUM(delta), 0) FROM points WHERE user_id = $1 AND kind = 'black' AND work_date LIKE $2) AS black_month`,
    [userId, like],
  );
  const n = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
  const badge = (key, emoji, name, desc, value, target, extra = true) => ({
    // A blocked condition (e.g. a red point this month) keeps the bar just short of full.
    key, emoji, name, desc, progress: extra ? Math.min(value, target) : Math.min(value, target - 1), target, unlocked: value >= target && extra,
  });
  const badges = [
    badge('early_bird', '🐦', 'Early Bird', '5 early check-ins this month', n.early_month, 5),
    badge('on_fire', '🔥', 'On Fire', '5-day on-time streak', streak, 5),
    badge('unstoppable', '⚡', 'Unstoppable', '15-day on-time streak', streak, 15),
    badge('flawless', '💎', 'Flawless Month', '10+ days this month, zero red or black', n.present_month, 10, n.red_month <= 0 && n.black_month <= 0),
    badge('kudos_magnet', '🧲', 'Kudos Magnet', 'Receive 5 kudos', n.kudos_in, 5),
    badge('cheerleader', '📣', 'Cheerleader', 'Send 10 kudos', n.kudos_out, 10),
    badge('open_book', '🌈', 'Open Book', 'Share your mood 10 times', n.moods, 10),
    badge('pillar', '🏛️', 'Pillar', '50 days present', n.present, 50),
    badge('centurion', '💯', 'Centurion', '100 days present', n.present, 100),
  ];
  const unlocked = badges.filter((b) => b.unlocked).length;
  const xp = n.present * 10 + n.early * 15 + n.kudos_in * 20 + n.kudos_out * 5 + unlocked * 50;
  return { level: levelFor(xp), badges, stats: n };
}

function registerCulture(app, ctx) {
  const { db, settings, localToday, now, fail, str, posInt, idParam, requireUser, requireOwner, attendanceStats, addPoints } = ctx;

  // Directory of active people (for kudos, celebrations, profiles). Birthdays expose month-day only.
  app.get('/api/people', requireUser, async (req, res) => {
    const month = localToday(await settings()).date.slice(0, 7);
    const rows = await db.all(
      `SELECT u.id, u.name, u.role, u.job_title, u.department, u.start_date, u.birthday,
              (SELECT COUNT(*) FROM kudos k WHERE k.to_user = u.id AND to_char(k.created_at AT TIME ZONE ?, 'YYYY-MM') = ?) AS kudos_month
       FROM users u WHERE u.active = 1 ORDER BY u.name`,
      [(await settings()).timezone, month],
    );
    res.json(
      rows.map((r) => ({ ...r, birthday: r.birthday ? r.birthday.slice(5, 10) : null, kudos_month: Number(r.kudos_month) })),
    );
  });

  app.get('/api/people/:id', requireUser, async (req, res) => {
    const s = await settings();
    const t = localToday(s);
    const u = await db.get(
      `SELECT id, name, role, job_title, department, start_date, birthday, created_at FROM users WHERE id = ? AND active = 1`,
      [idParam(req)],
    );
    if (!u) fail('Person not found', 404);
    const { streak } = await attendanceStats(u, s, t);
    const [a, kudos] = await Promise.all([
      achievements(db, u.id, t.date.slice(0, 7), streak),
      db.all(
        `SELECT k.id, k.category, k.message, k.created_at, f.name AS from_name
         FROM kudos k JOIN users f ON f.id = k.from_user WHERE k.to_user = ? ORDER BY k.id DESC LIMIT 8`,
        [u.id],
      ),
    ]);
    res.json({ ...u, birthday: u.birthday ? u.birthday.slice(5, 10) : null, streak, ...a, kudos });
  });

  app.get('/api/me/achievements', requireUser, async (req, res) => {
    const s = await settings();
    const t = localToday(s);
    const { streak } = await attendanceStats(req.user, s, t);
    res.json({ streak, ...(await achievements(db, req.user.id, t.date.slice(0, 7), streak)) });
  });

  app.post('/api/me/mood', requireUser, async (req, res) => {
    const mood = Number(req.body.mood);
    if (!Number.isInteger(mood) || mood < 1 || mood > 5) fail('Pick a mood from 1 to 5');
    const t = localToday(await settings());
    const row = await db.get(
      'UPDATE attendance SET mood = ? WHERE user_id = ? AND work_date = ? RETURNING id',
      [mood, req.user.id, t.date],
    );
    if (!row) fail('Check in first, then share your mood');
    res.json({ ok: true });
  });

  // ----- Kudos wall -----

  app.get('/api/kudos', requireUser, async (req, res) => {
    const userId = posInt(req.query.user_id);
    const rows = await db.all(
      `SELECT k.id, k.category, k.message, k.created_at, k.from_user, k.to_user,
              f.name AS from_name, f.department AS from_department, t.name AS to_name, t.department AS to_department
       FROM kudos k JOIN users f ON f.id = k.from_user JOIN users t ON t.id = k.to_user
       WHERE (?::int IS NULL OR k.to_user = ?::int OR k.from_user = ?::int)
       ORDER BY k.id DESC LIMIT 60`,
      [userId, userId, userId],
    );
    const reactions = rows.length
      ? await db.all(
          `SELECT kudos_id, emoji, COUNT(*) AS n, BOOL_OR(user_id = ?) AS mine
           FROM kudos_reactions WHERE kudos_id = ANY(?::int[]) GROUP BY kudos_id, emoji`,
          [req.user.id, rows.map((r) => r.id)],
        )
      : [];
    const today = localToday(await settings()).date;
    const sentToday = await db.get(
      `SELECT COUNT(*) AS n FROM kudos WHERE from_user = ? AND to_char(created_at AT TIME ZONE ?, 'YYYY-MM-DD') = ?`,
      [req.user.id, (await settings()).timezone, today],
    );
    res.json({
      sent_today: Number(sentToday.n),
      rows: rows.map((r) => ({
        ...r,
        reactions: reactions
          .filter((x) => x.kudos_id === r.id)
          .map((x) => ({ emoji: x.emoji, n: Number(x.n), mine: !!x.mine })),
      })),
    });
  });

  app.post('/api/kudos', requireUser, async (req, res) => {
    const s = await settings();
    const t = localToday(s);
    const to = posInt(req.body.to_user_id);
    const category = req.body.category;
    const message = str(req.body.message, 280);
    if (!KUDOS_CATEGORIES.includes(category)) fail('Pick a kudos type');
    if (!to) fail('Pick a teammate');
    if (to === req.user.id) fail('Nice try 😄 Kudos are for teammates');
    const row = await db.tx(async (tx) => {
      await tx.get('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
      const target = await tx.get('SELECT id, role FROM users WHERE id = ? AND active = 1', [to]);
      if (!target) fail('Teammate not found', 404);
      if (req.user.role !== 'owner') {
        const sent = await tx.get(
          `SELECT COUNT(*) AS n FROM kudos WHERE from_user = ? AND to_char(created_at AT TIME ZONE ?, 'YYYY-MM-DD') = ?`,
          [req.user.id, s.timezone, t.date],
        );
        if (Number(sent.n) >= s.kudos_daily_limit) fail(`You can send ${s.kudos_daily_limit} kudos a day. Come back tomorrow!`, 429);
      }
      const k = await tx.get(
        'INSERT INTO kudos (from_user, to_user, category, message, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
        [req.user.id, to, category, message || null, now().toISOString()],
      );
      if (s.kudos_green > 0 && target.role === 'employee') {
        await addPoints(tx, {
          userId: to, kind: 'green', delta: s.kudos_green, workDate: t.date,
          source: 'kudos', reason: `Kudos from ${req.user.name}`, refId: k.id,
        });
      }
      return k;
    });
    const [em, label] = { creative: ['💡', 'Creative Spark'], teamwork: ['🤝', 'Team Player'], extra_mile: ['🚀', 'Extra Mile'],
      client_hero: ['🎯', 'Client Hero'], good_vibes: ['😄', 'Good Vibes'], mentor: ['🧠', 'Mentor'] }[category];
    await push.notifyUsers(db, [to], {
      title: `${em} ${req.user.name} sent you kudos!`,
      body: message ? `${label}: "${message}"` : label,
      url: '/#/profile', tag: `kudos-${row.id}`,
    });
    res.status(201).json(row);
  });

  app.post('/api/kudos/:id/react', requireUser, async (req, res) => {
    const emoji = req.body.emoji;
    if (!REACTIONS.includes(emoji)) fail('Unknown reaction');
    const id = idParam(req);
    if (!(await db.get('SELECT 1 FROM kudos WHERE id = ?', [id]))) fail('Not found', 404);
    const removed = await db.run('DELETE FROM kudos_reactions WHERE kudos_id = ? AND user_id = ? AND emoji = ?', [id, req.user.id, emoji]);
    if (!removed.changes) {
      await db.run(
        'INSERT INTO kudos_reactions (kudos_id, user_id, emoji) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        [id, req.user.id, emoji],
      );
    }
    res.json({ reacted: !removed.changes });
  });

  app.delete('/api/kudos/:id', requireUser, async (req, res) => {
    const id = idParam(req);
    const info =
      req.user.role === 'owner'
        ? await db.run('DELETE FROM kudos WHERE id = ?', [id])
        : await db.run('DELETE FROM kudos WHERE id = ? AND from_user = ?', [id, req.user.id]);
    if (!info.changes) fail('Not found', 404);
    res.json({ ok: true });
  });

  // ----- Announcements -----

  app.get('/api/announcements', requireUser, async (req, res) => {
    res.json(
      await db.all(
        `SELECT a.*, u.name AS author FROM announcements a LEFT JOIN users u ON u.id = a.created_by
         ORDER BY a.pinned DESC, a.id DESC LIMIT 30`,
      ),
    );
  });

  app.post('/api/admin/announcements', requireOwner, async (req, res) => {
    const title = str(req.body.title, 120);
    const body = str(req.body.body, 1000);
    const kind = ANNOUNCEMENT_KINDS.includes(req.body.kind) ? req.body.kind : 'news';
    if (!title) fail('Title is required');
    const row = await db.get(
      'INSERT INTO announcements (title, body, kind, pinned, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
      [title, body || null, kind, req.body.pinned ? 1 : 0, req.user.id, now().toISOString()],
    );
    const em = { news: '📰', celebration: '🎉', event: '📅', alert: '⚠️' }[kind];
    await push.notifyAll(db, { title: `${em} ${title}`, body: body || 'New announcement on the Team Wall', url: '/#/wall', tag: `ann-${row.id}` }, req.user.id);
    res.status(201).json(row);
  });

  app.patch('/api/admin/announcements/:id', requireOwner, async (req, res) => {
    const row = await db.get('UPDATE announcements SET pinned = ? WHERE id = ? RETURNING *', [req.body.pinned ? 1 : 0, idParam(req)]);
    if (!row) fail('Not found', 404);
    res.json(row);
  });

  app.delete('/api/admin/announcements/:id', requireOwner, async (req, res) => {
    const info = await db.run('DELETE FROM announcements WHERE id = ?', [idParam(req)]);
    if (!info.changes) fail('Not found', 404);
    res.json({ ok: true });
  });
}

module.exports = { registerCulture, achievements, levelFor, KUDOS_CATEGORIES, REACTIONS };
