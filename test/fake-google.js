// A tiny stand-in for Google OAuth + Drive v3, enough for the app's Drive integration:
// OAuth code/refresh tokens, folder search/create, resumable uploads (chunked, with 308 + Range), permissions, trash.
const http = require('node:http');
const crypto = require('node:crypto');

function startFakeGoogle() {
  const files = new Map(); // id -> { id, name, mimeType, parents, size, trashed, data }
  const sessions = new Map(); // id -> { meta, total, received: Buffer[] , bytes }
  const state = { refreshed: 0, shared: [], files, sessions, failNextChunk: false };
  let base = '';

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Content-Range, Authorization',
    'Access-Control-Expose-Headers': 'Range, Location',
  };
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...headers });
    res.end(JSON.stringify(body));
  };
  const read = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const authed = (req) => /^Bearer at-/.test(req.headers.authorization || '');
  const pick = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, size: f.size == null ? undefined : String(f.size), webViewLink: `https://drive.google.com/file/d/${f.id}/view`, trashed: f.trashed });

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, base);
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (u.pathname === '/auth') {
      const to = new URL(u.searchParams.get('redirect_uri'));
      to.searchParams.set('code', 'good-code');
      to.searchParams.set('state', u.searchParams.get('state'));
      res.writeHead(302, { Location: to.href });
      return res.end();
    }
    if (u.pathname === '/token') {
      const p = new URLSearchParams((await read(req)).toString());
      if (p.get('grant_type') === 'authorization_code') {
        if (p.get('code') !== 'good-code') return json(res, 400, { error: 'invalid_grant' });
        return json(res, 200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 });
      }
      if (p.get('refresh_token') !== 'rt-1') return json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      state.refreshed += 1;
      return json(res, 200, { access_token: `at-${state.refreshed + 1}`, expires_in: 3600 });
    }
    if (u.pathname === '/userinfo') return json(res, 200, { email: 'owner@bahr.network' });
    if (u.pathname === '/revoke') return json(res, 200, {});

    // Resumable upload: chunk PUTs (no auth needed: the session URL is the credential)
    const sess = u.pathname.match(/^\/upload\/session\/(\w+)$/);
    if (sess && req.method === 'PUT') {
      const s = sessions.get(sess[1]);
      if (!s) return json(res, 404, { error: { message: 'No such upload' } });
      const range = req.headers['content-range'] || '';
      const body = await read(req);
      const status = range.match(/^bytes \*\/(\d+)$/);
      if (!status) {
        const m = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (!m || Number(m[1]) !== s.bytes) return json(res, 400, { error: { message: `Bad range ${range}, have ${s.bytes}` } });
        if (state.failNextChunk) { state.failNextChunk = false; s.received.push(body.subarray(0, 100)); s.bytes += 100; req.socket.destroy(); return; }
        s.received.push(body);
        s.bytes += body.length;
      }
      if (s.bytes >= s.total) {
        const f = { ...s.meta, id: crypto.randomBytes(6).toString('hex'), size: s.total, trashed: false };
        files.set(f.id, f);
        sessions.delete(sess[1]);
        return json(res, 200, pick(f));
      }
      res.writeHead(308, { ...cors, ...(s.bytes ? { Range: `bytes=0-${s.bytes - 1}` } : {}) });
      return res.end();
    }

    if (!authed(req)) return json(res, 401, { error: { message: 'Invalid Credentials' } });
    if (u.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
      const meta = JSON.parse((await read(req)).toString());
      const id = crypto.randomBytes(6).toString('hex');
      sessions.set(id, { meta: { ...meta, mimeType: req.headers['x-upload-content-type'] }, total: Number(req.headers['x-upload-content-length']), received: [], bytes: 0, origin: req.headers.origin });
      res.writeHead(200, { ...cors, Location: `${base}/upload/session/${id}` });
      return res.end();
    }
    if (u.pathname === '/drive/v3/about') return json(res, 200, { user: { emailAddress: 'owner@bahr.network' }, storageQuota: { limit: String(5 * 1024 ** 4), usage: String([...files.values()].reduce((a, f) => a + (f.size || 0), 0)) } });
    if (u.pathname === '/drive/v3/files' && req.method === 'GET') {
      const q = u.searchParams.get('q') || '';
      const name = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\'/g, "'");
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      const folderOnly = /mimeType = 'application\/vnd.google-apps.folder'/.test(q);
      const noFolders = /mimeType != 'application\/vnd.google-apps.folder'/.test(q);
      const list = [...files.values()].filter((f) => !f.trashed
        && (name == null || f.name === name)
        && (parent == null || (f.parents || []).includes(parent))
        && (!folderOnly || f.mimeType === 'application/vnd.google-apps.folder')
        && (!noFolders || f.mimeType !== 'application/vnd.google-apps.folder'));
      return json(res, 200, { files: list.map(pick) });
    }
    if (u.pathname === '/drive/v3/files' && req.method === 'POST') {
      const meta = JSON.parse((await read(req)).toString());
      const f = { ...meta, id: crypto.randomBytes(6).toString('hex'), trashed: false };
      files.set(f.id, f);
      return json(res, 200, { id: f.id });
    }
    const perm = u.pathname.match(/^\/drive\/v3\/files\/(\w+)\/permissions$/);
    if (perm) { state.shared.push(perm[1]); return json(res, 200, { id: 'anyoneWithLink' }); }
    const one = u.pathname.match(/^\/drive\/v3\/files\/(\w+)$/);
    if (one && req.method === 'PATCH') {
      const f = files.get(one[1]);
      if (!f) return json(res, 404, { error: { message: 'File not found' } });
      Object.assign(f, JSON.parse((await read(req)).toString()));
      return json(res, 200, pick(f));
    }
    json(res, 404, { error: { message: `Unknown ${req.method} ${u.pathname}` } });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    Object.assign(process.env, {
      GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
      GOOGLE_AUTH_URL: `${base}/auth`, GOOGLE_TOKEN_URL: `${base}/token`, GOOGLE_USERINFO_URL: `${base}/userinfo`,
      GOOGLE_REVOKE_URL: `${base}/revoke`, GOOGLE_DRIVE_API: `${base}/drive/v3`, GOOGLE_DRIVE_UPLOAD: `${base}/upload/drive/v3`,
    });
    resolve({ base, state, close: () => server.close() });
  }));
}

module.exports = { startFakeGoogle };
