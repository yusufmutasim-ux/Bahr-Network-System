// Google Drive file storage for task deliverables.
// The owner connects their Google account once (OAuth, scope drive.file: the app only sees files it created).
// Files go straight from the browser to Drive through a resumable upload session the server opens,
// so large videos never pass through the (size-limited) serverless function.

const crypto = require('node:crypto');

// Endpoints are read at call time so tests can point them at a fake server.
const url = (key) => ({
  auth: process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  api: process.env.GOOGLE_DRIVE_API || 'https://www.googleapis.com/drive/v3',
  upload: process.env.GOOGLE_DRIVE_UPLOAD || 'https://www.googleapis.com/upload/drive/v3',
  userinfo: process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo',
})[key];

const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'];
const FILE_FIELDS = 'id,name,size,mimeType,webViewLink,iconLink,parents,trashed';
const FOLDER = 'application/vnd.google-apps.folder';

// Values pasted into Vercel often carry spaces, line breaks or quotes: strip them.
const env = (k) => String(process.env[k] || '').trim().replace(/^["']|["']$/g, '').trim();
const clientId = () => env('GOOGLE_CLIENT_ID');
const clientSecret = () => env('GOOGLE_CLIENT_SECRET');
const configured = () => !!(clientId() && clientSecret());

// Spots the usual copy-paste mistakes before sending the owner to Google.
function configProblem() {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) return null;
  if (/^GOCSPX-/.test(id)) return 'GOOGLE_CLIENT_ID contains the client secret. Swap the two values in Vercel.';
  if (!/\.apps\.googleusercontent\.com$/.test(id)) return 'GOOGLE_CLIENT_ID should end with ".apps.googleusercontent.com". Copy the Client ID again from Google Auth Platform → Clients.';
  if (/\.apps\.googleusercontent\.com$/.test(secret)) return 'GOOGLE_CLIENT_SECRET contains the client ID. Swap the two values in Vercel.';
  return null;
}

class DriveError extends Error {}

async function getState(db) {
  const row = await db.get(`SELECT value FROM settings WHERE key = 'drive'`);
  return row ? JSON.parse(row.value) : null;
}
const setState = (db, value) =>
  value
    ? db.run(`INSERT INTO settings (key, value) VALUES ('drive', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [JSON.stringify(value)])
    : db.run(`DELETE FROM settings WHERE key = 'drive'`);

// ----- OAuth -----

async function startAuth(db, userId, redirectUri) {
  const state = crypto.randomBytes(24).toString('base64url');
  await db.run(
    `INSERT INTO settings (key, value) VALUES ('drive_oauth', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify({ state, user_id: userId, exp: Date.now() + 10 * 60 * 1000 })],
  );
  const q = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // always return a refresh token
    include_granted_scopes: 'true',
    state,
  });
  return `${url('auth')}?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch(url('token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new DriveError(data.error_description || data.error || `Google sign-in failed (${res.status})`);
  return data;
}

let cached = null; // { token, exp, refresh }

async function finishAuth(db, { code, state, userId, redirectUri }) {
  const row = await db.get(`SELECT value FROM settings WHERE key = 'drive_oauth'`);
  const saved = row ? JSON.parse(row.value) : null;
  await db.run(`DELETE FROM settings WHERE key = 'drive_oauth'`);
  if (!saved || saved.state !== state || saved.user_id !== userId || saved.exp < Date.now()) {
    throw new DriveError('This sign-in link expired. Start again from Settings.');
  }
  const tok = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri });
  if (!tok.refresh_token) throw new DriveError('Google did not return offline access. Remove the app from your Google account permissions and connect again.');
  cached = { token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000, refresh: tok.refresh_token };
  let email = null;
  try {
    const r = await fetch(url('userinfo'), { headers: { Authorization: `Bearer ${tok.access_token}` } });
    email = (await r.json()).email || null;
  } catch { /* email is only for display */ }
  await setState(db, { refresh_token: tok.refresh_token, email, connected_at: new Date().toISOString(), connected_by: userId, root_id: null });
  const rootId = await ensureFolder(db, 'Bahr Network Files', null);
  await setState(db, { ...(await getState(db)), root_id: rootId });
  return email;
}

async function accessToken(db) {
  const st = await getState(db);
  if (!st?.refresh_token) throw new DriveError('Google Drive is not connected. The owner can connect it in Settings → File storage.');
  if (cached && cached.refresh === st.refresh_token && cached.exp > Date.now()) return cached.token;
  try {
    const tok = await tokenRequest({ refresh_token: st.refresh_token, grant_type: 'refresh_token' });
    cached = { token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000, refresh: st.refresh_token };
    return cached.token;
  } catch (err) {
    throw new DriveError(`Google Drive access stopped working (${err.message}). The owner needs to reconnect it in Settings.`);
  }
}

async function api(db, path, { method = 'GET', body, query, headers = {}, base = 'api', raw = false } = {}) {
  const token = await accessToken(db);
  const q = query ? `?${new URLSearchParams(query)}` : '';
  const res = await fetch(`${url(base)}${path}${q}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new DriveError(data.error?.message || `Google Drive error (${res.status})`);
  return data;
}

// ----- Folders: Bahr Network Files / <client> / <#id task title> -----

const clean = (s) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 100) || 'Untitled';

async function ensureFolder(db, name, parentId) {
  const q = [`name = '${clean(name).replace(/'/g, "\\'")}'`, `mimeType = '${FOLDER}'`, 'trashed = false', parentId ? `'${parentId}' in parents` : null]
    .filter(Boolean)
    .join(' and ');
  const found = await api(db, '/files', { query: { q, fields: 'files(id)', pageSize: '1', spaces: 'drive' } });
  if (found.files?.length) return found.files[0].id;
  const made = await api(db, '/files', { method: 'POST', query: { fields: 'id' }, body: { name: clean(name), mimeType: FOLDER, ...(parentId ? { parents: [parentId] } : {}) } });
  return made.id;
}

// Two uploads starting together could both create a folder: the first to save it wins,
// and the loser moves its own (empty) folder to the trash and uses the winner's.
async function taskFolder(db, task) {
  await accessToken(db); // clear "not connected" error before anything else
  if (task.drive_folder_id) return task.drive_folder_id;
  const st = await getState(db);
  const root = st.root_id || (await ensureFolder(db, 'Bahr Network Files', null));
  const clientFolder = await ensureFolder(db, task.client || 'Internal', root);
  const id = await ensureFolder(db, `#${task.id} ${task.title}`, clientFolder);
  const won = await db.get('UPDATE tasks SET drive_folder_id = ? WHERE id = ? AND drive_folder_id IS NULL RETURNING id', [id, task.id]);
  if (won) return id;
  const winner = (await db.get('SELECT drive_folder_id FROM tasks WHERE id = ?', [task.id])).drive_folder_id;
  if (winner !== id) await trashFile(db, id);
  return winner;
}

// Opens a resumable upload; the browser then PUTs the bytes straight to the returned URL.
async function createUpload(db, task, { name, size, mime }, origin) {
  const folder = await taskFolder(db, task);
  const res = await api(db, '/files', {
    method: 'POST',
    base: 'upload',
    raw: true,
    query: { uploadType: 'resumable', fields: FILE_FIELDS, supportsAllDrives: 'true' },
    headers: {
      'X-Upload-Content-Type': mime || 'application/octet-stream',
      'X-Upload-Content-Length': String(size),
      ...(origin ? { Origin: origin } : {}),
    },
    body: { name: clean(name), parents: [folder] },
  });
  const location = res.headers.get('location');
  if (!res.ok || !location) {
    const data = await res.json().catch(() => ({}));
    throw new DriveError(data.error?.message || `Could not start the upload (${res.status})`);
  }
  return { upload_url: location, folder_id: folder };
}

// Files in the task folder (only ones this app created are visible with drive.file).
async function listFolder(db, folderId) {
  const data = await api(db, '/files', {
    query: { q: `'${folderId}' in parents and trashed = false and mimeType != '${FOLDER}'`, fields: `files(${FILE_FIELDS})`, pageSize: '200' },
  });
  return data.files || [];
}

// Anyone with the link can view, so teammates without access to the owner's Drive can open deliverables.
const shareByLink = (db, fileId) =>
  api(db, `/files/${fileId}/permissions`, { method: 'POST', body: { role: 'reader', type: 'anyone' } }).catch(() => null);

const trashFile = (db, fileId) => api(db, `/files/${fileId}`, { method: 'PATCH', body: { trashed: true } }).catch(() => null);

async function about(db) {
  const a = await api(db, '/about', { query: { fields: 'storageQuota,user(emailAddress)' } });
  return { limit: Number(a.storageQuota?.limit || 0), usage: Number(a.storageQuota?.usage || 0), email: a.user?.emailAddress || null };
}

async function disconnect(db) {
  const st = await getState(db);
  if (st?.refresh_token) {
    await fetch(`${process.env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke'}?token=${encodeURIComponent(st.refresh_token)}`, { method: 'POST' }).catch(() => null);
  }
  cached = null;
  await setState(db, null);
}

module.exports = {
  DriveError, configured, configProblem, getState, startAuth, finishAuth, createUpload, listFolder, shareByLink, trashFile, about, disconnect, taskFolder,
};
