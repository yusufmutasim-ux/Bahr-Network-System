// Web Push notifications (Android, desktop, and iPhone/iPad when installed to the home screen).
// VAPID keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, or are generated once and stored in the DB.

const webpush = require('web-push');

let vapidPromise = null;

function getVapid(db) {
  vapidPromise ||= (async () => {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    }
    const row = await db.get(`SELECT value FROM settings WHERE key = 'vapid'`);
    if (row) return JSON.parse(row.value);
    const keys = webpush.generateVAPIDKeys();
    // Another instance may have raced us: keep whichever was stored first.
    await db.run(`INSERT INTO settings (key, value) VALUES ('vapid', ?) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(keys)]);
    return JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'vapid'`)).value);
  })().catch((err) => {
    vapidPromise = null;
    throw err;
  });
  return vapidPromise;
}

async function saveSubscription(db, userId, sub, userAgent) {
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : '';
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return false;
  }
  await db.run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [userId, endpoint, p256dh.slice(0, 200), auth.slice(0, 100), String(userAgent || '').slice(0, 300)],
  );
  return true;
}

// payload: { title, body, url, tag }. Never throws: notifications must not break the request that triggered them.
async function notifyUsers(db, userIds, payload) {
  try {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return 0;
    const subs = await db.all(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s JOIN users u ON u.id = s.user_id
       WHERE u.active = 1 AND s.user_id = ANY(?::int[])`,
      [ids],
    );
    if (!subs.length) return 0;
    const { publicKey, privateKey } = await getVapid(db);
    const options = {
      vapidDetails: { subject: process.env.VAPID_SUBJECT || 'mailto:notifications@bahr.network', publicKey, privateKey },
      TTL: 60 * 60 * 12,
      timeout: 4000,
    };
    const body = JSON.stringify({ url: '/', ...payload });
    const results = await Promise.allSettled(
      subs.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, options)),
    );
    const gone = subs.filter((s, i) => results[i].status === 'rejected' && [404, 410].includes(results[i].reason?.statusCode));
    if (gone.length) await db.run('DELETE FROM push_subscriptions WHERE id = ANY(?::int[])', [gone.map((s) => s.id)]);
    return results.filter((r) => r.status === 'fulfilled').length;
  } catch (err) {
    console.error('[push] failed', err.message);
    return 0;
  }
}

async function notifyRole(db, role, payload, exceptId = null) {
  const rows = await db.all(`SELECT id FROM users WHERE role = ? AND active = 1 AND id != ?`, [role, exceptId || 0]);
  return notifyUsers(db, rows.map((r) => r.id), payload);
}

async function notifyAll(db, payload, exceptId = null) {
  const rows = await db.all(`SELECT id FROM users WHERE active = 1 AND id != ?`, [exceptId || 0]);
  return notifyUsers(db, rows.map((r) => r.id), payload);
}

module.exports = { getVapid, saveSubscription, notifyUsers, notifyRole, notifyAll };
