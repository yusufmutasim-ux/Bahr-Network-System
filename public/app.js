'use strict';

// ---------- Helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const STATUS = {
  early: ['Early', 'green'],
  on_time: ['On time', 'brand'],
  late: ['Late', 'red'],
  very_late: ['Very late', 'red'],
  off_day: ['Day off', ''],
  leave: ['On leave', 'amber'],
  absent: ['Absent', 'black'],
  waiting: ['Not checked in', ''],
  not_started: ['Starts later', ''],
};
const KIND = { green: 'Green', red: 'Red', black: 'Black' };
const SOURCE = {
  early: 'Early check-in',
  late: 'Late check-in',
  absent: 'Absence',
  manual: 'Owner adjustment',
  redeem: 'Green → Red swap',
  reward: 'Reward request',
  reward_refund: 'Reward refund',
};
const REQ = {
  pending: ['Pending', 'amber'],
  approved: ['Approved', 'green'],
  paid: ['Paid', 'green'],
  rejected: ['Rejected', 'red'],
  cancelled: ['Cancelled', ''],
};
const METHODS = { instapay: 'InstaPay', vodafone_cash: 'Vodafone Cash', cash: 'Cash' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const badge = (map, key) => {
  const [label, cls] = map[key] || [key, ''];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
};
const kindBadge = (kind, delta) =>
  `<span class="badge ${kind}"><span class="num">${delta > 0 ? '+' : ''}${delta}</span> ${KIND[kind]}</span>`;

function fmtTime(hhmm) {
  if (!hhmm) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}
const money = (n, cur) => `${Number(n || 0).toLocaleString('en-US')} ${esc(cur || 'EGP')}`;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 3500);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// Run an async action from a form or button, with busy state and error toasts.
async function act(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try {
    await fn();
    if (okMsg) toast(okMsg, 'success');
    return true;
  } catch (err) {
    if (err.status === 401 && me) return start();
    toast(err.message, 'error');
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function modal(html, onSubmit) {
  const dlg = $('#modal');
  dlg.innerHTML = `<form class="card" method="dialog">${html}
    <div class="btn-row" style="margin-top:12px">
      <button class="btn" type="submit">Save</button>
      <button class="btn light" type="button" data-close>Cancel</button>
    </div></form>`;
  const form = $('form', dlg);
  $('[data-close]', dlg).onclick = () => dlg.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const ok = await act(e.submitter, () => onSubmit(formData(form)));
    if (ok) dlg.close();
  };
  dlg.showModal();
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device does not support location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        reject(new Error(e.code === 1 ? 'Location permission denied. Allow location access and try again.' : 'Could not get your location. Try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

// ---------- App shell & routing ----------

let me = null;
let pending = { leaves: 0, rewards: 0 };
let clockTimer;

const EMPLOYEE_ROUTES = {
  '': ['Check in', viewCheckIn],
  leaves: ['Leave', viewMyLeaves],
  rewards: ['Rewards', viewMyRewards],
  history: ['History', viewMyHistory],
  account: ['Account', viewAccount],
};
const OWNER_ROUTES = {
  '': ['Today', viewOverview],
  employees: ['Staff', viewEmployees],
  points: ['Points', viewPoints],
  leaves: ['Leave requests', viewLeaves],
  rewards: ['Reward requests', viewRewards],
  reports: ['Monthly report', viewReport],
  settings: ['Settings', viewSettings],
  account: ['Account', viewAccount],
  staff: [null, viewStaffHistory],
};

function routes() {
  return me.role === 'owner' ? OWNER_ROUTES : EMPLOYEE_ROUTES;
}

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { path, params: new URLSearchParams(query) };
}

function renderNav(active) {
  const nav = $('#nav');
  nav.innerHTML = Object.entries(routes())
    .filter(([, [label]]) => label)
    .map(([key, [label]]) => {
      const count = me.role === 'owner' ? pending[key] : 0;
      return `<a href="#/${key}" class="${key === active ? 'active' : ''}">${esc(label)}${
        count ? ` <span class="badge red">${count}</span>` : ''
      }</a>`;
    })
    .join('');
  nav.hidden = false;
}

async function route() {
  if (!me) return;
  clearInterval(clockTimer);
  const { path, params } = parseHash();
  const entry = routes()[path] || routes()[''];
  renderNav(routes()[path] ? path : '');
  app.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await entry[1](params);
  } catch (err) {
    if (err.status === 401) return start();
    app.innerHTML = `<div class="notice red">${esc(err.message)}</div>`;
  }
}

async function start() {
  me = null;
  $('#topbar').hidden = true;
  $('#nav').hidden = true;
  try {
    const data = await api('/me');
    me = data.user;
    $('#company-name').textContent = data.company_name;
    $('#user-name').textContent = `${me.name} · ${me.role === 'owner' ? 'Owner' : me.job_title || 'Staff'}`;
    document.title = `${data.company_name} — Attendance`;
    $('#topbar').hidden = false;
    if (me.role === 'owner') await refreshPending();
    route();
  } catch {
    const setup = await api('/setup');
    setup.needsSetup ? viewSetup(setup) : viewLogin(setup);
  }
}

async function refreshPending() {
  try {
    const o = await api('/admin/overview');
    pending = o.pending;
  } catch {
    /* non-critical */
  }
}

window.addEventListener('hashchange', route);
$('#logout-btn').onclick = async () => {
  await api('/logout', { method: 'POST', body: {} }).catch(() => {});
  location.hash = '';
  start();
};

// ---------- Auth views ----------

function authShell(title, subtitle, inner) {
  app.innerHTML = `<div class="auth">
    <div class="logo"><img src="/icon.svg" width="64" height="64" alt="">
      <h1>${esc(title)}</h1><p class="muted">${esc(subtitle)}</p></div>
    <div class="card">${inner}</div></div>`;
}

function viewLogin(info) {
  authShell(info.company_name, 'Staff login', `
    <form id="login">
      <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus></div>
      <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn big" type="submit">Log in</button>
    </form>`);
  $('#login').onsubmit = (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      await api('/login', { method: 'POST', body: formData(e.target) });
      await start();
    });
  };
}

function viewSetup(info) {
  authShell('Welcome 👋', 'First-time setup: create the owner account', `
    <form id="setup">
      <div class="field"><label>Company name</label><input name="company_name" value="${esc(info.company_name)}" required></div>
      <div class="field"><label>Your name</label><input name="name" required></div>
      <div class="field"><label>Username</label><input name="username" autocomplete="username" required></div>
      <div class="field"><label>Password (6+ characters)</label><input name="password" type="password" minlength="6" autocomplete="new-password" required></div>
      <button class="btn big" type="submit">Create owner account</button>
    </form>`);
  $('#setup').onsubmit = (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      await api('/setup', { method: 'POST', body: formData(e.target) });
      location.hash = '#/settings';
      await start();
      toast('Set your office location to enable GPS check-in', 'success');
    });
  };
}

function viewAccount() {
  app.innerHTML = `<div class="card" style="max-width:480px">
    <h2>Change password</h2>
    <form id="pw">
      <div class="field"><label>Current password</label><input name="current" type="password" autocomplete="current-password" required></div>
      <div class="field"><label>New password</label><input name="next" type="password" minlength="6" autocomplete="new-password" required></div>
      <button class="btn" type="submit">Update password</button>
    </form></div>`;
  $('#pw').onsubmit = (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      await api('/me/password', { method: 'POST', body: formData(e.target) });
      e.target.reset();
    }, 'Password updated');
  };
}

// ---------- Shared pieces ----------

function windowsHtml(r) {
  return `<div class="windows">
    <div class="window green"><span>Early · +1 green point</span><span class="num">${fmtTime(r.early_start)} – ${fmtTime(r.early_end)}</span></div>
    <div class="window normal"><span>On time</span><span class="num">${fmtTime(r.early_end)} – ${fmtTime(r.late_after)}</span></div>
    <div class="window red"><span>Late · 1 red penalty</span><span class="num">${fmtTime(r.late_after)} – ${fmtTime(r.very_late_after)}</span></div>
    <div class="window red"><span>Very late · ${r.very_late_reds} red penalties</span><span class="num">${fmtTime(r.very_late_after)} – ${fmtTime(r.close)}</span></div>
    <div class="window black"><span>Check-in closed · black absence</span><span class="num">after ${fmtTime(r.close)}</span></div>
  </div>`;
}

function statCards(green, red, black, labels = ['Green points', 'Red penalties', 'Black absences']) {
  return `<div class="grid grid-3">
    <div class="stat green"><div class="label"><span class="dot green"></span>${labels[0]}</div><div class="value num">${green}</div></div>
    <div class="stat red"><div class="label"><span class="dot red"></span>${labels[1]}</div><div class="value num">${red}</div></div>
    <div class="stat black"><div class="label"><span class="dot black"></span>${labels[2]}</div><div class="value num">${black}</div></div>
  </div>`;
}

function historyTables(h) {
  return `
    <div class="card"><h2>Attendance</h2>${
      h.attendance.length
        ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Check in</th><th>Check out</th><th>Status</th><th>Distance</th></tr></thead><tbody>${h.attendance
            .map(
              (a) => `<tr><td>${fmtDate(a.work_date)}</td><td class="num">${fmtTime(a.check_in_time)}</td>
                <td class="num">${fmtTime(a.check_out_time)}</td><td>${badge(STATUS, a.status)}</td>
                <td class="num">${a.distance_m == null ? 'manual' : `${a.distance_m} m`}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="empty">No attendance this month.</p>'
    }</div>
    <div class="card"><h2>Points log</h2>${
      h.points.length
        ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Points</th><th>Source</th><th>Reason</th></tr></thead><tbody>${h.points
            .map(
              (p) => `<tr><td>${fmtDate(p.work_date)}</td><td>${kindBadge(p.kind, p.delta)}</td>
                <td>${esc(SOURCE[p.source] || p.source)}</td><td class="wrap">${esc(p.reason)}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="empty">No points this month.</p>'
    }</div>`;
}

// ---------- Employee views ----------

async function viewCheckIn() {
  const d = await api('/me/dashboard');
  const r = d.rules;
  const a = d.attendance;
  const m = d.balances.month;

  let statusHtml;
  if (a) {
    const earned = a.status === 'early' ? ' — you earned 1 green point 🎉' : a.status.includes('late') ? ' — red penalty recorded' : '';
    statusHtml = `<div class="notice ${a.status === 'early' ? 'green' : a.status.includes('late') ? 'red' : ''}">
        Checked in at <span class="num">${fmtTime(a.check_in_time)}</span> · ${STATUS[a.status][0]}${earned}
        ${a.check_out_time ? `<br>Checked out at <span class="num">${fmtTime(a.check_out_time)}</span>` : ''}
      </div>
      ${a.check_out_time ? '' : '<button class="btn big light" id="checkout">Check out</button>'}`;
  } else {
    const notes = [];
    if (!d.work_day) notes.push('<div class="notice amber">Today is not a work day.</div>');
    if (d.on_leave) notes.push('<div class="notice amber">You are on approved leave today.</div>');
    const gated = d.work_day && d.check_in_window !== 'open';
    if (gated && d.check_in_window === 'closed') notes.push(`<div class="notice red">Check-in closed at ${fmtTime(r.close)}.</div>`);
    if (gated && d.check_in_window === 'not_open') notes.push(`<div class="notice">Check-in opens at ${fmtTime(r.early_start)}.</div>`);
    statusHtml = gated ? notes.join('') : `${notes.join('')}<button class="btn big green" id="checkin">📍 Check in</button>
      <p class="muted small" style="margin-top:8px">Your location is checked when you check in. You must be within ${r.radius_m} m of the office.</p>`;
  }

  const canRedeem = d.balances.green >= 1 && m.red >= 1;
  app.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>Staff check-in</h2><span class="muted small">${fmtDate(d.now.date)}</span></div>
        <div class="clock num" id="clock">${fmtTime(d.now.time)}</div>
        <p class="muted small">Server time (${esc(r.company_name)})</p>
        ${statusHtml}
      </div>
      <div class="card"><h2>Check-in times</h2>${windowsHtml(r)}</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>My points</h2><span class="muted small">this month</span></div>
      ${statCards(d.balances.green, m.red, m.black, ['Green points (balance)', 'Red penalties', 'Black absences'])}
      ${
        canRedeem
          ? `<div class="notice green" style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
               <span>Use 1 green point to remove 1 red penalty</span>
               <button class="btn small green" id="redeem">Use 1 green point</button></div>`
          : ''
      }
    </div>
    <div class="card">
      <h2>Monthly attendance deductions</h2>
      <div class="deduction-line"><span><span class="dot red"></span> Red: <span class="num">${d.deductions.red} × ${money(d.deductions.red_value, r.currency)}</span></span><span class="num">${money(d.deductions.red * d.deductions.red_value, r.currency)}</span></div>
      <div class="deduction-line"><span><span class="dot black"></span> Black: <span class="num">${d.deductions.black} × ${money(d.deductions.black_value, r.currency)}</span></span><span class="num">${money(d.deductions.black * d.deductions.black_value, r.currency)}</span></div>
      <div class="deduction-line"><span>Total deduction</span><span class="num">${money(d.deductions.total, r.currency)}</span></div>
    </div>`;

  // Keep the clock ticking from server time.
  const base = Date.now();
  const [h, mi] = d.now.time.split(':').map(Number);
  const startSec = h * 3600 + mi * 60 + d.now.seconds;
  clockTimer = setInterval(() => {
    const s = Math.floor(startSec + (Date.now() - base) / 1000) % 86400;
    const el = $('#clock');
    if (el) el.textContent = fmtTime(`${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`);
  }, 1000);

  const checkin = $('#checkin');
  if (checkin) {
    checkin.onclick = () =>
      act(checkin, async () => {
        checkin.textContent = 'Getting your location…';
        try {
          const pos = await getPosition();
          checkin.textContent = 'Checking in…';
          const res = await api('/me/check-in', { method: 'POST', body: pos });
          toast(res.green ? 'Checked in early! +1 green point' : res.red ? `Checked in late: ${res.red} red penalty` : 'Checked in ✓', res.red ? 'error' : 'success');
          route();
        } finally {
          checkin.textContent = '📍 Check in';
        }
      });
  }
  const checkout = $('#checkout');
  if (checkout) {
    checkout.onclick = () =>
      act(checkout, async () => {
        await api('/me/check-out', { method: 'POST', body: {} });
        route();
      }, 'Checked out');
  }
  const redeem = $('#redeem');
  if (redeem) {
    redeem.onclick = () =>
      act(redeem, async () => {
        await api('/me/redeem', { method: 'POST', body: {} });
        route();
      }, '1 red penalty removed');
  }
}

async function viewMyLeaves() {
  const list = await api('/me/leaves');
  const today = new Date().toISOString().slice(0, 10);
  app.innerHTML = `
    <div class="card">
      <h2>Request leave 🏖️</h2>
      <p class="muted small">Approved leave days don't count as absences, so you won't get a black point.</p>
      <form id="leave">
        <div class="form-grid">
          <div class="field"><label>From</label><input type="date" name="from_date" min="${today}" required></div>
          <div class="field"><label>To</label><input type="date" name="to_date" min="${today}" required></div>
        </div>
        <div class="field" style="margin-top:12px"><label>Reason (optional)</label><textarea name="reason" maxlength="500"></textarea></div>
        <button class="btn" type="submit">Send leave request</button>
      </form>
    </div>
    <div class="card"><h2>My leave requests</h2>${
      list.length
        ? `<div class="table-wrap"><table><thead><tr><th>From</th><th>To</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>${list
            .map(
              (l) => `<tr><td>${fmtDate(l.from_date)}</td><td>${fmtDate(l.to_date)}</td><td class="wrap">${esc(l.reason) || '—'}</td>
                <td>${badge(REQ, l.status)}</td>
                <td>${l.status === 'pending' ? `<button class="btn small light" data-cancel="${l.id}">Cancel</button>` : ''}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="empty">No leave requests yet.</p>'
    }</div>`;
  $('#leave').onsubmit = (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      await api('/me/leaves', { method: 'POST', body: formData(e.target) });
      route();
    }, 'Leave request sent');
  };
  app.querySelectorAll('[data-cancel]').forEach((b) => {
    b.onclick = () => act(b, async () => {
      await api(`/me/leaves/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} });
      route();
    }, 'Request cancelled');
  });
}

async function viewMyRewards() {
  const [d, list] = await Promise.all([api('/me/dashboard'), api('/me/rewards')]);
  const r = d.rules;
  app.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <h2>Green points</h2>
        <div class="stat green"><div class="label"><span class="dot green"></span>Available balance</div><div class="value num">${d.balances.green}</div></div>
        <p class="muted" style="margin-top:12px">1 green point = <strong class="num">${money(r.green_value, r.currency)}</strong>.
          Minimum request: <strong class="num">${r.min_reward_points}</strong> points.</p>
        <p class="muted small">You earn a green point every time you check in early.</p>
      </div>
      <div class="card">
        <h2>Send reward request 🎁</h2>
        <form id="reward">
          <div class="field"><label>Points</label><input type="number" name="points" min="${r.min_reward_points}" max="${Math.max(d.balances.green, r.min_reward_points)}" value="${Math.max(Math.min(d.balances.green, 1e6), r.min_reward_points)}" required></div>
          <div class="field"><label>Payout method</label>
            <div class="checks">${Object.entries(METHODS)
              .map(([k, v], i) => `<label><input type="radio" name="method" value="${k}" ${i === 0 ? 'checked' : ''}> ${v}</label>`)
              .join('')}</div></div>
          <div class="field" id="number-field"><label>Mobile / payout number</label><input name="payout_number" inputmode="tel" placeholder="01xxxxxxxxx or name@instapay"></div>
          <p class="notice" id="amount"></p>
          <button class="btn" type="submit" ${d.balances.green < r.min_reward_points ? 'disabled' : ''}>Send reward request</button>
          ${d.balances.green < r.min_reward_points ? `<p class="muted small" style="margin-top:8px">You need at least ${r.min_reward_points} green points.</p>` : ''}
        </form>
      </div>
    </div>
    <div class="card"><h2>My reward requests</h2>${
      list.length
        ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Points</th><th>Amount</th><th>Method</th><th>Status</th><th></th></tr></thead><tbody>${list
            .map(
              (x) => `<tr><td>${fmtDate(x.created_at)}</td><td class="num">${x.points}</td><td class="num">${money(x.amount, r.currency)}</td>
                <td>${METHODS[x.method]} <span class="muted num">${esc(x.payout_number || '')}</span></td><td>${badge(REQ, x.status)}</td>
                <td>${x.status === 'pending' ? `<button class="btn small light" data-cancel="${x.id}">Cancel</button>` : ''}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="empty">No reward requests yet.</p>'
    }</div>`;
  const form = $('#reward');
  const update = () => {
    const pts = Number(form.points.value) || 0;
    $('#amount').innerHTML = `<span class="num">${pts}</span> points ≈ <strong class="num">${money(pts * r.green_value, r.currency)}</strong>`;
    $('#number-field').hidden = form.method.value === 'cash';
  };
  form.oninput = update;
  update();
  form.onsubmit = (e) => {
    e.preventDefault();
    const body = formData(form);
    body.points = Number(body.points);
    act(e.submitter, async () => {
      await api('/me/rewards', { method: 'POST', body });
      route();
    }, 'Reward request sent');
  };
  app.querySelectorAll('[data-cancel]').forEach((b) => {
    b.onclick = () => act(b, async () => {
      await api(`/me/rewards/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} });
      route();
    }, 'Request cancelled, points returned');
  });
}

async function viewMyHistory(params) {
  const month = params.get('month') || thisMonth();
  const h = await api(`/me/history?month=${month}`);
  app.innerHTML = `<div class="card"><div class="card-head"><h2>My history</h2>
      <input type="month" id="month" value="${month}" style="max-width:200px"></div>
      ${statCards(h.balances.month.green, h.balances.month.red, h.balances.month.black)}</div>
    ${historyTables(h)}`;
  $('#month').onchange = (e) => (location.hash = `#/history?month=${e.target.value}`);
}

// ---------- Owner views ----------

async function viewOverview(params) {
  const date = params.get('date') || '';
  const o = await api(`/admin/overview${date ? `?date=${date}` : ''}`);
  pending = o.pending;
  renderNav('');
  const counts = {};
  for (const r of o.rows) counts[r.status] = (counts[r.status] || 0) + 1;
  const present = (counts.early || 0) + (counts.on_time || 0) + (counts.late || 0) + (counts.very_late || 0);
  app.innerHTML = `
    ${o.pending.leaves || o.pending.rewards ? `<div class="notice amber">You have
      ${o.pending.leaves ? `<a href="#/leaves">${o.pending.leaves} pending leave request(s)</a>` : ''}
      ${o.pending.leaves && o.pending.rewards ? ' and ' : ''}
      ${o.pending.rewards ? `<a href="#/rewards">${o.pending.rewards} pending reward request(s)</a>` : ''}.</div>` : ''}
    <div class="card">
      <div class="card-head"><h2>Attendance · ${fmtDate(o.date)}</h2>
        <input type="date" id="date" value="${o.date}" style="max-width:200px"></div>
      ${o.work_day ? '' : '<div class="notice amber">Not a work day.</div>'}
      <div class="grid grid-4" style="margin-bottom:16px">
        <div class="stat brand"><div class="label">Present</div><div class="value num">${present}/${o.rows.length}</div></div>
        <div class="stat green"><div class="label"><span class="dot green"></span>Early</div><div class="value num">${counts.early || 0}</div></div>
        <div class="stat red"><div class="label"><span class="dot red"></span>Late</div><div class="value num">${(counts.late || 0) + (counts.very_late || 0)}</div></div>
        <div class="stat black"><div class="label"><span class="dot black"></span>Absent</div><div class="value num">${counts.absent || 0}</div></div>
      </div>
      ${
        o.rows.length
          ? `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Check in</th><th>Check out</th><th>Status</th><th>Distance</th><th></th></tr></thead><tbody>${o.rows
              .map(
                (r) => `<tr><td><strong>${esc(r.name)}</strong><br><span class="muted small">${esc(r.job_title || '')}</span></td>
                  <td class="num">${fmtTime(r.check_in_time)}</td><td class="num">${fmtTime(r.check_out_time)}</td>
                  <td>${badge(STATUS, r.status)}</td><td class="num">${r.distance_m == null ? '—' : `${r.distance_m} m`}</td>
                  <td>${r.check_in_time ? '' : `<button class="btn small light" data-manual="${r.id}" data-name="${esc(r.name)}">Record manually</button>`}</td></tr>`,
              )
              .join('')}</tbody></table></div>`
          : '<p class="empty">No employees yet. <a href="#/employees">Add your staff</a>.</p>'
      }
    </div>
    <div class="card"><h2>Check-in rules</h2>${windowsHtml(o.rules)}
      <p class="muted small" style="margin-top:8px">Red = ${money(o.rules.red_value, o.rules.currency)} deduction · Black = ${money(o.rules.black_value, o.rules.currency)} deduction · Green = ${money(o.rules.green_value, o.rules.currency)} reward.
      Work days: ${o.rules.work_days.map((d) => DAYS[d].slice(0, 3)).join(', ')}.</p></div>`;
  $('#date').onchange = (e) => (location.hash = `#/?date=${e.target.value}`);
  app.querySelectorAll('[data-manual]').forEach((b) => {
    b.onclick = () =>
      modal(
        `<h2>Record attendance · ${b.dataset.name}</h2>
        <p class="muted small">Use this when GPS failed. It clears the absence for that day. Points are not added automatically — use the Points page if needed.</p>
        <div class="form-grid">
          <div class="field"><label>Date</label><input type="date" name="work_date" value="${o.date}" required></div>
          <div class="field"><label>Time</label><input type="time" name="time" value="${o.rules.early_end}" required></div>
        </div>
        <div class="field" style="margin-top:12px"><label>Status</label><select name="status">
          ${['early', 'on_time', 'late', 'very_late', 'off_day'].map((s) => `<option value="${s}" ${s === 'on_time' ? 'selected' : ''}>${STATUS[s][0]}</option>`).join('')}
        </select></div>`,
        async (data) => {
          await api('/admin/attendance', { method: 'POST', body: { ...data, user_id: Number(b.dataset.manual) } });
          toast('Attendance recorded', 'success');
          route();
        },
      );
  });
}

async function viewEmployees() {
  const users = await api('/admin/users');
  app.innerHTML = `
    <div class="card">
      <h2>Add employee</h2>
      <form id="add">
        <div class="form-grid">
          <div class="field"><label>Full name</label><input name="name" required></div>
          <div class="field"><label>Username</label><input name="username" pattern="[A-Za-z0-9_.@\\-]{3,40}" title="3+ letters/numbers, no spaces" autocomplete="off" required></div>
          <div class="field"><label>Password</label><input name="password" type="text" minlength="6" autocomplete="off" required></div>
          <div class="field"><label>Job title</label><input name="job_title"></div>
          <div class="field"><label>Phone</label><input name="phone" inputmode="tel"></div>
          <div class="field"><label>Role</label><select name="role"><option value="employee">Employee</option><option value="owner">Owner / manager</option></select></div>
        </div>
        <button class="btn" type="submit" style="margin-top:12px">Add</button>
      </form>
    </div>
    <div class="card"><h2>Team</h2>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Phone</th><th>Green</th><th>Red (month)</th><th>Black (month)</th><th>Status</th><th></th></tr></thead><tbody>
      ${users
        .map(
          (u) => `<tr>
            <td><strong>${esc(u.name)}</strong><br><span class="muted small">${u.role === 'owner' ? 'Owner' : esc(u.job_title || 'Employee')}</span></td>
            <td class="num">${esc(u.username)}</td><td class="num">${esc(u.phone || '—')}</td>
            <td class="num">${u.balances ? u.balances.green : '—'}</td>
            <td class="num">${u.balances ? u.balances.month.red : '—'}</td>
            <td class="num">${u.balances ? u.balances.month.black : '—'}</td>
            <td>${u.active ? '<span class="badge green">Active</span>' : '<span class="badge">Inactive</span>'}</td>
            <td><div class="btn-row">
              ${u.role === 'employee' ? `<a class="btn small light" href="#/staff?id=${u.id}">History</a>` : ''}
              <button class="btn small light" data-edit="${u.id}">Edit</button>
              ${u.id !== me.id ? `<button class="btn small light" data-toggle="${u.id}" data-active="${u.active}">${u.active ? 'Deactivate' : 'Activate'}</button>` : ''}
            </div></td></tr>`,
        )
        .join('')}
      </tbody></table></div></div>`;
  $('#add').onsubmit = (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      await api('/admin/users', { method: 'POST', body: formData(e.target) });
      route();
    }, 'Employee added');
  };
  app.querySelectorAll('[data-edit]').forEach((b) => {
    const u = users.find((x) => x.id === Number(b.dataset.edit));
    b.onclick = () =>
      modal(
        `<h2>Edit ${esc(u.name)}</h2>
        <div class="field"><label>Full name</label><input name="name" value="${esc(u.name)}" required></div>
        <div class="form-grid">
          <div class="field"><label>Job title</label><input name="job_title" value="${esc(u.job_title || '')}"></div>
          <div class="field"><label>Phone</label><input name="phone" value="${esc(u.phone || '')}"></div>
        </div>
        <div class="field" style="margin-top:12px"><label>Absences counted from</label><input type="date" name="start_date" value="${esc(u.start_date)}"></div>
        <div class="field"><label>New password (leave empty to keep)</label><input name="password" type="text" minlength="6" autocomplete="off"></div>`,
        async (data) => {
          if (!data.password) delete data.password;
          await api(`/admin/users/${u.id}`, { method: 'PATCH', body: data });
          toast('Saved', 'success');
          route();
        },
      );
  });
  app.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = () => {
      const active = b.dataset.active === '1';
      if (active && !confirm('Deactivate this account? They will no longer be able to log in.')) return;
      act(b, async () => {
        await api(`/admin/users/${b.dataset.toggle}`, { method: 'PATCH', body: { active: !active } });
        route();
      });
    };
  });
}

async function viewStaffHistory(params) {
  const id = params.get('id');
  const month = params.get('month') || thisMonth();
  const [users, h] = await Promise.all([api('/admin/users'), api(`/admin/users/${id}/history?month=${month}`)]);
  const u = users.find((x) => x.id === Number(id));
  app.innerHTML = `<div class="card"><div class="card-head"><h2>${esc(u ? u.name : 'Employee')} · history</h2>
      <input type="month" id="month" value="${month}" style="max-width:200px"></div>
      ${statCards(h.balances.month.green, h.balances.month.red, h.balances.month.black, ['Green (month)', 'Red (month)', 'Black (month)'])}
      <p class="muted small" style="margin-top:8px">Green balance: <strong class="num">${h.balances.green}</strong></p></div>
    ${historyTables(h)}`;
  $('#month').onchange = (e) => (location.hash = `#/staff?id=${id}&month=${e.target.value}`);
}

async function viewPoints() {
  const [users, log] = await Promise.all([api('/admin/users'), api('/admin/points')]);
  const staff = users.filter((u) => u.role === 'employee' && u.active);
  const today = new Date().toISOString().slice(0, 10);
  app.innerHTML = `
    <div class="card">
      <h2>Owner — adjust points</h2>
      <form id="adjust">
        <div class="form-grid">
          <div class="field"><label>Employee</label><select name="user_id" required>
            <option value="">Choose…</option>${staff.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Action</label><select name="action">
            <option value="add">Add</option><option value="remove">Remove</option></select></div>
          <div class="field"><label>Type</label><select name="kind">
            <option value="green">🟢 Green point</option><option value="red">🔴 Red penalty</option><option value="black">⚫ Black absence</option></select></div>
          <div class="field"><label>Points</label><input type="number" name="count" min="1" max="100" value="1" required></div>
          <div class="field"><label>For date</label><input type="date" name="work_date" value="${today}" required></div>
        </div>
        <div class="field" style="margin-top:12px"><label>Reason (required)</label><input name="reason" maxlength="300" required placeholder="Reason is required"></div>
        <p class="notice" id="effect"></p>
        <button class="btn" type="submit">Apply</button>
      </form>
    </div>
    <div class="card"><h2>Recent points</h2>${
      log.length
        ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Points</th><th>Source</th><th>Reason</th><th>By</th></tr></thead><tbody>${log
            .map(
              (p) => `<tr><td>${fmtDate(p.work_date)}</td><td>${esc(p.user_name)}</td><td>${kindBadge(p.kind, p.delta)}</td>
                <td>${esc(SOURCE[p.source] || p.source)}</td><td class="wrap">${esc(p.reason)}</td><td>${esc(p.created_by_name || 'System')}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="empty">No points yet.</p>'
    }</div>`;
  const form = $('#adjust');
  const rules = await api('/admin/settings');
  const update = () => {
    const n = Number(form.count.value) || 0;
    const sign = form.action.value === 'add' ? 1 : -1;
    const k = form.kind.value;
    const value = k === 'green' ? rules.green_value : k === 'red' ? rules.red_value : rules.black_value;
    const what = k === 'green' ? 'reward value' : 'deduction';
    $('#effect').innerHTML = `${sign > 0 ? '+' : '−'}<span class="num">${n}</span> ${KIND[k]} = <span class="num">${money(n * value, rules.currency)}</span> ${sign > 0 ? '' : 'less '}${what}`;
  };
  form.oninput = update;
  update();
  form.onsubmit = (e) => {
    e.preventDefault();
    const d = formData(form);
    const body = {
      user_id: Number(d.user_id),
      kind: d.kind,
      delta: (d.action === 'add' ? 1 : -1) * Number(d.count),
      reason: d.reason,
      work_date: d.work_date,
    };
    act(e.submitter, async () => {
      await api('/admin/points', { method: 'POST', body });
      route();
    }, 'Points updated');
  };
}

function requestFilter(active, base) {
  const opts = base === 'leaves' ? ['pending', 'approved', 'rejected', 'cancelled'] : ['pending', 'paid', 'rejected', 'cancelled'];
  return `<div class="btn-row">${['', ...opts]
    .map((s) => `<a class="btn small ${s === active ? '' : 'light'}" href="#/${base}${s ? `?status=${s}` : ''}">${s ? REQ[s][0] : 'All'}</a>`)
    .join('')}</div>`;
}

async function viewLeaves(params) {
  const status = params.get('status') || '';
  const list = await api(`/admin/leaves${status ? `?status=${status}` : ''}`);
  app.innerHTML = `<div class="card"><div class="card-head"><h2>Leave requests</h2>${requestFilter(status, 'leaves')}</div>
    <p class="muted small">When you approve leave, the system won't record black absences for those days (and removes any already recorded).</p>
    ${
      list.length
        ? `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>From</th><th>To</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead><tbody>${list
            .map(
              (l) => `<tr><td><strong>${esc(l.user_name)}</strong></td><td>${fmtDate(l.from_date)}</td><td>${fmtDate(l.to_date)}</td>
                <td class="wrap">${esc(l.reason) || '—'}</td><td>${badge(REQ, l.status)}</td>
                <td>${l.status === 'pending' ? `<div class="btn-row"><button class="btn small green" data-id="${l.id}" data-d="approve">✓ Approve</button>
                  <button class="btn small red" data-id="${l.id}" data-d="reject">✕ Reject</button></div>` : ''}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="empty">No leave requests.</p>'
    }</div>`;
  app.querySelectorAll('[data-d]').forEach((b) => {
    b.onclick = () => act(b, async () => {
      await api(`/admin/leaves/${b.dataset.id}/decision`, { method: 'POST', body: { decision: b.dataset.d } });
      await refreshPending();
      route();
    }, b.dataset.d === 'approve' ? 'Leave approved' : 'Leave rejected');
  });
}

async function viewRewards(params) {
  const status = params.get('status') || '';
  const [list, s] = await Promise.all([api(`/admin/rewards${status ? `?status=${status}` : ''}`), api('/admin/settings')]);
  app.innerHTML = `<div class="card"><div class="card-head"><h2>Reward requests</h2>${requestFilter(status, 'rewards')}</div>
    <p class="muted small">Points are reserved when the employee sends the request. Mark it paid after you transfer the money, or reject to return the points.</p>
    ${
      list.length
        ? `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Date</th><th>Points</th><th>Amount</th><th>Payout</th><th>Status</th><th>Action</th></tr></thead><tbody>${list
            .map(
              (r) => `<tr><td><strong>${esc(r.user_name)}</strong></td><td>${fmtDate(r.created_at)}</td><td class="num">${r.points}</td>
                <td class="num"><strong>${money(r.amount, s.currency)}</strong></td>
                <td>${METHODS[r.method]}<br><span class="muted num">${esc(r.payout_number || '')}</span></td><td>${badge(REQ, r.status)}</td>
                <td>${r.status === 'pending' ? `<div class="btn-row"><button class="btn small green" data-id="${r.id}" data-d="paid">✓ Mark paid</button>
                  <button class="btn small red" data-id="${r.id}" data-d="reject">✕ Reject</button></div>` : ''}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="empty">No reward requests.</p>'
    }</div>`;
  app.querySelectorAll('[data-d]').forEach((b) => {
    b.onclick = () => act(b, async () => {
      await api(`/admin/rewards/${b.dataset.id}/decision`, { method: 'POST', body: { decision: b.dataset.d } });
      await refreshPending();
      route();
    }, b.dataset.d === 'paid' ? 'Marked as paid' : 'Rejected, points returned');
  });
}

async function viewReport(params) {
  const month = params.get('month') || thisMonth();
  const [rep, s] = await Promise.all([api(`/admin/report?month=${month}`), api('/admin/settings')]);
  const total = rep.rows.reduce((a, r) => a + r.total_deduction, 0);
  app.innerHTML = `<div class="card">
    <div class="card-head"><h2>Monthly report</h2>
      <div class="btn-row"><input type="month" id="month" value="${month}" style="max-width:200px">
      <a class="btn light" href="/api/admin/report.csv?month=${month}">⬇ Export CSV</a></div></div>
    <p class="muted small">Red = ${money(s.red_value, s.currency)} each · Black = ${money(s.black_value, s.currency)} each. Total deductions this month: <strong class="num">${money(total, s.currency)}</strong></p>
    ${
      rep.rows.length
        ? `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Present</th><th>Early</th><th>On time</th><th>Late</th><th>Leave</th>
            <th>🟢 Green</th><th>🔴 Red</th><th>⚫ Black</th><th>Deduction</th></tr></thead><tbody>${rep.rows
              .map(
                (r) => `<tr><td><a href="#/staff?id=${r.user_id}&month=${month}"><strong>${esc(r.name)}</strong></a>${r.active ? '' : ' <span class="badge">Inactive</span>'}</td>
                  <td class="num">${r.days_present}</td><td class="num">${r.early}</td><td class="num">${r.on_time}</td><td class="num">${r.late}</td><td class="num">${r.leave_days}</td>
                  <td class="num">${r.green_month} <span class="muted small">(bal ${r.green_balance})</span></td>
                  <td class="num">${r.red}</td><td class="num">${r.black}</td>
                  <td class="num"><strong>${money(r.total_deduction, s.currency)}</strong></td></tr>`,
              )
              .join('')}</tbody></table></div>`
        : '<p class="empty">No employees.</p>'
    }</div>`;
  $('#month').onchange = (e) => (location.hash = `#/reports?month=${e.target.value}`);
}

async function viewSettings() {
  const s = await api('/admin/settings');
  const mapLink = s.office_lat != null ? `https://www.google.com/maps?q=${s.office_lat},${s.office_lng}` : '';
  app.innerHTML = `<form id="settings">
    <div class="card">
      <h2>Company</h2>
      <div class="form-grid">
        <div class="field"><label>Company name</label><input name="company_name" value="${esc(s.company_name)}" required></div>
        <div class="field"><label>Currency</label><input name="currency" value="${esc(s.currency)}" required></div>
        <div class="field"><label>Timezone</label><input name="timezone" value="${esc(s.timezone)}" required></div>
      </div>
    </div>
    <div class="card">
      <h2>Office location (GPS check-in)</h2>
      ${s.office_lat == null ? '<div class="notice amber">Location not set — staff can\'t check in until you set it.</div>' : ''}
      <div class="form-grid">
        <div class="field"><label>Latitude</label><input name="office_lat" value="${s.office_lat ?? ''}" inputmode="decimal"></div>
        <div class="field"><label>Longitude</label><input name="office_lng" value="${s.office_lng ?? ''}" inputmode="decimal"></div>
        <div class="field"><label>Allowed radius (m)</label><input type="number" name="radius_m" value="${s.radius_m}" min="10" required></div>
        <div class="field"><label>Max GPS uncertainty (m)</label><input type="number" name="max_accuracy_m" value="${s.max_accuracy_m}" min="5" required></div>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn light" type="button" id="use-loc">📍 Use my current location</button>
        ${mapLink ? `<a class="btn light" href="${mapLink}" target="_blank" rel="noopener">View on map</a>` : ''}
      </div>
    </div>
    <div class="card">
      <h2>Check-in times</h2>
      <div class="form-grid">
        <div class="field"><label>🟢 Early from</label><input type="time" name="early_start" value="${s.early_start}" required></div>
        <div class="field"><label>🟢 Early until</label><input type="time" name="early_end" value="${s.early_end}" required></div>
        <div class="field"><label>🔴 Late after</label><input type="time" name="late_after" value="${s.late_after}" required></div>
        <div class="field"><label>🔴 Very late after</label><input type="time" name="very_late_after" value="${s.very_late_after}" required></div>
        <div class="field"><label>⚫ Check-in closes</label><input type="time" name="close" value="${s.close}" required></div>
        <div class="field"><label>Red penalties for very late</label><input type="number" name="very_late_reds" value="${s.very_late_reds}" min="1" max="10" required></div>
      </div>
      <div class="field" style="margin-top:12px"><label>Work days (missing one without leave = automatic black)</label>
        <div class="checks">${DAYS.map((d, i) => `<label><input type="checkbox" name="wd" value="${i}" ${s.work_days.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
      </div>
    </div>
    <div class="card">
      <h2>Money rules</h2>
      <div class="form-grid">
        <div class="field"><label>🔴 Red penalty deduction</label><input type="number" name="red_value" value="${s.red_value}" min="0" required></div>
        <div class="field"><label>⚫ Black absence deduction</label><input type="number" name="black_value" value="${s.black_value}" min="0" required></div>
        <div class="field"><label>🟢 Green point reward value</label><input type="number" name="green_value" value="${s.green_value}" min="0" required></div>
        <div class="field"><label>Minimum points per reward request</label><input type="number" name="min_reward_points" value="${s.min_reward_points}" min="1" required></div>
      </div>
    </div>
    <button class="btn big" type="submit">Save settings</button>
  </form>`;
  const form = $('#settings');
  $('#use-loc').onclick = (e) =>
    act(e.currentTarget, async () => {
      const p = await getPosition();
      form.office_lat.value = p.lat.toFixed(6);
      form.office_lng.value = p.lng.toFixed(6);
      toast(`Location captured (±${Math.round(p.accuracy)} m). Click Save.`, 'success');
    });
  form.onsubmit = (e) => {
    e.preventDefault();
    const d = formData(form);
    delete d.wd;
    const body = {
      ...d,
      work_days: [...form.querySelectorAll('[name=wd]:checked')].map((c) => Number(c.value)),
      office_lat: d.office_lat === '' ? null : Number(d.office_lat),
      office_lng: d.office_lng === '' ? null : Number(d.office_lng),
    };
    for (const k of ['radius_m', 'max_accuracy_m', 'very_late_reds', 'red_value', 'black_value', 'green_value', 'min_reward_points']) {
      body[k] = Number(body[k]);
    }
    act(e.submitter, async () => {
      const saved = await api('/admin/settings', { method: 'PUT', body });
      $('#company-name').textContent = saved.company_name;
      route();
    }, 'Settings saved');
  };
}

start();
