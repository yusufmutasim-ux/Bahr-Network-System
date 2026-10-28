const crypto = require('node:crypto');

const SESSION_DAYS = 30;
const COOKIE = 'bahr_sid';
// Long-lived random device id. Only its SHA-256 hash is stored server-side.
const DEVICE_COOKIE = 'bahr_dev';
const DEVICE_YEARS = 10;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const secureFlag = () => (process.env.COOKIE_SECURE === '1' || process.env.VERCEL ? '; Secure' : '');
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

async function createSession(db, userId, deviceHash = null) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
  await db.run('INSERT INTO sessions (token, user_id, expires_at, device_hash) VALUES (?, ?, ?, ?)', [
    token, userId, expires, deviceHash,
  ]);
  return { token, expires };
}

function setSessionCookie(res, token, expires) {
  res.append(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expires).toUTCString()}${secureFlag()}`,
  );
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// Returns this browser's device hash, issuing a new device cookie if it has none.
function ensureDevice(req, res) {
  let id = parseCookies(req.headers.cookie)[DEVICE_COOKIE];
  if (!id || !/^[a-f0-9]{64}$/.test(id)) {
    id = crypto.randomBytes(32).toString('hex');
    res.append(
      'Set-Cookie',
      `${DEVICE_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DEVICE_YEARS * 365 * 86400}${secureFlag()}`,
    );
  }
  return sha256(id);
}

const deviceHash = (req) => {
  const id = parseCookies(req.headers.cookie)[DEVICE_COOKIE];
  return id ? sha256(id) : null;
};

// Short human label like "iPhone · Safari" for the owner's staff screen.
function deviceLabel(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

async function sessionUser(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = await db.get(
    `SELECT u.id, u.name, u.username, u.role, u.phone, u.job_title, u.active, u.start_date, u.created_at, u.department, u.birthday, u.remote_allowed, s.token,
            s.device_hash AS session_device
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`,
    [token, Date.now()],
  );
  if (!row || !row.active) return null;
  // A session bound to a device only works together with that device's cookie (a copied session cookie is useless).
  if (row.session_device && row.session_device !== deviceHash(req)) return null;
  return row;
}

// Simple in-memory brute-force guard for the login endpoint (per server instance).
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

function loginBlocked(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) return false;
  return f.count >= MAX_FAILURES;
}

function recordLoginFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { first: Date.now(), count: 1 });
  else f.count += 1;
}

function clearLoginFailures(key) {
  failures.delete(key);
}

module.exports = {
  ensureDevice,
  deviceHash,
  deviceLabel,
  hashPassword,
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  sessionUser,
  loginBlocked,
  recordLoginFailure,
  clearLoginFailures,
};
