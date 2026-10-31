'use strict';

/* =========================================================================
   Bahr Network — Attendance & staff management (vanilla JS SPA)
   ========================================================================= */

// ---------- Tiny helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const store = {
  get(k, d = null) { try { return localStorage.getItem(`bahr.${k}`) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`bahr.${k}`, v); } catch { /* private mode */ } },
};

const ICONS = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C9 3 12 8 12 8s3-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M8 16H3v5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  phoneLock: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  party: '<path d="M5.8 11.3 2 22l10.7-3.8"/><path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
  kanban: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
  team: '<circle cx="12" cy="8" r="3"/><circle cx="5" cy="10" r="2"/><circle cx="19" cy="10" r="2"/><path d="M7 21v-2a5 5 0 0 1 10 0v2M1 21v-1a3 3 0 0 1 4-2.8M23 21v-1a3 3 0 0 0-4-2.8"/>',
};
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// The Bahr Network mark (five joined "bubbles"), drawn in currentColor.
let markSeq = 0;
function logoMark(size = 32) {
  const id = `goo${++markSeq}`;
  return `<svg class="mark" viewBox="30 50 215 295" width="${size}" height="${Math.round(size * 1.37)}" aria-hidden="true">
    <defs><filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8"/>
      <feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 24 -11"/></filter></defs>
    <g fill="currentColor" stroke="currentColor" stroke-linecap="round" filter="url(#${id})">
      <path d="M100 92 Q132 104 156 146" fill="none" stroke-width="12"/><path d="M156 146 Q140 186 121 212" fill="none" stroke-width="13"/>
      <path d="M121 212 Q160 246 198 268" fill="none" stroke-width="14"/><path d="M198 268 Q140 280 70 302" fill="none" stroke-width="27"/>
      <circle cx="100" cy="90" r="30" stroke="none"/><circle cx="158" cy="148" r="37" stroke="none"/><circle cx="121" cy="212" r="31" stroke="none"/>
      <circle cx="200" cy="268" r="32" stroke="none"/><circle cx="70" cy="305" r="30" stroke="none"/>
    </g></svg>`;
}
const wordmark = () => `<span class="wm"><b>BAHR</b><i>NETWORK</i></span>`;

const PALETTE = ['lime', 'teal', 'pink', 'sky', 'amber', 'slate'];
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] || '')).toUpperCase();
}
function hue(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
const avatar = (name, size = '') => `<span class="avatar ${size} ${hue(name)}" title="${esc(name)}">${esc(initials(name))}</span>`;

// ---------- Labels ----------

const STATUS = {
  early: ['Early', 'lime'],
  on_time: ['On time', 'teal'],
  late: ['Late', 'pink'],
  very_late: ['Very late', 'pink'],
  off_day: ['Day off', 'slate'],
  leave: ['On leave', 'amber'],
  absent: ['Absent', 'dark'],
  waiting: ['Not yet', ''],
  remote: ['Remote', 'sky'],
  not_started: ['Starts later', ''],
  holiday: ['Holiday', 'sky'],
};
const KIND = { green: ['Green', 'lime'], red: ['Red', 'pink'], black: ['Black', 'dark'] };
const SOURCE = {
  early: 'Early check-in', late: 'Late check-in', absent: 'Absence', manual: 'Owner adjustment',
  redeem: 'Green → Red swap', reward: 'Reward request', reward_refund: 'Reward refund', kudos: 'Kudos bonus',
};
const REQ = {
  pending: ['Pending', 'amber'], approved: ['Approved', 'lime'], paid: ['Paid', 'lime'],
  rejected: ['Rejected', 'pink'], cancelled: ['Cancelled', 'slate'],
};
const METHODS = { instapay: 'InstaPay', vodafone_cash: 'Vodafone Cash', cash: 'Cash' };
const LEAVE_TYPES = { annual: ['🏖️', 'Annual leave'], sick: ['🤒', 'Sick leave'], unpaid: ['💼', 'Unpaid leave'] };
const ROLE_LABEL = { owner: 'Owner', lead: 'Team lead', employee: 'Employee' };
const KUDOS = {
  creative: ['💡', 'Creative Spark', 'lime'],
  teamwork: ['🤝', 'Team Player', 'teal'],
  extra_mile: ['🚀', 'Extra Mile', 'sky'],
  client_hero: ['🎯', 'Client Hero', 'pink'],
  good_vibes: ['😄', 'Good Vibes', 'amber'],
  mentor: ['🧠', 'Mentor', 'slate'],
};
const REACTIONS = ['🔥', '👏', '❤️', '😂', '🚀', '💯'];
const MOODS = { 1: ['😫', 'Drained'], 2: ['😕', 'Meh'], 3: ['😐', 'Okay'], 4: ['🙂', 'Good'], 5: ['🤩', 'Amazing'] };
const ANNOUNCE = { news: ['📰', 'News', 'sky'], celebration: ['🎉', 'Celebration', 'lime'], event: ['📅', 'Event', 'teal'], alert: ['⚠️', 'Heads up', 'amber'] };
const QUOTES = [
  'Great campaigns start with someone showing up early. ☀️', 'Your idea today could be a client\'s best month. 💡',
  'Done is better than perfect. Then make it perfect. 🛠️', 'Hooks first, everything else second. 🎣',
  'One more test, one more insight. 📈', 'Ask "why" three times before you open the brief. 🔍',
  'Small wins compound. Keep stacking them. 🧱', 'A good brief is half the creative. 📝',
  'Make it simple. Make it memorable. ✨', 'Every client call is a chance to wow. 📞',
  'Data tells you what. Creativity tells you why. 📊', 'Celebrate a teammate today: send a kudos! 🙌',
  'The first draft is just the warm-up. ✍️', 'Stay curious: great ideas come from everywhere. 🌍',
  'Ship it, learn, iterate. 🔁', 'Today\'s coffee, tomorrow\'s campaign. ☕', 'Big brands were built one post at a time. 🏗️',
  'If it doesn\'t stop the scroll, keep going. 🛑', 'Teamwork makes the creative work. 🤝', 'Be the reason the client says "wow". 🤩',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const chip = (map, key, dot = true) => {
  const [label, cls] = map[key] || [key, ''];
  return `<span class="chip ${cls}">${dot ? '<span class="dot"></span>' : ''}${esc(label)}</span>`;
};
const pointsChip = (kind, delta) =>
  `<span class="chip ${KIND[kind][1]}"><span class="num">${delta > 0 ? '+' : ''}${delta}</span> ${KIND[kind][0]}</span>`;

// ---------- Formatting ----------

function fmtTime(hhmm) {
  if (!hhmm) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
const toDate = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00Z`);
function fmtDate(d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!d) return '—';
  return toDate(d).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}
const fmtLong = (d) => fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtMonth = (m) => toDate(`${m}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
function relTime(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso);
}
const shortWhen = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}<br>${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};
const money = (n, cur = rules().currency) => `${Number(n || 0).toLocaleString('en-US')} ${esc(cur || 'EGP')}`;
const fmtHours = (min) => `${Math.floor(min / 60)}h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}m` : ''}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
const localISODate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const thisMonth = () => localISODate().slice(0, 7);
function eachDay(from, to) {
  const out = [];
  for (let d = toDate(from); d <= toDate(to) && out.length < 400; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// ---------- API & UI primitives ----------

// Short-lived cache for slow-changing GETs makes navigation feel instant; any write clears it.
const CACHEABLE = /^\/(people|leaderboard|announcements|admin\/settings|admin\/users|me\/achievements)/;
const apiCache = new Map();
async function api(path, { method = 'GET', body } = {}) {
  if (method === 'GET' && CACHEABLE.test(path)) {
    const hit = apiCache.get(path);
    if (hit && Date.now() - hit.at < 15000) return structuredClone(hit.data);
  } else if (method !== 'GET') {
    apiCache.clear();
  }
  const data = await apiFetch(path, { method, body });
  if (method === 'GET' && CACHEABLE.test(path)) apiCache.set(path, { at: Date.now(), data: structuredClone(data) });
  return data;
}
async function apiFetch(path, { method, body }) {
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
    err.code = data.code;
    throw err;
  }
  return data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 3600);
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());

// Runs an async action with a busy button and error toast.
async function act(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try {
    await fn();
    if (okMsg) toast(okMsg, 'success');
    return true;
  } catch (err) {
    if (err.status === 401 && me) return start();
    if (err.help) showLocationHelp(err);
    else toast(err.message, 'error');
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function modal({ title, sub = '', body, submit = 'Save', danger = false, onSubmit }) {
  const dlg = $('#modal');
  dlg.className = 'modal';
  dlg.innerHTML = `<form class="card" method="dialog">
      <div class="row between"><h2>${esc(title)}</h2><button class="icon-btn ghost" type="button" data-close aria-label="Close">${icon('x')}</button></div>
      ${sub ? `<p class="muted small" style="margin-bottom:14px">${sub}</p>` : '<div style="height:10px"></div>'}
      ${body}
      <div class="modal-actions">
        <button class="btn light" type="button" data-close>Cancel</button>
        <button class="btn ${danger ? 'red' : ''}" type="submit">${esc(submit)}</button>
      </div></form>`;
  const form = $('form', dlg);
  $$('[data-close]', dlg).forEach((b) => (b.onclick = () => dlg.close()));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const ok = await act(e.submitter, () => onSubmit(formData(form), form));
    if (ok) dlg.close();
  };
  if (!dlg.open) dlg.showModal();
  $('input:not([type=hidden]), select, textarea', form)?.focus();
}

const confirmBox = (title, text, onYes, { submit = 'Confirm', danger = true } = {}) =>
  modal({ title, sub: esc(text), body: '', submit, danger, onSubmit: onYes });

// ---------- Location ----------

const UA = navigator.userAgent;
const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/.test(UA);
const IN_APP = /FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|TikTok|; wv\)/.test(UA);
const IS_WINDOWS = /Windows/.test(UA);
const IS_MAC = /Macintosh/.test(UA) && !IS_IOS;
// Laptops have no GPS: the browser asks the OS, which must have location services switched on.
// Keyboard shortcut label: ⌘ on Mac, Ctrl elsewhere.
const shortcutHtml = (key = 'K') => `<kbd>${IS_MAC || /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'}</kbd><kbd>${key}</kbd>`;
const DESKTOP_OS_STEPS = IS_WINDOWS
  ? ['Open Windows Settings → Privacy & security → Location.', 'Turn ON "Location services" and "Let apps access your location" (and "Let desktop apps access your location").', 'Make sure Wi-Fi is ON (laptops locate themselves using nearby Wi-Fi), then try again.']
  : IS_MAC
    ? ['Open System Settings → Privacy & Security → Location Services.', 'Turn Location Services ON, and ON for your browser (Chrome / Safari).', 'Make sure Wi-Fi is ON, then try again.']
    : ['Turn on your computer\'s location services and Wi-Fi, then try again.'];

function locationError(kind) {
  const steps = {
    insecure: ['Location only works on a secure (https://) link.', 'Open the system using its https:// address.'],
    unsupported: ["This browser can't share location.", 'Open the link in Chrome or Safari.'],
    inapp: ["You're inside another app's browser (WhatsApp, Instagram…), which blocks location.", 'Tap ⋮ / Share → "Open in Chrome" or "Open in Safari", then try again.'],
    denied: IS_IOS
      ? ['Location is blocked for this site.', 'Open iPhone Settings → Privacy & Security → Location Services → turn it ON.', 'Then Settings → Safari (or Chrome) → Location → "While Using" / "Ask".', 'Back in the browser tap "aA" → Website Settings → Location → Allow, then reload.']
      : IS_ANDROID
        ? ['Location is blocked for this site.', 'Turn on Location from the quick-settings panel (swipe down).', 'In Chrome tap the 🔒 icon next to the address → Permissions → Location → Allow.', 'Reload the page and try again.']
        : ['Location is blocked for this site.', 'Click the 🔒 / ⚙️ icon at the left of the address bar → Location → Allow.', 'Reload the page and try again.', 'On a computer you can also set the office from the map instead.'],
    unavailable: IS_IOS || IS_ANDROID
      ? ["Your phone couldn't find its location.", 'Make sure Location / GPS is turned on (swipe down → Location).', 'Move near a window or outside, then try again.']
      : ["This computer couldn't find its location.", ...DESKTOP_OS_STEPS, 'Easiest option: check in from your phone, since phones have GPS.'],
    timeout: IS_IOS || IS_ANDROID
      ? ['Finding your location took too long.', 'Make sure Location / GPS is on, and for Android set Location → "Use precise location" ON.', 'Move near a window or outside and try again.']
      : ["Your computer didn't return a location in time.", ...DESKTOP_OS_STEPS, 'Easiest option: check in from your phone, since phones have GPS.'],
  }[kind];
  const err = new Error(steps[0]);
  err.help = steps.slice(1);
  err.kind = kind;
  return err;
}

function showLocationHelp(err) {
  if (!err.help) return toast(err.message, 'error');
  chime('error');
  modal({
    title: 'Location needed 📍',
    sub: esc(err.message),
    body: `<ol class="grid" style="gap:10px;padding-left:20px;margin:0">${err.help.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>`,
    submit: err.retry ? 'Try again' : 'Got it',
    onSubmit: async () => {
      if (err.retry) setTimeout(err.retry, 150);
    },
  });
}

// Asks for GPS (high accuracy) and network location (Wi-Fi/cell) at the same time and takes the
// first fix, then waits a few seconds for a more precise one. A fix from the last 2 minutes is
// accepted, so a recently-located device answers instantly.
function getPosition({ timeout = 30000 } = {}) {
  if (!window.isSecureContext) return Promise.reject(locationError('insecure'));
  if (!navigator.geolocation) return Promise.reject(locationError(IN_APP ? 'inapp' : 'unsupported'));
  const geo = navigator.geolocation;
  return new Promise((resolve, reject) => {
    let best = null;
    let lastErr = null;
    let done = false;
    let grace;
    const timers = [];
    const watchId = geo.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout });
    geo.getCurrentPosition(onPos, onErr, { enableHighAccuracy: false, maximumAge: 120000, timeout });
    timers.push(setTimeout(() => (best ? finish(resolve, best) : finish(reject, mapErr(lastErr))), timeout + 1500));
    function finish(fn, v) {
      if (done) return;
      done = true;
      geo.clearWatch(watchId);
      timers.forEach(clearTimeout);
      clearTimeout(grace);
      fn(v);
    }
    function onPos(p) {
      const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      if (!best || fix.accuracy < best.accuracy) best = fix;
      if (best.accuracy <= 40) finish(resolve, best);
      else grace ||= setTimeout(() => finish(resolve, best), 5000);
    }
    function onErr(e) {
      lastErr = e;
      if (e.code === 1) finish(reject, mapErr(e));
    }
    function mapErr(e) {
      return locationError(!e || e.code === 3 ? 'timeout' : e.code === 1 ? (IN_APP ? 'inapp' : 'denied') : 'unavailable');
    }
  });
}

// Leaflet (OpenStreetMap) is loaded only when a map is shown.
let leafletReady;
function loadLeaflet() {
  leafletReady ||= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => { leafletReady = null; reject(new Error('Map failed to load. Check your connection.')); };
    document.head.append(js);
  });
  return leafletReady;
}

const empty = (ico, text, extra = '') => `<div class="empty"><div class="ico">${icon(ico)}</div><div>${text}</div>${extra}</div>`;
const skeleton = () =>
  `<div class="dash"><div class="stack-col"><div class="skeleton" style="height:220px"></div><div class="skeleton" style="height:180px"></div></div>
   <div class="skeleton" style="height:420px"></div></div>`;

// ---------- Motion & delight ----------

// Device "reduce motion" setting, unless the user picked "Animations: Always on" in Account.
let reduceMotion = store.get('motion') !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function setMotion(mode) {
  store.set('motion', mode);
  document.documentElement.classList.toggle('motion-on', mode === 'on');
  reduceMotion = mode !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
const soundOn = () => store.get('sound', 'on') === 'on';

// Lightweight canvas confetti in the brand palette.
function confetti({ count = 140, spread = 1, origin = { x: 0.5, y: 0.35 } } = {}) {
  if (reduceMotion) return;
  let cv = $('#fx');
  if (!cv) {
    cv = document.createElement('canvas');
    cv.id = 'fx';
    document.body.append(cv);
  }
  const ctx = cv.getContext('2d');
  const W = (cv.width = innerWidth * devicePixelRatio);
  const H = (cv.height = innerHeight * devicePixelRatio);
  const colors = ['#dcf29b', '#a7e1d5', '#f6bcc3', '#c4e0f8', '#fbe0a6', '#0f1f1c', '#22a35a'];
  const parts = Array.from({ length: count }, () => ({
    x: origin.x * W, y: origin.y * H,
    vx: (Math.random() - 0.5) * 26 * spread * devicePixelRatio, vy: (Math.random() * -18 - 6) * devicePixelRatio,
    s: (Math.random() * 8 + 5) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0], shape: Math.random() < 0.5,
  }));
  let frame = 0;
  (function tick() {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.55 * devicePixelRatio;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = Math.max(0, 1 - frame / 160);
      if (p.shape) ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      else { ctx.beginPath(); ctx.arc(0, 0, p.s / 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (++frame < 170) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, W, H);
  })();
}

// Little emoji fireworks from an element (reactions, mood, kudos).
function burst(emoji, el, n = 7) {
  if (reduceMotion || !el) return;
  const r = el.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const b = document.createElement('span');
    b.className = 'burst';
    b.textContent = emoji;
    b.style.left = `${r.left + r.width / 2 - 10}px`;
    b.style.top = `${r.top + r.height / 2 - 12}px`;
    b.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
    b.style.setProperty('--dy', `${-60 - Math.random() * 110}px`);
    b.style.setProperty('--r', `${(Math.random() - 0.5) * 80}deg`);
    document.body.append(b);
    setTimeout(() => b.remove(), 1100);
  }
}

// Soft synthesized chimes (no audio files). Off switch in Account.
let audioCtx;
function chime(kind = 'success') {
  if (!soundOn()) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = { success: [523.25, 659.25, 783.99], big: [523.25, 659.25, 783.99, 1046.5], soft: [659.25, 880], error: [330, 262] }[kind];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = audioCtx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.55);
    });
  } catch { /* audio unavailable */ }
}
const haptic = (p = 30) => navigator.vibrate?.(p);

// Celebrations queue so two never stack on top of each other.
const celebQueue = [];
let celebOpen = false;
function celebrate(opts) {
  celebQueue.push(opts);
  if (!celebOpen) nextCelebration();
}
function nextCelebration() {
  const opts = celebQueue.shift();
  celebOpen = !!opts;
  if (opts) showCelebration(opts);
}
function showCelebration({ emoji = '🎉', title, sub = '', confettiCount = 160, sound = 'big' }) {
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.innerHTML = `<div class="box"><span class="big-emoji">${emoji}</span><h2>${esc(title)}</h2><p class="muted">${sub}</p>
    <button class="btn mt" type="button">Let's go!</button></div>`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('out');
    setTimeout(() => {
      el.remove();
      nextCelebration();
    }, 300);
  };
  el.onclick = close;
  document.body.append(el);
  confetti({ count: confettiCount });
  chime(sound);
  haptic([30, 40, 60]);
  setTimeout(close, 4200);
}

// Count numbers up from zero, keeping any prefix/suffix ("91%", "3,000 EGP").
function countUp(root = document) {
  if (reduceMotion) return;
  $$('.t-big, .t-num, .kpi .value, .ring b, [data-count]', root).forEach((el) => {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.textContent));
    if (!node) return;
    const m = node.textContent.match(/^(\D*?)(-?[\d,]+(?:\.\d+)?)(.*)$/s);
    if (!m) return;
    const target = Number(m[2].replace(/,/g, ''));
    if (!Number.isFinite(target) || Math.abs(target) < 2) return;
    const dec = (m[2].split('.')[1] || '').length;
    const t0 = performance.now();
    const dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const v = target * (1 - Math.pow(1 - k, 3));
      node.textContent = `${m[1]}${v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${m[3]}`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// Staggered entrance for whatever was just rendered.
function animateIn(root = $('#app')) {
  if (reduceMotion || !root) return;
  let i = 0;
  $$('.card, .tile, .list-item, .feed-item, .badge-card, .announce, .bars .stackbar, .battle .row-b', root).forEach((el) => {
    if (el.closest('.tile') && el !== el.closest('.tile')) return;
    el.style.setProperty('--i', Math.min(i++, 18));
    if (!el.classList.contains('stackbar')) el.classList.add('anim-in');
  });
  countUp(root);
}

// Material-style ripple on any button-like element.
document.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.btn, .icon-btn, .chip, .seg button, .seg a, .nav a, .bottom-nav a, .reacts button');
  if (!t || reduceMotion) return;
  const r = t.getBoundingClientRect();
  const size = Math.max(r.width, r.height);
  const rp = document.createElement('span');
  rp.className = 'ripple';
  rp.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  t.append(rp);
  setTimeout(() => rp.remove(), 650);
});

const quoteOfDay = () => QUOTES[Math.floor(Date.now() / 864e5) % QUOTES.length];

// Upcoming birthdays and work anniversaries in the next `days` days.
function upcomingCelebrations(people, today, days = 7) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = toDate(today);
    d.setUTCDate(d.getUTCDate() + i);
    const md = d.toISOString().slice(5, 10);
    const y = d.getUTCFullYear();
    for (const p of people) {
      if (p.birthday === md) out.push({ p, kind: 'birthday', inDays: i, date: d.toISOString().slice(0, 10) });
      const years = p.start_date ? y - Number(p.start_date.slice(0, 4)) : 0;
      if (p.start_date && p.start_date.slice(5, 10) === md && years >= 1) out.push({ p, kind: 'anniversary', years, inDays: i, date: d.toISOString().slice(0, 10) });
    }
  }
  return out;
}
function celebrationsHtml(list) {
  if (!list.length) return empty('gift', 'No birthdays or anniversaries this week');
  return `<div class="list">${list
    .map((c) => `<div class="list-item">${avatar(c.p.name)}<div class="grow"><strong>${esc(c.p.name)}</strong>
      <span>${c.kind === 'birthday' ? '🎂 Birthday' : `🏆 ${c.years} year${c.years === 1 ? '' : 's'} at the agency`} · ${c.inDays === 0 ? '<b>Today!</b>' : c.inDays === 1 ? 'Tomorrow' : fmtDate(c.date)}</span></div>
      <button class="btn sm ${c.inDays === 0 ? 'lime' : 'light'}" data-kudos-to="${c.p.id}" data-kudos-cat="good_vibes">${c.inDays === 0 ? '🎉 Celebrate' : 'Wish'}</button></div>`)
    .join('')}</div>`;
}

function levelCard(a) {
  const L = a.level;
  const fill = L.to ? pct(L.xp - L.from, L.to - L.from) : 100;
  const next = a.badges.filter((b) => !b.unlocked).sort((x, y) => y.progress / y.target - x.progress / x.target)[0];
  return `<div class="card">
    <div class="card-head"><h2>Level</h2><span class="level-chip"><b>${L.level}</b>${esc(L.name)}</span></div>
    <div class="row between small"><span class="strong num">${L.xp.toLocaleString('en-US')} XP</span><span class="muted">${L.to ? `${(L.to - L.xp).toLocaleString('en-US')} XP to ${esc(L.next_name)}` : 'Max level 👑'}</span></div>
    <div class="xp-bar" style="margin-top:8px"><i style="width:${Math.max(3, fill)}%"></i></div>
    <div class="row wrap mt" style="gap:6px">${a.badges.filter((b) => b.unlocked).map((b) => `<span class="chip lime" title="${esc(b.desc)}">${b.emoji} ${esc(b.name)}</span>`).join('') || '<span class="muted small">No badges yet. Your first one is close!</span>'}</div>
    ${next ? `<div class="notice sky mt"><span style="font-size:1.4rem">${next.emoji}</span><span>Next badge: <strong>${esc(next.name)}</strong>. ${esc(next.desc)} (${next.progress}/${next.target})</span></div>` : ''}
  </div>`;
}

function badgesGrid(badges) {
  return `<div class="badges">${badges
    .map((b) => `<div class="badge-card ${b.unlocked ? 'unlocked' : 'locked'}" title="${esc(b.desc)}"><span class="em">${b.emoji}</span><strong>${esc(b.name)}</strong>
      <small>${esc(b.desc)}</small>${b.unlocked ? '' : `<div class="mini"><i style="width:${pct(b.progress, b.target)}%"></i></div>`}</div>`)
    .join('')}</div>`;
}

// Fire celebrations for newly unlocked badges / level-ups since the last visit.
function checkMilestones(a) {
  const prevLevel = Number(store.get(`lvl.${me.id}`, 0));
  const prevBadges = new Set(JSON.parse(store.get(`bdg.${me.id}`, '[]')));
  const nowBadges = a.badges.filter((b) => b.unlocked).map((b) => b.key);
  store.set(`lvl.${me.id}`, a.level.level);
  store.set(`bdg.${me.id}`, JSON.stringify(nowBadges));
  if (!prevLevel) return; // first visit: just remember
  const fresh = a.badges.filter((b) => b.unlocked && !prevBadges.has(b.key));
  if (a.level.level > prevLevel) {
    setTimeout(() => celebrate({ emoji: '🆙', title: `Level up: ${a.level.name}!`, sub: `You reached level ${a.level.level}. Keep it going!` }), 600);
  } else if (fresh.length) {
    setTimeout(() => celebrate({ emoji: fresh[0].emoji, title: `Badge unlocked: ${fresh[0].name}`, sub: esc(fresh[0].desc) }), 600);
  }
}

// ---------- App (PWA): install, push notifications, badge ----------

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('App installed! Open Bahr from your home screen 🎉', 'success');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  // A push arrived while the app is open: refresh badges and the current page's live data.
  navigator.serviceWorker.addEventListener('message', async (e) => {
    if (e.data?.type !== 'push' || !me) return;
    await refreshCounts();
    renderShell(parseHash().path);
    $('#bell-btn').classList.add('shake');
    setTimeout(() => $('#bell-btn').classList.remove('shake'), 900);
  });
}

function canInstall() {
  if (isStandalone()) return false;
  return !!installPrompt || IS_IOS;
}

async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    if (outcome === 'accepted') confetti({ count: 80 });
    return;
  }
  const safari = !/CriOS|FxiOS|EdgiOS/.test(UA);
  modal({
    title: 'Install Bahr on your iPhone 📲',
    sub: 'It takes 10 seconds and works like a normal app, including notifications.',
    body: `<ol class="grid" style="gap:12px;padding-left:20px;margin:0">
      <li>Tap the <strong>Share</strong> button <span class="chip">⬆️</span> ${safari ? 'at the bottom of Safari' : 'in the address bar'}.</li>
      <li>Scroll and tap <strong>Add to Home Screen</strong> <span class="chip">➕</span>.</li>
      <li>Tap <strong>Add</strong>, then open <strong>Bahr</strong> from your home screen.</li>
      <li>Inside the app, turn on notifications from <strong>Account</strong>.</li></ol>`,
    submit: 'Got it',
    onSubmit: async () => {},
  });
}

function pushSupport() {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) {
    return IS_IOS && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api('/push/key');
  let sub = await reg.pushManager.getSubscription();
  const key = b64ToBytes(publicKey);
  const sameKey = sub && sub.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).every((v, i) => v === key[i]);
  if (sub && !sameKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
  return sub;
}

async function enablePush() {
  const state = pushSupport();
  if (state === 'needs-install') {
    const err = new Error('On iPhone, notifications work once the app is on your Home Screen.');
    err.help = ['Install the app first (Share → Add to Home Screen).', 'Open Bahr from your home screen.', 'Go to Account → turn on notifications.'];
    throw err;
  }
  if (state === 'unsupported') throw new Error('This browser does not support notifications. Try Chrome or Safari.');
  const perm = state === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') {
    const err = new Error('Notifications are blocked for this site.');
    err.help = IS_IOS
      ? ['Open iPhone Settings → Notifications → Bahr → Allow Notifications.', 'Come back to the app and try again.']
      : IS_ANDROID
        ? ['Tap the 🔒 icon next to the address (or long-press the app icon → App info).', 'Notifications → Allow.', 'Come back and try again.']
        : ['Click the 🔒 icon at the left of the address bar → Notifications → Allow.', 'Reload the page and try again.'];
    throw err;
  }
  await subscribePush();
  store.set('push', 'on');
}

async function disablePush() {
  const reg = await navigator.serviceWorker?.ready;
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
  store.set('push', 'off');
}

// Keep the server's copy of this device's subscription in sync (e.g. after signing in).
async function syncPush() {
  try {
    if (pushSupport() === 'granted' && store.get('push', 'on') !== 'off') await subscribePush();
  } catch { /* best effort */ }
}

function setBadge(n) {
  try {
    if (n) navigator.setAppBadge?.(n);
    else navigator.clearAppBadge?.();
  } catch { /* unsupported */ }
}

// "Get the app" + "Turn on notifications" prompts shown on the home pages (dismissible).
function appPromptsHtml() {
  const out = [];
  if (canInstall() && store.get('hide-install') !== '1') {
    out.push(`<div class="announce sky" data-prompt="install"><span class="em float">📲</span>
      <div style="flex:1;min-width:0"><h3>Get the Bahr app</h3><p>Install it on your ${IS_IOS ? 'iPhone' : IS_ANDROID ? 'phone' : 'device'} for one-tap check-in and notifications.</p></div>
      <div class="row" style="gap:6px"><button class="btn sm" data-install>Install</button><button class="icon-btn xs ghost" data-hide="install" aria-label="Dismiss">${icon('x')}</button></div></div>`);
  }
  const ps = pushSupport();
  if ((ps === 'default' || (ps === 'granted' && store.get('push') === 'off')) && store.get('hide-push') !== '1') {
    out.push(`<div class="announce lime" data-prompt="push"><span class="em float">🔔</span>
      <div style="flex:1;min-width:0"><h3>Turn on notifications</h3><p>${me.role === 'owner' ? 'Get notified about new requests and blocked sign-ins.' : 'Morning reminders, kudos from teammates and request updates.'}</p></div>
      <div class="row" style="gap:6px"><button class="btn sm" data-enable-push>Turn on</button><button class="icon-btn xs ghost" data-hide="push" aria-label="Dismiss">${icon('x')}</button></div></div>`);
  }
  return out.length ? `<div class="grid app-prompts" style="gap:10px;margin-bottom:16px">${out.join('')}</div>` : '';
}

document.addEventListener('click', (e) => {
  const inst = e.target.closest('[data-install]');
  if (inst) return installApp();
  const en = e.target.closest('[data-enable-push]');
  if (en) {
    return act(en, async () => {
      await enablePush();
      en.closest('[data-prompt]')?.remove();
      confetti({ count: 70 });
      await api('/push/test', { method: 'POST', body: {} }).catch(() => {});
    }, 'Notifications are on 🔔');
  }
  const hide = e.target.closest('[data-hide]');
  if (hide) {
    store.set(`hide-${hide.dataset.hide}`, '1');
    hide.closest('[data-prompt]')?.remove();
  }
});

// Coming back to the app after a while: refresh live pages (not forms being edited).
let lastActive = Date.now();
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') {
    lastActive = Date.now();
    return;
  }
  if (!me || Date.now() - lastActive < 60000) return;
  if ($('#modal').open || $('#palette').open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  await refreshCounts();
  if (['', 'wall', 'leaderboard', 'people', 'profile'].includes(parseHash().path)) route();
  else renderShell(parseHash().path);
});

window.addEventListener('online', () => {
  if (!me) start();
  else toast('Back online ✓', 'success');
});
window.addEventListener('offline', () => toast("You're offline. Changes won't save until you reconnect.", 'error'));

// ---------- State ----------

let me = null;
let company = 'Bahr Network';
let cachedRules = { currency: 'EGP' };
const rules = () => cachedRules;
let pending = { leaves: 0, rewards: 0 };
let pageTimers = [];
let notifItems = [];

function every(ms, fn) {
  pageTimers.push(setInterval(() => document.visibilityState === 'visible' && fn(), ms));
}

// ---------- Theme ----------

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
// Switches theme with a circular reveal growing from the tapped control (View Transitions API),
// or a smooth colour cross-fade where that API isn't available.
function setTheme(t, from = null) {
  const root = document.documentElement;
  const wasDark = isDark();
  const apply = () => {
    if (t === 'system') delete root.dataset.theme;
    else root.dataset.theme = t;
    store.set('theme', t);
    paintThemeButtons();
    $$('[data-theme-btn] svg, #theme-btn svg').forEach((svg) => svg.classList.add('spin-in'));
  };
  const willBeDark = t === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : t === 'dark';
  if (willBeDark === wasDark) return apply();
  // Reduced motion: a gentle colour cross-fade instead of the moving circle.
  if (reduceMotion) {
    root.classList.add('theme-fade');
    apply();
    setTimeout(() => root.classList.remove('theme-fade'), 700);
    return;
  }

  const rect = from?.getBoundingClientRect?.();
  const x = rect ? rect.left + rect.width / 2 : innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : innerHeight / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

  if (!document.startViewTransition) {
    root.classList.add('theme-fade');
    apply();
    setTimeout(() => root.classList.remove('theme-fade'), 600);
    return;
  }
  let vt;
  root.classList.add('theme-switching');
  try {
    vt = document.startViewTransition(apply);
  } catch {
    root.classList.remove('theme-switching');
    return apply();
  }
  vt.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => {});
  vt.finished.finally(() => root.classList.remove('theme-switching'));
}
const toggleTheme = (e) => setTheme(isDark() ? 'light' : 'dark', e?.currentTarget || e?.target?.closest?.('button') || null);
function paintThemeButtons() {
  $$('[data-theme-btn]').forEach((b) => (b.innerHTML = icon(isDark() ? 'sun' : 'moon')));
  $('#theme-btn').innerHTML = icon(isDark() ? 'sun' : 'moon');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeButtons);

// ---------- Routes ----------

const EMPLOYEE_NAV = [
  { group: 'Overview' },
  { key: '', label: 'My Activity', icon: 'activity', view: () => viewEmployeeHome() },
  { key: 'tasks', label: 'Tasks', icon: 'kanban', view: (p) => viewTasks(p), count: () => taskBadge() },
  { key: 'profile', label: 'My Profile', icon: 'user', view: () => viewPerson(new URLSearchParams(`id=${me.id}`)) },
  { key: 'history', label: 'My History', icon: 'calendar', view: (p) => viewHistory(p) },
  { group: 'Team' },
  { key: 'wall', label: 'Team Wall', icon: 'heart', view: (p) => viewWall(p) },
  { key: 'people', label: 'People', icon: 'users', view: (p) => viewPeople(p) },
  { group: 'Requests' },
  { key: 'leaves', label: 'Leave', icon: 'flag', view: () => viewMyLeaves() },
  { key: 'corrections', label: 'Fix Attendance', icon: 'wrench', view: () => viewMyCorrections() },
  { key: 'rewards', label: 'Rewards', icon: 'gift', view: () => viewMyRewards() },
  { key: 'payslip', label: 'Payslip', icon: 'receipt', view: (p) => viewPayslip(p) },
  { group: 'Fun' },
  { key: 'leaderboard', label: 'Leaderboard', icon: 'trophy', view: (p) => viewLeaderboard(p) },
  { key: 'account', label: 'Account', icon: 'user', view: () => viewAccount(), hidden: true },
  { key: 'person', label: 'Profile', icon: 'user', view: (p) => viewPerson(p), hidden: true },
];
const OWNER_NAV = [
  { group: 'Overview' },
  { key: '', label: 'Dashboard', icon: 'home', view: (p) => viewOwnerDashboard(p) },
  { key: 'tasks', label: 'Tasks', icon: 'kanban', view: (p) => viewTasks(p), count: () => taskBadge() },
  { key: 'reports', label: 'Monthly Report', icon: 'chart', view: (p) => viewReport(p) },
  { key: 'payroll', label: 'Payroll', icon: 'receipt', view: (p) => viewPayroll(p) },
  { group: 'People' },
  { key: 'employees', label: 'Staff', icon: 'users', view: (p) => viewStaff(p) },
  { key: 'points', label: 'Points', icon: 'star', view: () => viewPoints() },
  { group: 'Culture' },
  { key: 'wall', label: 'Team Wall', icon: 'heart', view: (p) => viewWall(p) },
  { key: 'leaderboard', label: 'Leaderboard', icon: 'trophy', view: (p) => viewLeaderboard(p) },
  { group: 'Requests' },
  { key: 'leaves', label: 'Leave Requests', icon: 'flag', view: (p) => viewLeaveRequests(p), count: () => pending.leaves },
  { key: 'rewards', label: 'Reward Requests', icon: 'gift', view: (p) => viewRewardRequests(p), count: () => pending.rewards },
  { key: 'corrections', label: 'Attendance Fixes', icon: 'wrench', view: (p) => viewCorrectionRequests(p), count: () => pending.corrections || 0 },
  { group: 'System' },
  { key: 'holidays', label: 'Holidays', icon: 'party', view: (p) => viewHolidays(p) },
  { key: 'audit', label: 'Activity Log', icon: 'list', view: () => viewAudit() },
  { key: 'settings', label: 'Settings', icon: 'settings', view: () => viewSettings() },
  { key: 'payslip', label: 'Payslip', icon: 'receipt', view: (p) => viewPayslip(p), hidden: true },
  { key: 'account', label: 'Account', icon: 'user', view: () => viewAccount(), hidden: true },
  { key: 'staff', label: 'Staff profile', icon: 'user', view: (p) => viewStaffProfile(p), hidden: true },
  { key: 'person', label: 'Profile', icon: 'user', view: (p) => viewPerson(p), hidden: true },
];
// Team leads: everything an employee has, plus their department's board and approvals.
const LEAD_NAV = (() => {
  const i = EMPLOYEE_NAV.findIndex((n) => n.group === 'Team');
  return [
    ...EMPLOYEE_NAV.slice(0, i),
    { group: 'My team' },
    { key: 'team', label: 'Team Board', icon: 'team', view: (p) => viewTeam(p), count: () => (pending.leaves || 0) + (pending.corrections || 0) },
    { key: 'team-leaves', label: 'Team Leave', icon: 'flag', view: (p) => viewLeaveRequests(p, 'team-leaves'), count: () => pending.leaves || 0 },
    { key: 'team-fixes', label: 'Team Fixes', icon: 'wrench', view: (p) => viewCorrectionRequests(p, 'team-fixes'), count: () => pending.corrections || 0 },
    { key: 'member', label: 'Team member', icon: 'user', view: (p) => viewMember(p), hidden: true },
    ...EMPLOYEE_NAV.slice(i),
  ];
})();
// Phones/tablets: four main tabs + "More" (everything else lives in a bottom sheet).
const BOTTOM_LABEL = { '': 'Home', history: 'History', leaves: 'Leave', rewards: 'Rewards', leaderboard: 'Ranking', employees: 'Staff', reports: 'Report', wall: 'Wall', profile: 'Me', team: 'Team', tasks: 'Tasks' };
const BOTTOM = {
  employee: ['', 'tasks', 'leaves', 'wall'],
  lead: ['', 'tasks', 'team', 'leaves'],
  owner: ['', 'tasks', 'employees', 'leaves'],
};
// Tasks needing attention: open tasks assigned to me, new ones to assign (leads) and work waiting for my review.
const taskBadge = () => (taskMeta ? taskMeta.counts.mine + (me.role === 'lead' ? taskMeta.counts.inbox : 0) + taskMeta.counts.to_review : 0);

const navItems = () => (me.role === 'owner' ? OWNER_NAV : me.role === 'lead' ? LEAD_NAV : EMPLOYEE_NAV);
const roleLine = (u) => (u.role === 'owner' ? 'Owner' : u.role === 'lead' ? `Team lead${u.department ? ` · ${esc(u.department)}` : ''}` : esc(u.job_title || 'Staff'));
const routeFor = (key) => navItems().find((n) => n.view && n.key === key);

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { path, params: new URLSearchParams(query) };
}
const go = (hash) => (location.hash = hash);

// ---------- Shell ----------

function renderShell(active = parseHash().path) {
  $('#brand').innerHTML = `${logoMark(26)}${wordmark()}`;
  $('#collapse-btn').innerHTML = icon('panel');
  $('#menu-btn').innerHTML = icon('menu');
  $('.search-ico').innerHTML = icon('search');
  $('#search-kbd').innerHTML = shortcutHtml();
  $('#bell-btn').innerHTML = `${icon('bell')}${notifCount() ? `<span class="badge-dot">${notifCount()}</span>` : ''}`;
  setBadge(notifCount());
  paintThemeButtons();

  $('#nav').innerHTML = navItems()
    .filter((n) => !n.hidden)
    .map((n) => {
      if (n.group) return `<div class="nav-group">${esc(n.group)}</div>`;
      const c = n.count ? n.count() : 0;
      return `<a href="#/${n.key}" class="${n.key === active ? 'active' : ''}" data-key="${n.key}">
        <span class="ico">${icon(n.icon)}</span><span class="label">${esc(n.label)}</span>
        ${c ? `<span class="count">${c}</span><span class="dot-count"></span>` : ''}</a>`;
    })
    .join('');

  $('#util-row').innerHTML = `
    <button class="icon-btn sm" type="button" data-go="#/account" aria-label="Account">${icon('user')}</button>
    <button class="icon-btn sm" type="button" data-palette aria-label="Search">${icon('search')}</button>
    <button class="icon-btn sm" type="button" data-theme-btn aria-label="Toggle theme">${icon(isDark() ? 'sun' : 'moon')}</button>
    <button class="icon-btn sm" type="button" data-logout aria-label="Log out">${icon('logout')}</button>`;
  $('#user-card').innerHTML = `${avatar(me.name)}
    <div class="who"><strong>${esc(me.name)}</strong><span>${roleLine(me)} · @${esc(me.username)}</span></div>
    <button class="icon-btn xs ghost" type="button" data-go="#/account" aria-label="Account">${icon('more')}</button>`;

  const bottom = BOTTOM[me.role].map((k) => routeFor(k));
  const inMore = !BOTTOM[me.role].includes(active);
  const moreCount = navItems().filter((n) => n.count && !BOTTOM[me.role].includes(n.key)).reduce((a, n) => a + n.count(), 0);
  $('#bottom-nav').className = 'bottom-nav on';
  $('#bottom-nav').innerHTML = `${bottom
    .map((n) => {
      const c = n.count ? n.count() : 0;
      return `<a href="#/${n.key}" class="${n.key === active ? 'active' : ''}">${icon(n.icon)}<span>${BOTTOM_LABEL[n.key]}</span>${c ? `<i class="nav-badge">${c}</i>` : ''}</a>`;
    })
    .join('')}<a href="#" data-more class="${inMore ? 'active' : ''}">${icon('menu')}<span>More</span>${moreCount ? `<i class="nav-badge">${moreCount}</i>` : ''}</a>`;
}

// "More" sheet: every page not in the bottom bar, plus account, search, theme and log out.
function openMore() {
  const dlg = $('#more');
  const active = parseHash().path;
  const items = navItems().filter((n) => n.view && !n.hidden && !BOTTOM[me.role].includes(n.key));
  dlg.innerHTML = `<div class="card">
    <div class="row" style="gap:12px;margin-bottom:16px">${avatar(me.name, 'lg')}
      <div style="flex:1;min-width:0"><strong style="font-size:1.05rem">${esc(me.name)}</strong>
        <div class="muted small">${roleLine(me)} · @${esc(me.username)}</div></div>
      <button class="icon-btn ghost" type="button" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="more-grid">${items
      .map((n) => {
        const c = n.count ? n.count() : 0;
        return `<a href="#/${n.key}" class="more-item ${n.key === active ? 'active' : ''}"><span class="ico">${icon(n.icon)}${c ? `<i class="nav-badge">${c}</i>` : ''}</span><span>${esc(n.label)}</span></a>`;
      })
      .join('')}</div>
    <div class="list mt">
      <a class="list-item more-row" href="#/account">${icon('user')}<div class="grow"><strong>Account</strong><span>Profile, notifications, password</span></div>${icon('arrow')}</a>
      <button class="list-item more-row" type="button" data-more-act="search">${icon('search')}<div class="grow"><strong>Search</strong><span>Pages, people and actions</span></div></button>
      <button class="list-item more-row" type="button" data-more-act="theme">${icon(isDark() ? 'sun' : 'moon')}<div class="grow"><strong>${isDark() ? 'Light mode' : 'Dark mode'}</strong><span>Switch appearance</span></div></button>
      ${canInstall() ? `<button class="list-item more-row" type="button" data-more-act="install">📲<div class="grow"><strong>Install the app</strong><span>Add Bahr to your home screen</span></div></button>` : ''}
      <button class="list-item more-row" type="button" data-more-act="logout" style="color:var(--red)">${icon('logout')}<div class="grow"><strong>Log out</strong></div></button>
    </div></div>`;
  $('[data-close]', dlg).onclick = () => dlg.close();
  // Navigate explicitly: closing the dialog first would otherwise cancel the link's own navigation.
  $$('a[href^="#"]', dlg).forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    dlg.close();
    const target = a.getAttribute('href');
    if (location.hash === target) route();
    else location.hash = target;
  }));
  $$('[data-more-act]', dlg).forEach((b) => (b.onclick = () => {
    dlg.close();
    ({ search: openPalette, theme: () => setTheme(isDark() ? 'light' : 'dark', $('[data-more]')), install: installApp, logout })[b.dataset.moreAct]();
  }));
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  dlg.showModal();
  haptic(10);
}

function renderOnline(rows) {
  const el = $('#online');
  if (!rows) return (el.innerHTML = '');
  const present = rows.filter((r) => r.check_in_time);
  el.innerHTML = present.length
    ? `<span class="label">Checked in <span class="muted">(${present.length})</span></span>
       <span class="stack">${present.slice(0, 4).map((r) => avatar(r.name, 'sm')).join('')}${present.length > 4 ? `<span class="avatar sm slate">+${present.length - 4}</span>` : ''}</span>`
    : '';
}

document.addEventListener('click', (e) => {
  const m = e.target.closest('[data-more]');
  if (m) {
    e.preventDefault();
    return openMore();
  }
  const k = e.target.closest('[data-kudos-to]');
  if (k) return kudosModal(Number(k.dataset.kudosTo) || null, k.dataset.kudosCat);
  const t = e.target.closest('[data-go],[data-palette],[data-theme-btn],[data-logout]');
  if (!t) return;
  if (t.dataset.go) go(t.dataset.go);
  else if ('palette' in t.dataset) openPalette();
  else if ('themeBtn' in t.dataset) setTheme(isDark() ? 'light' : 'dark', t);
  else if ('logout' in t.dataset) logout();
});
$('#theme-btn').onclick = toggleTheme;
$('#search-btn').onclick = () => openPalette();
$('#collapse-btn').onclick = () => {
  const c = document.documentElement.classList.toggle('sidebar-collapsed');
  store.set('sidebar', c ? 'collapsed' : 'open');
};
$('#menu-btn').onclick = () => $('#shell').classList.add('menu-open');
$('#scrim').onclick = () => $('#shell').classList.remove('menu-open');
$('#bell-btn').onclick = (e) => {
  e.stopPropagation();
  toggleNotifications();
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('.pop-wrap')) $('#notif').hidden = true;
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (me) openPalette();
  } else if (e.key === '/' && me && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('#palette').open) {
    e.preventDefault();
    openPalette();
  }
});

async function logout() {
  try {
    const sub = await (await navigator.serviceWorker?.ready)?.pushManager.getSubscription();
    if (sub) await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  } catch { /* ignore */ }
  setBadge(0);
  await api('/logout', { method: 'POST', body: {} }).catch(() => {});
  location.hash = '';
  start();
}

// ---------- Router ----------

async function route() {
  if (!me) return;
  pageTimers.forEach(clearInterval);
  pageTimers = [];
  $('#shell').classList.remove('menu-open');
  $('#notif').hidden = true;
  const { path, params } = parseHash();
  const r = routeFor(path) || routeFor('');
  renderShell(r.key);
  const app = $('#app');
  app.innerHTML = skeleton();
  try {
    await r.view(params);
    animateIn(app);
  } catch (err) {
    if (err.status === 401) return start();
    app.innerHTML = `<div class="card"><div class="notice pink">${icon('alert')}${esc(err.message)}</div></div>`;
  }
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);

async function start() {
  me = null;
  $('#shell').hidden = true;
  $('#auth').hidden = true;
  try {
    const data = await api('/me');
    me = data.user;
    company = data.company_name;
    document.title = company;
    $('#shell').hidden = false;
    await refreshCounts();
    await route();
    if (notifCount()) {
      $('#bell-btn').classList.add('shake');
      setTimeout(() => $('#bell-btn').classList.remove('shake'), 900);
    }
    setTimeout(celebrateNews, 700);
    syncPush();
  } catch {
    try {
      const setup = await api('/setup');
      company = setup.company_name;
      setup.needsSetup ? viewSetup() : viewLogin();
    } catch (err) {
      $('#auth').hidden = false;
      $('#auth').innerHTML = navigator.onLine
        ? `<div class="auth-form" style="grid-column:1/-1"><div class="card"><div class="notice pink">${icon('alert')}${esc(err.message)}</div></div></div>`
        : `<div class="auth-form" style="grid-column:1/-1"><div class="card" style="text-align:center"><div style="font-size:3rem">📡</div>
            <h2 style="margin:10px 0 6px">You're offline</h2><p class="muted">Check your internet connection. Bahr will reconnect automatically.</p>
            <button class="btn mt" onclick="location.reload()">${icon('refresh')}Try again</button></div></div>`;
    }
  }
}

// Pending counts (owner) and recent decisions (employee) for badges + notifications.
async function refreshCounts() {
  taskMeta = await api('/tasks/meta').catch(() => taskMeta);
  try {
    if (me.role === 'owner') {
      const [o, leaves, rewards, feed, fixes] = await Promise.all([
        api('/admin/overview'),
        api('/admin/leaves?status=pending'),
        api('/admin/rewards?status=pending'),
        api('/admin/feed').catch(() => []),
        api('/admin/corrections?status=pending').catch(() => []),
      ]);
      pending = o.pending;
      cachedRules = o.rules;
      renderOnline(o.rows);
      notifItems = [
        ...leaves.map((l) => ({ at: l.created_at, who: l.user_name, text: `requested ${(LEAVE_TYPES[l.type]?.[1] || 'leave').toLowerCase()} ${fmtDate(l.from_date)} → ${fmtDate(l.to_date)}`, href: '#/leaves', ico: 'flag', unread: true })),
        ...fixes.map((c) => ({ at: c.created_at, who: c.user_name, text: `asked to fix ${fmtDate(c.work_date)}`, href: '#/corrections', ico: 'wrench', unread: true })),
        ...rewards.map((r) => ({ at: r.created_at, who: r.user_name, text: `requested ${money(r.amount, o.rules.currency)} via ${METHODS[r.method]}`, href: '#/rewards', ico: 'gift', unread: true })),
        ...feed.filter((f) => f.type === 'device' && Date.now() - new Date(f.at) < 3 * 864e5).map((f) => ({ at: f.at, who: f.name, text: `⚠️ blocked login from ${f.extra || 'another device'}`, href: '#/employees', ico: 'lock', status: 'rejected', unread: true })),
      ].sort((a, b) => new Date(b.at) - new Date(a.at));
    } else {
      renderOnline(null);
      const [leaves, rewards, kd, fixes, team] = await Promise.all([
        api('/me/leaves'), api('/me/rewards'), api(`/kudos?user_id=${me.id}`), api('/me/corrections').catch(() => []),
        me.role === 'lead' ? Promise.all([api('/admin/overview'), api('/admin/leaves?status=pending'), api('/admin/corrections?status=pending')]).catch(() => null) : null,
      ]);
      const seen = Number(store.get('seen', 0));
      if (team) pending = team[0].pending;
      notifItems = [
        ...(team ? [
          ...team[1].map((l) => ({ at: l.created_at, who: l.user_name, text: `requested leave ${fmtDate(l.from_date)} → ${fmtDate(l.to_date)}`, href: '#/team-leaves', ico: 'flag', action: true })),
          ...team[2].map((c) => ({ at: c.created_at, who: c.user_name, text: `asked to fix ${fmtDate(c.work_date)}`, href: '#/team-fixes', ico: 'wrench', action: true })),
        ] : []),
        ...fixes.filter((c) => c.decided_at).map((c) => ({ at: c.decided_at, who: 'Attendance fix', text: `${fmtDate(c.work_date)} was ${c.status}`, href: '#/corrections', ico: 'wrench', status: c.status })),
        ...leaves.filter((l) => l.decided_at).map((l) => ({ at: l.decided_at, who: 'Leave', text: `${fmtDate(l.from_date)} → ${fmtDate(l.to_date)} was ${l.status}`, href: '#/leaves', ico: 'flag', status: l.status })),
        ...rewards.filter((r) => r.decided_at).map((r) => ({ at: r.decided_at, who: 'Reward', text: `${r.points} points request was ${r.status === 'paid' ? 'paid 🎉' : r.status}`, href: '#/rewards', ico: 'gift', status: r.status })),
        ...kd.rows.filter((k) => k.to_user === me.id).map((k) => ({ at: k.created_at, who: `${k.from_name} sent you kudos`, text: `${KUDOS[k.category]?.[0] || '🙌'} ${KUDOS[k.category]?.[1] || ''}${k.message ? `: "${k.message}"` : ''}`, href: '#/profile', ico: 'heart', status: 'approved', kind: 'kudos' })),
      ]
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, 15)
        .map((n) => ({ ...n, unread: n.action || new Date(n.at).getTime() > seen }));
    }
  } catch {
    /* non-critical */
  }
}
const notifCount = () => notifItems.filter((n) => n.unread).length;

// Celebrate good news the employee hasn't seen yet (paid rewards, new kudos), once per item.
function celebrateNews() {
  if (!me || me.role === 'owner') return;
  const fresh = notifItems.filter((n) => n.unread && (n.status === 'paid' || n.kind === 'kudos'));
  const shown = new Set(JSON.parse(store.get(`shown.${me.id}`, '[]')));
  const item = fresh.find((n) => !shown.has(`${n.at}|${n.who}`));
  if (!item) return;
  store.set(`shown.${me.id}`, JSON.stringify([...shown, ...fresh.map((n) => `${n.at}|${n.who}`)].slice(-100)));
  if (item.status === 'paid') celebrate({ emoji: '💸', title: 'Your reward was paid!', sub: 'Check your wallet. Well deserved!' });
  else celebrate({ emoji: '🙌', title: item.who, sub: esc(item.text), confettiCount: 120, sound: 'success' });
}

function toggleNotifications() {
  const pop = $('#notif');
  if (!pop.hidden) return (pop.hidden = true);
  pop.innerHTML = `<div class="row between"><h3>Notifications</h3>${me.role === 'owner' ? '<span class="chip amber">Needs action</span>' : ''}</div>
    <div class="list">${
      notifItems.length
        ? notifItems
            .map(
              (n) => `<a class="list-item" href="${n.href}" style="text-decoration:none">
                <span class="avatar sm ${n.status ? (REQ[n.status] || [])[1] : 'slate'}">${icon(n.ico)}</span>
                <div class="grow"><strong>${esc(n.who)}</strong><span>${esc(n.text)}</span></div>
                <span class="tiny muted nowrap">${relTime(n.at)}</span></a>`,
            )
            .join('')
        : empty('bell', "You're all caught up")
    }</div>`;
  pop.hidden = false;
  if (me.role !== 'owner') {
    store.set('seen', Date.now());
    notifItems = notifItems.map((n) => ({ ...n, unread: !!n.action }));
    $('#bell-btn').innerHTML = `${icon('bell')}${notifCount() ? `<span class="badge-dot">${notifCount()}</span>` : ''}`;
  }
}

// ---------- Command palette ----------

let staffCache = null;
async function openPalette() {
  const dlg = $('#palette');
  if (me.role === 'owner' && !staffCache) staffCache = await api('/admin/users').catch(() => []);
  const items = [
    ...navItems().filter((n) => n.view && !['staff'].includes(n.key)).map((n) => ({ label: n.label, sub: 'Page', ico: n.icon, run: () => go(`#/${n.key}`) })),
    ...(me.role !== 'owner' ? [{ label: 'Check in now', sub: 'Action', ico: 'pin', run: () => go('#/') }] : []),
    { label: 'Send kudos to a teammate', sub: 'Action', ico: 'heart', run: () => kudosModal() },
    ...(me.role === 'owner'
      ? [
          { label: 'Add employee', sub: 'Action', ico: 'plus', run: () => { go('#/employees'); setTimeout(addEmployeeModal, 300); } },
          { label: "Export this month's report (CSV)", sub: 'Action', ico: 'download', run: () => (location.href = `/api/admin/report.csv?month=${thisMonth()}`) },
          ...(staffCache || []).filter((u) => u.role !== 'owner').map((u) => ({ label: u.name, sub: `${u.job_title || 'Staff'} · @${u.username}`, avatar: u.name, run: () => go(`#/staff?id=${u.id}`) })),
        ]
      : []),
    { label: isDark() ? 'Switch to light mode' : 'Switch to dark mode', sub: 'Preference', ico: isDark() ? 'sun' : 'moon', run: toggleTheme },
    { label: 'Log out', sub: 'Account', ico: 'logout', run: logout },
  ];
  dlg.innerHTML = `<div class="box"><div class="input-icon">${icon('search')}<input id="pal-q" placeholder="Search pages, staff, actions…" autocomplete="off"></div>
    <div class="results" id="pal-r"></div><div class="hint"><span>↑↓ navigate</span><span>↵ open</span><span>esc close</span></div></div>`;
  let sel = 0;
  let shown = items;
  const draw = () => {
    $('#pal-r').innerHTML = shown.length
      ? shown
          .map(
            (it, i) => `<div class="res ${i === sel ? 'sel' : ''}" data-i="${i}">
              ${it.avatar ? avatar(it.avatar, 'sm') : `<span class="ico">${icon(it.ico)}</span>`}
              <div class="grow"><strong>${esc(it.label)}</strong><br><span>${esc(it.sub)}</span></div></div>`,
          )
          .join('')
      : empty('search', 'No results');
    $('#pal-r .sel')?.scrollIntoView({ block: 'nearest' });
  };
  const runSel = () => {
    const it = shown[sel];
    if (!it) return;
    dlg.close();
    it.run();
  };
  const q = $('#pal-q');
  q.oninput = () => {
    const v = q.value.trim().toLowerCase();
    shown = items.filter((it) => `${it.label} ${it.sub}`.toLowerCase().includes(v));
    sel = 0;
    draw();
  };
  q.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') runSel();
  };
  $('#pal-r').onclick = (e) => {
    const r = e.target.closest('.res');
    if (r) { sel = Number(r.dataset.i); runSel(); }
  };
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  draw();
  dlg.showModal();
  q.focus();
}

// ---------- Auth screens ----------

function authShell(formHtml) {
  $('#auth').hidden = false;
  $('#auth').innerHTML = `
    <section class="auth-hero">
      <div class="row" style="gap:14px;color:#d5d9e0">${logoMark(40)}<span class="wm big"><b>BAHR</b><i>NETWORK</i></span></div>
      <div>
        <h1>Attendance that runs itself.</h1>
        <p style="opacity:.75;margin-top:12px;max-width:42ch">GPS check-in, automatic points and deductions, leave and reward requests: one place for the whole team.</p>
      </div>
      <div class="feats">
        <div class="feat lime">${icon('pin')}GPS check-in at the office</div>
        <div class="feat teal">${icon('star')}Green points &amp; rewards</div>
        <div class="feat pink">${icon('alert')}Automatic late &amp; absence rules</div>
        <div class="feat sky">${icon('chart')}Monthly reports &amp; CSV export</div>
      </div>
    </section>
    <section class="auth-form"><div class="card">${formHtml}</div>
      <p class="auth-legal"><a href="/privacy.html">Privacy Policy</a> · <a href="/terms.html">Terms of Use</a></p></section>`;
}

function viewLogin() {
  authShell(`
    <h2>Welcome back</h2><p class="muted" style="margin:6px 0 22px">Sign in to ${esc(company)}</p>
    <form id="login" class="grid">
      <label class="f">Username<div class="input-icon">${icon('at')}<input name="username" autocomplete="username" required autofocus></div></label>
      <label class="f">Password<div class="input-icon">${icon('key')}<input name="password" type="password" autocomplete="current-password" required></div></label>
      <button class="btn block xl" type="submit" style="margin-top:6px">${icon('login')}Sign in</button>
      <div id="login-msg"></div>
      <p class="muted tiny" style="text-align:center">${icon('lock')} For security, your account works on one phone and one laptop: the first ones you sign in from.</p>
    </form>`);
  $('#login').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    try {
      await api('/login', { method: 'POST', body: formData(e.target) });
      await start();
    } catch (err) {
      if (err.code === 'device_locked') {
        $('#login-msg').innerHTML = `<div class="status-banner pink pop"><span class="ico">${icon('lock')}</span>
          <div><strong>Device not recognised</strong><div class="small">${esc(err.message)}</div></div></div>`;
        chime('error');
        haptic([60, 40, 60]);
      } else toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
}

function viewSetup() {
  authShell(`
    <h2>Let's set up 👋</h2><p class="muted" style="margin:6px 0 22px">Create the owner account. It takes 30 seconds.</p>
    <form id="setup" class="grid">
      <label class="f">Company name<input name="company_name" value="${esc(company)}" required></label>
      <label class="f">Your name<input name="name" required></label>
      <label class="f">Username<input name="username" autocomplete="username" pattern="[A-Za-z0-9_.@\\-]{3,40}" title="3+ letters/numbers, no spaces" required></label>
      <label class="f">Password (6+ characters)<input name="password" type="password" minlength="6" autocomplete="new-password" required></label>
      <button class="btn block xl" type="submit" style="margin-top:6px">Create owner account</button>
    </form>`);
  $('#setup').onsubmit = (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      await api('/setup', { method: 'POST', body: formData(e.target) });
      location.hash = '#/settings';
      await start();
      toast('Next: set your office location so staff can check in', 'success');
    });
  };
}

// ---------- Shared building blocks ----------

function pageHead(title, sub, actions = '') {
  return `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${actions ? `<div class="row wrap">${actions}</div>` : ''}</div>`;
}

function kpi(label, value, color, fill) {
  return `<div class="kpi"><div class="label">${label}</div><div class="value num">${value}</div>
    <div class="bar"><i style="width:${Math.max(4, Math.min(100, fill))}%;background:var(--${color}-bar, var(--${color}))"></i></div></div>`;
}

function tile(cls, title, value, sub = '', { href, arrow = true, big = false, attrs = '' } = {}) {
  const tag = href ? 'a' : attrs ? 'button' : 'div';
  return `<${tag} class="tile ${cls}" ${href ? `href="${href}"` : ''} ${attrs} ${tag === 'button' ? 'type="button"' : ''}>
    <div class="t-title">${title}</div>${arrow && (href || attrs) ? `<span class="t-arrow">${icon('arrow')}</span>` : ''}
    <div class="t-foot"><div class="t-sub">${sub}</div>${big ? `<div class="t-big num">${value}</div>` : `<div class="t-num num">${value}</div>`}</div></${tag}>`;
}

// Horizontal check-in timeline with a "now" marker.
function timeTrack(r, nowTime) {
  const start = toMin(r.early_start) - 60;
  const end = toMin(r.close) + 60;
  const span = end - start;
  const seg = (a, b, cls, label) => {
    const w = ((b - a) / span) * 100;
    return w > 0 ? `<div class="${cls}" style="width:${w}%" title="${label}">${w > 9 ? label : ''}</div>` : '';
  };
  const pts = [r.early_start, r.early_end, r.late_after, r.very_late_after, r.close];
  const pos = (t) => ((toMin(t) - start) / span) * 100;
  const now = nowTime ? toMin(nowTime) : null;
  return `<div class="track">
      ${seg(start, toMin(r.early_start), 'slate', 'Closed')}
      ${seg(toMin(r.early_start), toMin(r.early_end), 'lime', 'Early +1')}
      ${seg(toMin(r.early_end), toMin(r.late_after), 'teal', 'On time')}
      ${seg(toMin(r.late_after), toMin(r.very_late_after), 'pink', 'Late')}
      ${seg(toMin(r.very_late_after), toMin(r.close), 'pink', `Very late ×${r.very_late_reds}`)}
      ${seg(toMin(r.close), end, 'dark', 'Closed')}
      ${now != null && now > start && now < end ? `<span class="now" id="track-now" style="left:${((now - start) / span) * 100}%"></span>` : ''}
    </div>
    <div class="track-labels">${pts.map((t) => `<span style="left:${pos(t)}%">${fmtTime(t).replace(':00', '')}</span>`).join('')}</div>`;
}

// Month calendar coloured by attendance status.
function calendar(month, { attendance, points, leaves, workDays, startDate, today }) {
  const first = toDate(`${month}-01`);
  const daysIn = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const att = new Map(attendance.map((a) => [a.work_date, a.status]));
  const absent = new Set(points.filter((p) => p.source === 'absent' && p.kind === 'black').map((p) => p.work_date));
  const onLeave = (d) => leaves.some((l) => l.status === 'approved' && d >= l.from_date && d <= l.to_date);
  let html = DAYS.map((d) => `<div class="dow">${d.slice(0, 2)}</div>`).join('');
  html += '<div></div>'.repeat(first.getUTCDay());
  for (let i = 1; i <= daysIn; i++) {
    const d = `${month}-${String(i).padStart(2, '0')}`;
    const wd = workDays.includes(toDate(d).getUTCDay());
    let cls = '';
    let title = '';
    if (att.has(d)) { cls = STATUS[att.get(d)][1]; title = STATUS[att.get(d)][0]; }
    else if (onLeave(d)) { cls = 'amber'; title = 'On leave'; }
    else if (absent.has(d)) { cls = 'dark'; title = 'Absent'; }
    else if (d > today) { cls = 'future'; }
    else if (!wd || (startDate && d < startDate)) { cls = 'off'; title = 'Day off'; }
    html += `<div class="day ${cls} ${d === today ? 'today' : ''}" title="${fmtDate(d)}${title ? ` · ${title}` : ''}">${i}</div>`;
  }
  return `<div class="cal">${html}</div>
    <div class="legend mt"><span><i class="lime"></i>Early</span><span><i class="teal"></i>On time</span><span><i class="pink"></i>Late</span>
    <span><i class="dark"></i>Absent</span><span><i class="amber"></i>Leave</span></div>`;
}

function historyLists(h) {
  return `<div class="grid g2 mt">
    <div class="card"><div class="card-head"><h2>Attendance</h2><span class="chip">${h.attendance.length} days</span></div>${
      h.attendance.length
        ? `<div class="list">${h.attendance
            .map(
              (a) => `<div class="list-item"><span class="avatar sm ${STATUS[a.status][1]}">${icon('clock')}</span>
                <div class="grow"><strong>${fmtDate(a.work_date)}</strong><span>In ${fmtTime(a.check_in_time)} · Out ${fmtTime(a.check_out_time)}${a.check_out_time ? ` · ${fmtHours(toMin(a.check_out_time) - toMin(a.check_in_time))}` : ''} · ${a.distance_m == null ? 'Manual' : `${Math.round(a.distance_m)} m`}</span></div>
                ${chip(STATUS, a.status)}</div>`,
            )
            .join('')}</div>`
        : empty('calendar', 'No attendance this month')
    }</div>
    <div class="card"><div class="card-head"><h2>Points log</h2></div>${
      h.points.length
        ? `<div class="list">${h.points
            .map(
              (p) => `<div class="list-item"><span class="avatar sm ${KIND[p.kind][1]}">${icon(p.kind === 'green' ? 'star' : p.kind === 'red' ? 'alert' : 'ban')}</span>
                <div class="grow"><strong>${esc(SOURCE[p.source] || p.source)}</strong><span>${fmtDate(p.work_date)}${p.reason ? ` · ${esc(p.reason)}` : ''}</span></div>
                ${pointsChip(p.kind, p.delta)}</div>`,
            )
            .join('')}</div>`
        : empty('star', 'No points this month')
    }</div></div>`;
}

function monthInput(month, hashBase) {
  setTimeout(() => {
    const el = $('#month');
    if (el) el.onchange = (e) => go(`${hashBase}${hashBase.includes('?') ? '&' : '?'}month=${e.target.value}`);
  });
  return `<input type="month" id="month" value="${month}" style="width:180px">`;
}

// ---------- Employee: home ----------

async function viewEmployeeHome() {
  const [d, h, leaves, lb, ach, ann, people, myTasks] = await Promise.all([
    api('/me/dashboard'),
    api(`/me/history?month=${thisMonth()}`),
    api('/me/leaves'),
    api('/leaderboard').catch(() => ({ rows: [] })),
    api('/me/achievements'),
    api('/announcements').catch(() => []),
    api('/people').catch(() => []),
    api('/tasks?scope=mine').catch(() => []),
  ]);
  const celebrations = upcomingCelebrations(people, d.now.date);
  const dismissed = JSON.parse(store.get('dismissed', '[]'));
  const pinned = ann.filter((x) => x.pinned && !dismissed.includes(x.id));
  cachedRules = d.rules;
  const r = d.rules;
  const a = d.attendance;
  const m = d.balances.month;
  const days = Math.max(1, daysBetween(me.created_at || me.start_date, d.now.date) + 1);
  const toReward = Math.max(0, r.min_reward_points - d.balances.green);
  const myRank = lb.rows.findIndex((x) => x.user_id === me.id) + 1;

  let checkBlock;
  if (a) {
    const st = STATUS[a.status];
    const msg = a.status === 'early' ? 'You earned +1 green point 🎉' : a.status.includes('late') ? `${a.status === 'late' ? 1 : r.very_late_reds} red penalty recorded` : 'Right on time. Nice!';
    checkBlock = `<div class="status-banner ${st[1]}"><span class="ico">${icon('check')}</span>
        <div><strong>Checked in at ${fmtTime(a.check_in_time)} · ${st[0]}</strong><div class="small">${msg}${a.check_out_time ? ` · Checked out ${fmtTime(a.check_out_time)}` : ''}</div></div></div>
      ${a.mode === 'remote' ? `<div class="notice sky mt">${icon('pin')}Checked in remotely${a.distance_m != null ? ` · ${(a.distance_m / 1000).toFixed(1)} km from the office` : ''}</div>` : ''}
      <div class="mt"><p class="strong small" style="margin-bottom:8px">${a.mood ? `Today's mood: ${MOODS[a.mood][0]} ${MOODS[a.mood][1]}. Tap to change` : 'How are you feeling today?'}</p>
        <div class="moods" id="moods">${Object.entries(MOODS).map(([k, [em, label]]) => `<button type="button" data-mood="${k}" class="${Number(k) === a.mood ? 'on' : ''}"><span>${em}</span>${label}</button>`).join('')}</div></div>
      ${a.check_out_time ? '' : `<button class="btn light block mt" id="checkout" style="height:52px">${icon('logout')}Check out</button>`}`;
  } else {
    const gated = d.work_day && d.check_in_window !== 'open';
    const notes = [];
    if (d.holiday) notes.push(`<div class="notice sky">🎉 Today is an official holiday: <strong>${esc(d.holiday)}</strong>. Enjoy your day off!</div>`);
    else if (!d.work_day) notes.push(`<div class="notice slate">${icon('calendar')}Today is not a work day. Enjoy!</div>`);
    if (d.on_leave) notes.push(`<div class="notice amber">${icon('flag')}You're on approved leave today.</div>`);
    if (gated && d.check_in_window === 'closed') notes.push(`<div class="notice dark">${icon('ban')}Check-in closed at ${fmtTime(r.close)}.</div>`);
    if (gated && d.check_in_window === 'not_open') notes.push(`<div class="notice sky">${icon('clock')}Check-in opens at ${fmtTime(r.early_start)}.</div>`);
    if (me.remote_allowed && !gated) notes.push(`<div class="notice sky">${icon('pin')}Remote check-in is enabled for you. You can check in from anywhere.</div>`);
    checkBlock = `<div class="grid" style="gap:10px">${notes.join('')}</div>${
      gated ? '' : `<button class="checkin-btn ${notes.length ? 'mt' : ''}" id="checkin">${icon('pin')}<span>Check in</span></button>
        <p class="muted small" style="margin-top:10px;text-align:center">You must be within ${r.radius_m} m of the office. Location is checked once, when you tap.</p>`
    }`;
  }

  $('#app').innerHTML = `
    ${pageHead(`${greeting()}, ${esc(me.name.split(' ')[0])} <span class="wave">👋</span>`, fmtLong(d.now.date), `
      ${d.streak ? `<span class="chip pink">${icon('flame')}${d.streak}-day streak</span>` : ''}
      ${myRank ? `<a class="chip lime" href="#/leaderboard" style="text-decoration:none">${icon('trophy')}#${myRank} this month</a>` : ''}
      <a class="level-chip" href="#/profile" style="text-decoration:none"><b>${ach.level.level}</b>${esc(ach.level.name)}</a>`)}
    ${appPromptsHtml()}
    ${celebrations.filter((c) => c.inDays === 0).map((c) => `<div class="announce pink m-only" style="margin-bottom:12px"><span class="em float">${c.kind === 'birthday' ? '🎂' : '🏆'}</span>
      <div style="flex:1;min-width:0"><h3>${c.p.id === me.id ? 'Happy birthday to you!' : `${esc(c.p.name)}'s ${c.kind === 'birthday' ? 'birthday' : `${c.years}-year anniversary`} today`}</h3></div>
      ${c.p.id === me.id ? '' : `<button class="btn sm" data-kudos-to="${c.p.id}" data-kudos-cat="good_vibes">🎉 Celebrate</button>`}</div>`).join('')}
    ${pinned.length ? `<div class="grid" style="gap:10px;margin-bottom:16px">${pinned.map((x) => announceHtml(x, false, true)).join('')}</div>` : ''}
    <div class="dash">
      <div class="stack-col">
        <div class="card m-hide">
          <div class="profile">
            <div class="photo ${hue(me.name)}">${esc(initials(me.name))}</div>
            <div class="meta">
              <div class="row between"><div><h2>${esc(me.name)}</h2><p class="muted small">${esc(me.job_title || 'Team member')} · ${days} day${days === 1 ? '' : 's'} at ${esc(company)}</p></div>
                <button class="icon-btn sm" data-go="#/account" aria-label="Edit account">${icon('pen')}</button></div>
              <div class="info">
                <span>${icon('at')}@${esc(me.username)}</span>
                <span>${icon('phone')}${esc(me.phone || '—')}</span>
                <span>${icon('briefcase')}${esc(company)}</span>
                <span>${icon('clock')}${fmtTime(r.early_end)} – ${fmtTime(r.late_after)}</span>
              </div>
            </div>
          </div>
          <div class="kpis">
            ${kpi('Attendance this month', `${d.month_stats.rate}%`, 'teal', d.month_stats.rate)}
            ${kpi('Green balance', d.balances.green, 'lime', pct(d.balances.green, r.min_reward_points))}
            ${kpi('On-time streak', `${d.streak} day${d.streak === 1 ? '' : 's'}`, 'pink', Math.min(100, d.streak * 10))}
          </div>
        </div>

        <div class="card m-first">
          <div class="card-head"><h2>Staff check-in</h2><span class="chip">${icon('clock')}Server time</span></div>
          <div class="row between wrap" style="align-items:flex-end;margin-bottom:6px">
            <div class="clock num" id="clock">${fmtTime(d.now.time)}</div>
            <div class="muted small" style="text-align:right">${fmtDate(d.now.date)}<br>${esc(r.company_name)}</div>
          </div>
          ${d.work_day ? timeTrack(r, d.now.time) : ''}
          <div class="mt">${checkBlock}</div>
        </div>
        ${myTasksCard(myTasks)}

        <div class="card">
          <div class="card-head"><h2>My points</h2><span class="chip">${fmtMonth(d.now.date.slice(0, 7))}</span></div>
          <div class="grid g3">
            ${tile('lime', 'Green points', d.balances.green, `+${m.green} this month`, { big: true, href: '#/rewards' })}
            ${tile('pink', 'Red penalties', m.red, `${money(d.deductions.red * d.deductions.red_value)}`, { big: true, href: '#/history' })}
            ${tile('dark', 'Black absences', m.black, `${money(d.deductions.black * d.deductions.black_value)}`, { big: true, href: '#/history' })}
          </div>
          ${
            d.balances.green >= 1 && m.red >= 1
              ? `<div class="notice lime mt" style="justify-content:space-between;flex-wrap:wrap">
                  <span class="row">${icon('refresh')}Swap 1 green point to remove 1 red penalty</span>
                  <button class="btn sm" id="redeem">Use 1 green point</button></div>`
              : ''
          }
          <div class="row between mt" style="padding-top:14px;border-top:1px solid var(--line)">
            <span class="muted">Deductions this month</span><strong class="num" style="font-size:1.2rem">${money(d.deductions.total)}</strong>
          </div>
        </div>
      </div>

      <div class="stack-col m-hide">
        ${levelCard(ach)}
        <div class="quote"><p>${esc(quoteOfDay())}</p><small>Thought of the day · ${esc(company)}</small></div>
        <div class="card">
          <div class="card-head"><h2>Celebrations 🎈</h2><button class="btn sm light" data-kudos-to="">${icon('heart')}Kudos</button></div>
          ${celebrationsHtml(celebrations)}
        </div>
        <div class="card">
          <div class="card-head"><h2>My month</h2><a class="btn sm light" href="#/history">Details</a></div>
          ${calendar(d.now.date.slice(0, 7), { attendance: h.attendance, points: h.points, leaves, workDays: r.work_days, startDate: me.start_date, today: d.now.date })}
        </div>
        <div class="card">
          <div class="card-head"><h2>Next reward</h2></div>
          <div class="row" style="gap:18px">
            <div class="ring" style="--p:${pct(Math.min(d.balances.green, r.min_reward_points), r.min_reward_points)}"><div><b class="num">${d.balances.green}</b><small>of ${r.min_reward_points}</small></div></div>
            <div><p class="strong">${toReward ? `${toReward} more green point${toReward === 1 ? '' : 's'} to unlock a reward` : 'You can request a reward now! 🎉'}</p>
              <p class="muted small" style="margin:6px 0 12px">1 point = ${money(r.green_value)}. Check in early to earn more.</p>
              <a class="btn sm ${toReward ? 'light' : 'lime'}" href="#/rewards">${icon('gift')}Rewards</a></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Top this month</h2><a class="btn sm light" href="#/leaderboard">All</a></div>
          ${miniLeaderboard(lb.rows)}
        </div>
      </div>
    </div>`;

  // Live clock from server time.
  const base = Date.now();
  const [hh, mm] = d.now.time.split(':').map(Number);
  const startSec = hh * 3600 + mm * 60 + d.now.seconds;
  every(1000, () => {
    const s = Math.floor(startSec + (Date.now() - base) / 1000) % 86400;
    const el = $('#clock');
    if (el) el.innerHTML = fmtTime(`${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`).replace(':', '<span class="colon">:</span>');
  });

  const checkin = $('#checkin');
  if (checkin) {
    checkin.onclick = () =>
      act(checkin, async () => {
        const label = $('span', checkin);
        label.textContent = 'Getting your location…';
        try {
          let pos;
          try {
            pos = await getPosition();
          } catch (err) {
            err.retry = () => $('#checkin')?.click();
            throw err;
          }
          label.textContent = 'Checking in…';
          const res = await api('/me/check-in', { method: 'POST', body: pos });
          haptic([20, 30, 40]);
          if (res.green) celebrate({ emoji: '🐦', title: 'Early bird! +1 green point', sub: `Checked in at ${fmtTime(res.attendance.check_in_time)}. The team's lucky to have you.` });
          else if (res.red) { chime('soft'); toast(`Checked in late: ${res.red} red penalty. Tomorrow is a new day 💪`, 'error'); }
          else { confetti({ count: 70 }); chime('success'); toast('You\'re in! Have a great day ☀️', 'success'); }
          route();
        } finally {
          label.textContent = 'Check in';
        }
      });
  }
  const checkout = $('#checkout');
  if (checkout) checkout.onclick = () => act(checkout, async () => { await api('/me/check-out', { method: 'POST', body: {} }); route(); }, 'Checked out. See you tomorrow!');
  const redeem = $('#redeem');
  if (redeem) redeem.onclick = () => act(redeem, async () => { await api('/me/redeem', { method: 'POST', body: {} }); confetti({ count: 60 }); route(); }, '1 red penalty removed');
  $$('#moods [data-mood]').forEach((b) => (b.onclick = async () => {
    try {
      await api('/me/mood', { method: 'POST', body: { mood: Number(b.dataset.mood) } });
      $$('#moods button').forEach((x) => x.classList.toggle('on', x === b));
      burst(MOODS[b.dataset.mood][0], b, 8);
      chime('soft');
      haptic(15);
      toast(Number(b.dataset.mood) <= 2 ? 'Thanks for sharing. Hope your day gets better 💛' : 'Mood saved. Love the energy!', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }));
  $$('[data-dismiss]').forEach((b) => (b.onclick = () => {
    store.set('dismissed', JSON.stringify([...dismissed, Number(b.dataset.dismiss)]));
    b.closest('.announce').remove();
  }));
  checkMilestones(ach);
  const myBday = celebrations.find((c) => c.kind === 'birthday' && c.p.id === me.id && c.inDays === 0);
  if (myBday && store.get('bday', '') !== d.now.date) {
    store.set('bday', d.now.date);
    setTimeout(() => celebrate({ emoji: '🎂', title: `Happy birthday, ${me.name.split(' ')[0]}!`, sub: `The whole ${esc(company)} team wishes you an amazing year.`, confettiCount: 260 }), 500);
  }
}

function miniLeaderboard(rows) {
  if (!rows.length) return empty('trophy', 'No ranking yet');
  return `<div class="list">${rows
    .slice(0, 5)
    .map(
      (x, i) => `<div class="list-item" ${x.user_id === me.id ? 'style="background:var(--sunken);border-radius:14px;padding-inline:8px"' : ''}>
        <span class="rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span>${avatar(x.name, 'sm')}
        <div class="grow"><strong>${esc(x.name)}${x.user_id === me.id ? ' (you)' : ''}</strong><span>${esc(x.job_title || 'Staff')}</span></div>
        <span class="chip lime num">${x.green}</span></div>`,
    )
    .join('')}</div>`;
}

// ---------- Employee: history ----------

async function viewHistory(params, userId = null) {
  const month = params.get('month') || thisMonth();
  const base = userId ? `/admin/users/${userId}/history` : '/me/history';
  const [h, leaves] = await Promise.all([
    api(`${base}?month=${month}`),
    userId ? api('/admin/leaves?status=approved').then((l) => l.filter((x) => x.user_id === userId)) : api('/me/leaves'),
  ]);
  return { h, leaves, month };
}

async function viewHistoryPage(params) {
  const { h, leaves, month } = await viewHistory(params);
  const d = await api('/me/dashboard');
  cachedRules = d.rules;
  $('#app').innerHTML = `
    ${pageHead('My history', fmtMonth(month), monthInput(month, '#/history'))}
    <div class="dash">
      <div class="stack-col">
        <div class="card"><div class="card-head"><h2>Summary</h2></div>
          <div class="grid g4">
            ${tile('teal', 'Days present', h.attendance.length, 'this month', { big: true, arrow: false })}
            ${tile('lime', 'Green earned', h.balances.month.green, `balance ${h.balances.green}`, { big: true, arrow: false })}
            ${tile('pink', 'Red penalties', h.balances.month.red, money(Math.max(0, h.balances.month.red) * d.rules.red_value), { big: true, arrow: false })}
            ${tile('dark', 'Absences', h.balances.month.black, money(Math.max(0, h.balances.month.black) * d.rules.black_value), { big: true, arrow: false })}
          </div>
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>Calendar</h2></div>
        ${calendar(month, { attendance: h.attendance, points: h.points, leaves, workDays: d.rules.work_days, startDate: me.start_date, today: d.now.date })}</div>
    </div>
    ${historyLists(h)}`;
}
EMPLOYEE_NAV.find((n) => n.key === 'history').view = viewHistoryPage;

// ---------- Employee: leave ----------

async function viewMyLeaves() {
  const [list, d, lb] = await Promise.all([api('/me/leaves'), api('/me/dashboard'), api('/me/leave-balance')]);
  const r = d.rules;
  const today = d.now.date;
  const year = today.slice(0, 4);
  const holidays = await api(`/holidays?year=${year}`).catch(() => []);
  const nextYear = today.slice(5) > '10-01' ? await api(`/holidays?year=${Number(year) + 1}`).catch(() => []) : [];
  const holidaySet = new Set([...holidays, ...nextYear].map((h) => h.date));
  const workDaysIn = (from, to) => (from && to && to >= from ? eachDay(from, to).filter((x) => r.work_days.includes(toDate(x).getUTCDay()) && !holidaySet.has(x)).length : 0);
  const bal = lb.balance;
  const pendingCount = list.filter((l) => l.status === 'pending').length;
  const comingHolidays = [...holidays, ...nextYear].filter((h) => h.date >= today).slice(0, 4);
  const upcoming = list.filter((l) => l.status === 'pending' || (l.status === 'approved' && l.to_date >= today));
  const past = list.filter((l) => !upcoming.includes(l));
  const REASONS = [['🤒', 'Sick'], ['🏖️', 'Vacation'], ['👨‍👩‍👧', 'Family'], ['📚', 'Exam / study'], ['🏥', 'Appointment'], ['✏️', 'Other']];
  const QUICK = [['today', 'Today', 0, 0], ['tomorrow', 'Tomorrow', 1, 1], ['2', '2 days', 0, 1], ['3', '3 days', 0, 2], ['week', '1 week', 0, 6]];

  const item = (l) => {
    const days = daysBetween(l.from_date, l.to_date) + 1;
    return `<div class="leave-item">
      <div class="leave-date ${REQ[l.status][1]}"><b>${toDate(l.from_date).getUTCDate()}</b><span>${toDate(l.from_date).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</span></div>
      <div class="grow"><strong>${l.from_date === l.to_date ? fmtDate(l.from_date) : `${fmtDate(l.from_date)} → ${fmtDate(l.to_date)}`}</strong>
        <span class="muted small">${LEAVE_TYPES[l.type]?.[0] || ''} ${LEAVE_TYPES[l.type]?.[1] || 'Leave'} · ${days} day${days === 1 ? '' : 's'}${l.reason ? ` · ${esc(l.reason)}` : ''}</span></div>
      <div class="leave-side">${chip(REQ, l.status)}${l.status === 'pending' ? `<button class="btn sm light" data-cancel="${l.id}">Cancel</button>` : ''}</div>
    </div>`;
  };

  $('#app').innerHTML = `
    ${pageHead('Leave 🏖️', 'Approved leave days never count as absences.')}
    <div class="grid g3 leave-stats" style="margin-bottom:16px">
      ${tile('lime', 'Annual left', bal.annual.left, `of ${bal.annual.allowance} days in ${year}${bal.annual.pending ? ` · ${bal.annual.pending} pending` : ''}`, { big: true, arrow: false })}
      ${tile('sky', 'Sick left', bal.sick.left, `of ${bal.sick.allowance} days${bal.sick.used ? ` · ${bal.sick.used} used` : ''}`, { big: true, arrow: false })}
      ${tile('amber', 'Pending', pendingCount, 'waiting for approval', { big: true, arrow: false })}
    </div>
    <div class="split">
      <div class="card">
        <div class="card-head"><h2>New request</h2></div>
        <form id="leave" class="grid" style="gap:16px">
          <input type="hidden" name="type" value="annual">
          <div class="f"><span>Type</span>
            <div class="seg quick" id="ltype">${Object.entries(LEAVE_TYPES).map(([k, [em, label]]) => `<button type="button" data-t="${k}" class="${k === 'annual' ? 'on' : ''}">${em} ${label.replace(' leave', '')}</button>`).join('')}</div></div>
          <div class="f"><span>When?</span>
            <div class="seg quick" id="quick">${QUICK.map(([k, label]) => `<button type="button" data-q="${k}">${label}</button>`).join('')}</div></div>
          <div class="form-grid two">
            <label class="f">From<input type="date" name="from_date" min="${today}" value="${today}" required></label>
            <label class="f">To<input type="date" name="to_date" min="${today}" value="${today}" required></label>
          </div>
          <div class="leave-summary" id="leave-sum"></div>
          <div class="f"><span>Reason</span>
            <div class="chips" id="reasons">${REASONS.map(([em, label]) => `<button type="button" class="chip" data-reason="${label}">${em} ${label}</button>`).join('')}</div>
            <textarea name="reason" maxlength="500" rows="2" placeholder="Add a note for your manager (optional)" style="margin-top:8px;min-height:64px"></textarea></div>
          <button class="btn xl block" type="submit">${icon('flag')}Send request</button>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>My requests</h2><span class="chip">${list.length}</span></div>
        ${list.length
          ? `${upcoming.length ? `<p class="list-label">Upcoming &amp; pending</p><div class="leave-list">${upcoming.map(item).join('')}</div>` : ''}
             ${past.length ? `<p class="list-label">History</p><div class="leave-list">${past.map(item).join('')}</div>` : ''}`
          : empty('flag', 'No leave requests yet')}
        ${comingHolidays.length ? `<p class="list-label">Coming holidays</p><div class="list">${comingHolidays.map((h) => `<div class="list-item"><span class="avatar sm sky">🎉</span>
          <div class="grow"><strong>${esc(h.name)}</strong><span>${fmtLong(h.date)}</span></div><span class="chip sky">in ${daysBetween(today, h.date)}d</span></div>`).join('')}</div>` : ''}
      </div>
    </div>`;

  const form = $('#leave');
  const plus = (n) => {
    const x = toDate(today);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const update = () => {
    const from = form.from_date.value;
    const to = form.to_date.value;
    if (form.to_date.value && from && to < from) form.to_date.value = from;
    form.to_date.min = from || today;
    const total = from && form.to_date.value ? daysBetween(from, form.to_date.value) + 1 : 0;
    const work = workDaysIn(from, form.to_date.value);
    const left = bal[form.type.value]?.left;
    const over = left != null && work > left;
    $('#leave-sum').innerHTML = total
      ? `<span class="leave-sum-ico">${over ? '⚠️' : '📅'}</span><div><strong>${total} day${total === 1 ? '' : 's'}</strong>
          <span class="muted small">${from === form.to_date.value ? fmtDate(from) : `${fmtDate(from)} → ${fmtDate(form.to_date.value)}`} · ${work} work day${work === 1 ? '' : 's'}${
            left == null ? (form.type.value === 'unpaid' ? ' · deducted from salary' : '') : over ? ` · <b style="color:var(--red)">only ${left} left</b>` : ` · ${left - work} left after this`}</span></div>`
      : '';
    $$('#quick button').forEach((b) => {
      const q = QUICK.find((x) => x[0] === b.dataset.q);
      b.classList.toggle('on', from === plus(q[2]) && form.to_date.value === plus(q[3]));
    });
  };
  form.oninput = update;
  form.onchange = update;
  $$('#ltype button').forEach((b) => (b.onclick = () => {
    $$('#ltype button').forEach((x) => x.classList.toggle('on', x === b));
    form.type.value = b.dataset.t;
    update();
  }));
  $$('#quick button').forEach((b) => (b.onclick = () => {
    const q = QUICK.find((x) => x[0] === b.dataset.q);
    form.from_date.value = plus(q[2]);
    form.to_date.value = plus(q[3]);
    update();
  }));
  $$('#reasons [data-reason]').forEach((b) => (b.onclick = () => {
    $$('#reasons .chip').forEach((c) => c.classList.toggle('lime', c === b));
    const cur = form.reason.value.trim();
    const labels = REASONS.map((x) => x[1]);
    form.reason.value = !cur || labels.includes(cur) ? b.dataset.reason : cur;
  }));
  update();
  form.onsubmit = (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      await api('/me/leaves', { method: 'POST', body: formData(form) });
      confetti({ count: 50 });
      route();
    }, 'Leave request sent. Your manager has been notified');
  };
  $$('[data-cancel]').forEach((b) => (b.onclick = () => confirmBox('Cancel this request?', 'Your manager will no longer see it.', async () => {
    await api(`/me/leaves/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} });
    route();
  }, { submit: 'Cancel request' })));
}

// ---------- Employee: rewards ----------

async function viewMyRewards() {
  const [d, list] = await Promise.all([api('/me/dashboard'), api('/me/rewards')]);
  cachedRules = d.rules;
  const r = d.rules;
  const bal = d.balances.green;
  const can = bal >= r.min_reward_points;
  const lastNumber = list.find((x) => x.payout_number)?.payout_number || store.get('payout', '');
  $('#app').innerHTML = `
    ${pageHead('Rewards', 'Turn your green points into money.')}
    <div class="dash">
      <div class="stack-col">
        <div class="card">
          <div class="card-head"><h2>Send reward request 🎁</h2></div>
          <form id="reward" class="grid" style="gap:16px">
            <label class="f">Points
              <div class="row"><button type="button" class="icon-btn sm" data-step="-1">${icon('minus')}</button>
              <input type="number" name="points" min="${r.min_reward_points}" max="${Math.max(bal, r.min_reward_points)}" value="${Math.max(r.min_reward_points, bal)}" required style="text-align:center;font-weight:800;font-size:1.1rem">
              <button type="button" class="icon-btn sm" data-step="1">${icon('plus')}</button>
              <button type="button" class="btn sm light" data-max>Max</button></div></label>
            <div class="f"><span>Payout method</span><div class="choice">${Object.entries(METHODS)
              .map(([k, v], i) => `<label><input type="radio" name="method" value="${k}" ${i === 0 ? 'checked' : ''}>${icon(k === 'cash' ? 'wallet' : 'phone')}${v}</label>`)
              .join('')}</div></div>
            <label class="f" id="number-field">Mobile / InstaPay address<div class="input-icon">${icon('phone')}<input name="payout_number" inputmode="tel" value="${esc(lastNumber)}" placeholder="01xxxxxxxxx or name@instapay"></div></label>
            <div class="tile lime" style="min-height:auto"><div class="row between"><span class="strong">You'll receive</span><span class="t-big num" id="amount"></span></div></div>
            <button class="btn xl block" type="submit" ${can ? '' : 'disabled'}>${icon('gift')}Send reward request</button>
            ${can ? '' : `<p class="muted small" style="text-align:center">You need at least ${r.min_reward_points} green points (you have ${bal}).</p>`}
          </form>
        </div>
      </div>
      <div class="stack-col">
        <div class="card"><div class="row" style="gap:18px">
          <div class="ring" style="--p:${pct(Math.min(bal, r.min_reward_points), r.min_reward_points)}"><div><b class="num">${bal}</b><small>points</small></div></div>
          <div><h2 style="font-size:1.1rem">Green balance</h2><p class="muted small" style="margin-top:6px">1 point = <strong>${money(r.green_value)}</strong><br>Minimum ${r.min_reward_points} points per request.</p></div>
        </div></div>
        <div class="card"><div class="card-head"><h2>My requests</h2></div>${
          list.length
            ? `<div class="list">${list
                .map(
                  (x) => `<div class="list-item"><span class="avatar sm ${REQ[x.status][1]}">${icon('gift')}</span>
                    <div class="grow"><strong>${money(x.amount)} · ${x.points} pts</strong><span>${METHODS[x.method]} ${esc(x.payout_number || '')} · ${relTime(x.created_at)}</span></div>
                    ${chip(REQ, x.status)}${x.status === 'pending' ? `<button class="icon-btn xs" data-cancel="${x.id}" aria-label="Cancel">${icon('x')}</button>` : ''}</div>`,
                )
                .join('')}</div>`
            : empty('gift', 'No reward requests yet')
        }</div>
      </div>
    </div>`;
  const form = $('#reward');
  const update = () => {
    const pts = Number(form.points.value) || 0;
    $('#amount').textContent = money(pts * r.green_value);
    $('#number-field').hidden = form.method.value === 'cash';
  };
  form.oninput = update;
  form.onchange = update;
  $$('[data-step]', form).forEach((b) => (b.onclick = () => {
    form.points.value = Math.max(r.min_reward_points, Math.min(bal || r.min_reward_points, Number(form.points.value) + Number(b.dataset.step)));
    update();
  }));
  $('[data-max]', form).onclick = () => { form.points.value = Math.max(bal, r.min_reward_points); update(); };
  update();
  form.onsubmit = (e) => {
    e.preventDefault();
    const body = formData(form);
    body.points = Number(body.points);
    if (body.payout_number) store.set('payout', body.payout_number);
    act(e.submitter, async () => { await api('/me/rewards', { method: 'POST', body }); route(); }, 'Reward request sent');
  };
  $$('[data-cancel]').forEach((b) => (b.onclick = () => act(b, async () => {
    await api(`/me/rewards/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} });
    route();
  }, 'Request cancelled, points returned')));
}

// ---------- Leaderboard (both roles) ----------

async function viewLeaderboard(params) {
  const month = params.get('month') || thisMonth();
  const tab = params.get('tab') || 'people';
  const lb = await api(`/leaderboard?month=${month}`);
  const colors = ['lime', 'teal', 'pink'];
  const podium = (top, value, unit) => {
    const order = [1, 0, 2].filter((i) => top[i]);
    return `<div class="card"><div class="podium">${order
      .map((i) => `<div class="p ${['first', 'second', 'third'][i]} ${colors[i]} anim-in" style="--i:${i}"><span class="medal float">${['🥇', '🥈', '🥉'][i]}</span>${avatar(top[i].name, 'lg')}
        <strong>${esc(top[i].name)}</strong><span class="small">${esc(top[i].department || top[i].job_title || 'Staff')}</span>
        <span class="t-big num" style="font-size:1.6rem;font-weight:800">${value(top[i])}</span><span class="tiny">${unit}</span></div>`)
      .join('')}</div></div>`;
  };
  const tabs = `<div class="seg">${[['people', '🏆 People'], ['departments', '⚔️ Departments'], ['kudos', '🙌 Most appreciated']]
    .map(([k, l]) => `<a href="#/leaderboard?tab=${k}&month=${month}" class="${k === tab ? 'on' : ''}">${l}</a>`)
    .join('')}</div>`;
  let body = '';
  if (tab === 'departments') {
    const max = Math.max(1, ...lb.departments.map((d) => Math.abs(d.score)));
    body = lb.departments.length
      ? `<div class="card"><div class="card-head"><h2>Department battle</h2><span class="muted small">Score = (green − red − 2×black) per member</span></div>
        <div class="battle">${lb.departments
          .map((d, i) => `<div class="row-b"><span class="rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
            <div class="track-b"><i class="${['lime', 'teal', 'pink', 'sky', 'amber', 'slate'][i % 6]}" style="width:${Math.max(6, (Math.max(0, d.score) / max) * 100)}%;--i:${i}"></i>
              <span>${esc(d.department)} <span class="muted tiny">· ${d.members} ${d.members === 1 ? 'person' : 'people'} · ${d.early} early</span></span></div>
            <strong class="num">${d.score}</strong></div>`)
          .join('')}</div></div>`
      : `<div class="card">${empty('users', 'Assign departments to staff to start the battle')}</div>`;
  } else if (tab === 'kudos') {
    body = lb.kudos.length
      ? `${podium(lb.kudos.slice(0, 3), (x) => x.kudos, 'kudos received')}
        <div class="card"><div class="list">${lb.kudos.map((x, i) => `<div class="list-item"><span class="rank">${i + 1}</span>${avatar(x.name)}
          <div class="grow"><strong>${esc(x.name)}</strong><span>${esc(x.department || x.job_title || '')}</span></div><span class="chip lime num">🙌 ${x.kudos}</span>
          ${x.user_id !== me.id ? `<button class="btn sm light" data-kudos-to="${x.user_id}">Kudos</button>` : ''}</div>`).join('')}</div></div>`
      : `<div class="card">${empty('heart', 'No kudos this month yet', `<button class="btn sm" data-kudos-to="">${icon('heart')}Send the first one</button>`)}</div>`;
  } else {
    body = lb.rows.length
      ? `${podium(lb.rows.slice(0, 3), (x) => x.green, 'green points')}
        <div class="card"><div class="table-wrap"><table><thead><tr><th>#</th><th>Employee</th><th>Green</th><th>Red</th><th>Black</th><th class="m-hide">Early days</th><th class="m-hide">Present</th></tr></thead><tbody>
        ${lb.rows.map((x, i) => `<tr ${x.user_id === me.id ? 'style="background:var(--sunken)"' : ''}><td class="rank">${i + 1}</td>
          <td><a href="#/person?id=${x.user_id}" class="row" style="text-decoration:none">${avatar(x.name, 'sm')}<div><strong>${esc(x.name)}</strong><div class="tiny muted">${esc(x.department || x.job_title || 'Staff')}</div></div></a></td>
          <td><span class="chip lime num">${x.green}</span></td><td><span class="chip pink num">${x.red}</span></td><td><span class="chip dark num">${x.black}</span></td>
          <td class="num m-hide">${x.early}</td><td class="num m-hide">${x.days_present}</td></tr>`).join('')}</tbody></table></div></div>`
      : `<div class="card">${empty('trophy', 'No employees yet')}</div>`;
  }
  $('#app').innerHTML = `${pageHead('Leaderboard <span class="wave">🏆</span>', fmtMonth(month), `${tabs}${monthInput(month, `#/leaderboard?tab=${tab}`)}`)}${body}`;
}

// ---------- Account (both roles) ----------

async function viewAccount() {
  const theme = store.get('theme', 'system');
  $('#app').innerHTML = `
    ${pageHead('Account', 'Your profile and preferences')}
    <div class="grid g2">
      <div class="card">
        <div class="row" style="gap:16px">${avatar(me.name, 'lg')}<div><h2 style="font-size:1.2rem">${esc(me.name)}</h2>
          <p class="muted small">${roleLine(me)} · @${esc(me.username)}</p></div></div>
        <div class="list mt">
          <div class="list-item">${icon('briefcase')}<div class="grow"><strong>Company</strong><span>${esc(company)}</span></div></div>
          <div class="list-item">${icon('phone')}<div class="grow"><strong>Phone</strong><span>${esc(me.phone || '—')}</span></div></div>
          <div class="list-item">${icon('calendar')}<div class="grow"><strong>Member since</strong><span>${fmtLong(me.created_at || me.start_date)}</span></div></div>
        </div>
      </div>
      <div class="stack-col">
        <div class="card"><div class="card-head"><h2>App &amp; notifications</h2>${isStandalone() ? '<span class="chip lime">📲 Installed</span>' : ''}</div>
          <div class="list">
            <div class="list-item"><span class="avatar sm lime">🔔</span><div class="grow"><strong>Push notifications</strong><span id="push-state"></span></div>
              <label class="toggle"><input type="checkbox" id="push-toggle"></label></div>
            ${canInstall() ? `<div class="list-item"><span class="avatar sm sky">📲</span><div class="grow"><strong>Install the app</strong><span>Home-screen icon, full screen, faster check-in</span></div>
              <button class="btn sm" data-install>Install</button></div>` : ''}
          </div>
          <button class="btn light sm mt" id="push-test">${icon('bell')}Send me a test notification</button>
        </div>
        <div class="card"><div class="card-head"><h2>Appearance</h2></div>
          <div class="seg" id="theme-seg">${['system', 'light', 'dark']
            .map((t) => `<button type="button" data-t="${t}" class="${theme === t ? 'on' : ''}">${icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'settings')}${t[0].toUpperCase() + t.slice(1)}</button>`)
            .join('')}</div>
          <div class="mt"><label class="toggle"><input type="checkbox" id="sound" ${soundOn() ? 'checked' : ''}>Sounds &amp; celebrations audio</label></div>
          <div class="mt" style="display:flex;flex-direction:column;gap:8px;align-items:flex-start"><span class="strong small">Animations</span>
            <div class="seg" id="motion-seg">${[['system', 'Follow device'], ['on', 'Always on']]
              .map(([k, l]) => `<button type="button" data-m="${k}" class="${(store.get('motion', 'system') === 'on' ? 'on' : 'system') === k ? 'on' : ''}">${l}</button>`)
              .join('')}</div>
            ${matchMedia('(prefers-reduced-motion: reduce)').matches ? '<span class="muted tiny">Your device asks apps to reduce motion. Choose "Always on" to see all animations anyway.</span>' : ''}</div>
          <p class="muted small mt">Tip: press <span class="kbd-combo">${shortcutHtml()}</span> or <kbd>/</kbd> anywhere to search.</p>
        </div>
        <div class="card"><div class="card-head"><h2>Change password</h2></div>
          <form id="pw" class="grid">
            <label class="f">Current password<input name="current" type="password" autocomplete="current-password" required></label>
            <label class="f">New password<input name="next" type="password" minlength="6" autocomplete="new-password" required></label>
            <div><button class="btn" type="submit">${icon('key')}Update password</button></div>
          </form></div>
        <button class="btn light" data-logout>${icon('logout')}Log out</button>
      </div>
    </div>`;
  $$('#theme-seg [data-t]').forEach((b) => (b.onclick = () => {
    setTheme(b.dataset.t, b);
    $$('#theme-seg button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const paintPush = () => {
    const st = pushSupport();
    const on = st === 'granted' && store.get('push', 'on') !== 'off';
    $('#push-toggle').checked = on;
    $('#push-toggle').disabled = st === 'unsupported';
    $('#push-state').textContent = {
      'needs-install': 'Install the app to your Home Screen first (iPhone)',
      unsupported: 'Not supported in this browser',
      denied: 'Blocked in browser settings. Tap to see how to allow',
      default: 'Off. Turn on for reminders, kudos and updates',
      granted: on ? 'On for this device' : 'Off for this device',
    }[st];
  };
  paintPush();
  $('#push-toggle').onchange = async (e) => {
    const want = e.target.checked;
    const ok = await act(e.target, async () => {
      if (want) await enablePush();
      else await disablePush();
    }, want ? 'Notifications are on 🔔' : 'Notifications turned off');
    if (ok && want) confetti({ count: 60 });
    paintPush();
  };
  $('#push-test').onclick = (e) => act(e.currentTarget, async () => {
    if (pushSupport() !== 'granted' || store.get('push') === 'off') await enablePush();
    await api('/push/test', { method: 'POST', body: {} });
  }, 'Test sent. Check your notifications');
  $$('#motion-seg [data-m]').forEach((b) => (b.onclick = () => {
    setMotion(b.dataset.m);
    $$('#motion-seg button').forEach((x) => x.classList.toggle('on', x === b));
    if (b.dataset.m === 'on') confetti({ count: 60 });
  }));
  $('#sound').onchange = (e) => {
    store.set('sound', e.target.checked ? 'on' : 'off');
    if (e.target.checked) chime('success');
  };
  $('#pw').onsubmit = (e) => {
    e.preventDefault();
    act(e.submitter, async () => { await api('/me/password', { method: 'POST', body: formData(e.target) }); e.target.reset(); }, 'Password updated');
  };
}

// ---------- Owner: dashboard ----------

const PRESENT = ['early', 'on_time', 'late', 'very_late'];
const BOARD_FILTERS = {
  all: ['All', () => true],
  present: ['Present', (r) => PRESENT.includes(r.status)],
  early: ['Early', (r) => r.status === 'early'],
  late: ['Late', (r) => r.status === 'late' || r.status === 'very_late'],
  absent: ['Absent', (r) => r.status === 'absent'],
  waiting: ['Not yet', (r) => r.status === 'waiting'],
  leave: ['Leave', (r) => r.status === 'leave'],
};

async function viewOwnerDashboard(params) {
  const date = params.get('date') || '';
  const [o, feed, people] = await Promise.all([api(`/admin/overview${date ? `?date=${date}` : ''}`), api('/admin/feed'), api('/people')]);
  const celebrations = upcomingCelebrations(people, o.now.date);
  const md = o.mood;
  const moodEmoji = md.avg ? MOODS[Math.round(md.avg)][0] : '🫥';
  pending = o.pending;
  cachedRules = o.rules;
  renderShell('');
  renderOnline(o.rows);
  const r = o.rules;
  const c = (s) => o.rows.filter((x) => x.status === s).length;
  const present = o.rows.filter((x) => PRESENT.includes(x.status)).length;
  const onTime = c('early') + c('on_time');
  const total = o.rows.length;
  const isToday = o.date === o.now.date;
  let filter = 'all';
  let q = '';

  $('#app').innerHTML = `
    ${pageHead(`${greeting()}, ${esc(me.name.split(' ')[0])} <span class="wave">👋</span>`, `${fmtLong(o.date)}${o.holiday ? ` · 🎉 ${esc(o.holiday)}` : o.work_day ? '' : ' · not a work day'}`, `
      <input type="date" id="date" value="${o.date}" style="width:170px">
      <button class="btn light" id="add-emp">${icon('plus')}Add employee</button>
      <a class="btn m-hide" href="/api/admin/report.csv?month=${o.date.slice(0, 7)}">${icon('download')}Export</a>`)}
    ${appPromptsHtml()}
    ${r.location_set ? '' : `<a class="announce amber" href="#/settings" style="text-decoration:none;margin-bottom:16px"><span class="em float">📍</span>
      <div style="flex:1"><h3>Set your office location</h3><p>Staff can't check in until the office is on the map. It takes 30 seconds: search, paste a Google Maps link or tap the map.</p></div>
      <span class="btn sm">Set location</span></a>`}
    <div class="dash">
      <div class="stack-col">
        <div class="card m-hide">
          <div class="profile">
            <div class="photo" style="background:#2f3432;color:#d5d9e0">${logoMark(54)}</div>
            <div class="meta">
              <div class="row between"><div><h2>${esc(company)}</h2><p class="muted small">${total} active employee${total === 1 ? '' : 's'} · ${isToday ? 'Live today' : fmtDate(o.date)}</p></div>
                <button class="icon-btn sm" data-go="#/settings" aria-label="Settings">${icon('settings')}</button></div>
              <div class="info">
                <span>${icon('clock')}Early ${fmtTime(r.early_start)} – ${fmtTime(r.early_end)}</span>
                <span>${icon('ban')}Closes ${fmtTime(r.close)}</span>
                <span>${icon('pin')}${r.radius_m} m check-in radius</span>
                <span>${icon('calendar')}${r.work_days.map((d) => DAYS[d].slice(0, 2)).join(' ')}</span>
              </div>
            </div>
          </div>
          <div class="kpis">
            ${kpi('Present', `${present}<span class="muted" style="font-size:1rem">/${total}</span>`, 'pink', pct(present, total))}
            ${kpi('On-time rate', `${pct(onTime, present)}%`, 'teal', pct(onTime, present))}
            ${kpi('Pending requests', o.pending.leaves + o.pending.rewards + o.pending.corrections, 'lime', Math.min(100, (o.pending.leaves + o.pending.rewards + o.pending.corrections) * 20))}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>${isToday ? "Today's summary" : 'Summary'}</h2><span class="muted small">Tap a tile to filter</span></div>
          <div class="grid g4">
            ${tile('lime', 'Early arrivals', c('early'), `+${c('early')} green`, { attrs: 'data-f="early"' })}
            ${tile('teal', 'Present', present, `${pct(present, total)}% of team`, { attrs: 'data-f="present"' })}
            ${tile('pink', 'Late', c('late') + c('very_late'), 'red penalties', { attrs: 'data-f="late"' })}
            ${tile('dark', isToday && c('waiting') ? 'Not checked in' : 'Absent', isToday && c('waiting') ? c('waiting') : c('absent'), c('leave') ? `${c('leave')} on leave` : '&nbsp;', { attrs: `data-f="${isToday && c('waiting') ? 'waiting' : 'absent'}"` })}
          </div>
        </div>

        <div class="grid g2">
          <div class="card" style="margin:0">
            <div class="card-head"><h2>Team mood</h2><span class="chip">${md.count} shared</span></div>
            ${md.count ? `<div class="row" style="gap:18px;align-items:flex-end">
                <div><div class="mood-big float">${moodEmoji}</div><div class="strong num" style="margin-top:6px">${md.avg} / 5</div></div>
                <div class="dist" style="flex:1">${md.dist.map((n, i) => `<div title="${n} × ${MOODS[i + 1][1]}"><i style="height:${Math.max(4, pct(n, Math.max(...md.dist)))}%;background:var(--${['pink', 'amber', 'slate', 'teal', 'lime'][i]})"></i>${MOODS[i + 1][0]}</div>`).join('')}</div></div>
              ${md.by_department.length > 1 ? `<div class="chips mt">${md.by_department.map((x) => `<span class="chip ${x.avg < 2.6 ? 'pink' : x.avg >= 4 ? 'lime' : ''}">${MOODS[Math.round(x.avg)][0]} ${esc(x.department)} ${x.avg}</span>`).join('')}</div>` : ''}
              ${md.avg < 2.6 ? `<div class="notice pink mt">${icon('alert')}Energy is low today. A coffee run or quick check-in could help.</div>` : ''}`
              : empty('heart', 'Moods appear as people check in')}
          </div>
          <div class="card ${celebrations.some((c) => c.inDays === 0) ? '' : 'm-hide'}" style="margin:0">
            <div class="card-head"><h2>Celebrations 🎈</h2><a class="btn sm light" href="#/wall">Wall</a></div>
            ${celebrationsHtml(celebrations)}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Attendance board</h2>
            <div class="actions"><div class="input-icon" style="width:200px">${icon('search')}<input id="board-q" placeholder="Search staff"></div></div></div>
          <div class="seg" id="board-seg" style="margin-bottom:10px">${Object.entries(BOARD_FILTERS)
            .map(([k, [label]]) => `<button type="button" data-k="${k}" class="${k === 'all' ? 'on' : ''}">${label}</button>`)
            .join('')}</div>
          <div id="board"></div>
        </div>

        <div class="card m-hide">
          <div class="card-head"><h2>Last 7 days</h2>
            <div class="legend"><span><i class="lime"></i>Early</span><span><i class="teal"></i>On time</span><span><i class="pink"></i>Late</span></div></div>
          <div class="bars">${o.trend
            .map((t) => {
              const h = total ? (t.present / total) * 100 : 0;
              const onT = t.present - t.late - t.early;
              const part = (n) => (t.present ? (n / t.present) * 100 : 0);
              return `<div class="col ${t.work_day ? '' : 'off'} ${t.date === o.date ? 'today' : ''}" title="${fmtDate(t.date)}: ${t.present} present">
                <b class="num">${t.present || ''}</b>
                <div class="stackbar" style="height:${Math.max(4, h)}%"><i class="lime" style="height:${part(t.early)}%"></i><i class="teal" style="height:${part(onT)}%"></i><i class="pink" style="height:${part(t.late)}%"></i></div>
                <span>${fmtDate(t.date, { weekday: 'short' })}</span></div>`;
            })
            .join('')}</div>
        </div>
      </div>

      <div class="card" style="position:sticky;top:16px">
        <div class="card-head"><h2>Live feed</h2><div class="actions"><span class="tiny muted" id="feed-upd">Updated just now</span>
          <button class="icon-btn sm" id="feed-refresh" aria-label="Refresh">${icon('refresh')}</button></div></div>
        <div class="feed" id="feed">${feedHtml(feed)}</div>
      </div>
    </div>`;

  const drawBoard = () => {
    const rows = o.rows.filter(BOARD_FILTERS[filter][1]).filter((x) => !q || x.name.toLowerCase().includes(q));
    $('#board').innerHTML = rows.length
      ? `<div class="list">${rows
          .map(
            (x) => `<div class="list-item">${avatar(x.name)}
              <div class="grow"><strong>${esc(x.name)} ${x.mood ? `<i class="mood-inline" title="Mood: ${MOODS[x.mood][1]}">${MOODS[x.mood][0]}</i>` : ''}</strong><span>${esc(x.department || x.job_title || 'Staff')}${x.mode === 'remote' ? ' · 🌍 Remote' : x.distance_m != null ? ` · ${Math.round(x.distance_m)} m away` : ''}</span></div>
              <div class="tiny muted nowrap" style="text-align:right">${x.check_in_time ? `In ${fmtTime(x.check_in_time)}` : ''}${x.check_out_time ? `<br><span class="m-sep">· </span>Out ${fmtTime(x.check_out_time)}` : ''}</div>
              ${chip(STATUS, x.status)}
              ${x.check_in_time ? `<a class="icon-btn xs" href="#/staff?id=${x.id}" aria-label="Profile">${icon('arrow')}</a>` : `<button class="icon-btn xs" data-manual="${x.id}" data-name="${esc(x.name)}" aria-label="Record manually" title="Record manually">${icon('pen')}</button>`}
            </div>`,
          )
          .join('')}</div>`
      : total
        ? empty('users', 'Nobody matches this filter')
        : empty('users', 'No employees yet', `<button class="btn sm" id="add-emp-2">${icon('plus')}Add your first employee</button>`);
    $$('#board [data-manual]').forEach((b) => (b.onclick = () => manualAttendance(b.dataset.manual, b.dataset.name, o.date, r)));
    if (filter !== 'all' || q) animateIn($('#board'));
    $('#add-emp-2')?.addEventListener('click', addEmployeeModal);
  };
  const setFilter = (k) => {
    filter = k;
    $$('#board-seg button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    $$('[data-f]').forEach((t) => t.classList.toggle('active', t.dataset.f === k));
    drawBoard();
  };
  $$('#board-seg button').forEach((b) => (b.onclick = () => setFilter(b.dataset.k)));
  $$('[data-f]').forEach((t) => (t.onclick = () => {
    setFilter(filter === t.dataset.f ? 'all' : t.dataset.f);
    $('#board').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));
  $('#board-q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); drawBoard(); };
  $('#date').onchange = (e) => go(`#/?date=${e.target.value}`);
  $('#add-emp').onclick = addEmployeeModal;
  drawBoard();

  let updated = Date.now();
  const refreshFeed = async () => {
    const f = await api('/admin/feed').catch(() => null);
    if (f && $('#feed')) {
      const before = $('#feed').firstElementChild?.outerHTML;
      $('#feed').innerHTML = feedHtml(f);
      if ($('#feed').firstElementChild?.outerHTML !== before) animateIn($('#feed'));
      updated = Date.now();
    }
  };
  $('#feed-refresh').onclick = (e) => act(e.currentTarget, refreshFeed);
  every(30000, refreshFeed);
  every(10000, () => {
    const el = $('#feed-upd');
    if (el) el.textContent = `Updated ${relTime(new Date(updated).toISOString())}`;
  });
}

function feedHtml(raw) {
  if (!raw.length) return empty('activity', 'Activity will show up here');
  // Collapse runs of identical events (e.g. several absences recorded at once) into one row.
  const feed = [];
  for (const f of raw) {
    const prev = feed[feed.length - 1];
    if (prev && prev.type === f.type && prev.name === f.name && prev.detail === f.detail && f.type === 'points') prev.times = (prev.times || 1) + 1;
    else feed.push({ ...f });
  }
  return feed
    .map((f) => {
      let ico = 'clock';
      let title = '';
      let tag = '';
      let side = '';
      if (f.type === 'checkin') {
        ico = 'pin';
        title = `Checked in ${fmtTime(f.extra)}`;
        tag = chip(STATUS, f.detail);
        side = f.amount != null ? `<span class="chip">${Math.round(f.amount)} m</span>` : '<span class="chip">Manual</span>';
      } else if (f.type === 'leave') {
        ico = 'flag';
        title = `Leave ${esc(f.extra)}`;
        tag = chip(REQ, f.detail);
        side = f.detail === 'pending' ? '<a class="chip amber" href="#/leaves">Review</a>' : '';
      } else if (f.type === 'reward') {
        ico = 'gift';
        title = `Reward ${money(f.amount)} · ${METHODS[f.extra] || ''}`;
        tag = chip(REQ, f.detail);
        side = f.detail === 'pending' ? '<a class="chip amber" href="#/rewards">Review</a>' : '';
      } else if (f.type === 'device') {
        ico = 'lock';
        title = `Blocked login from ${esc(f.extra || 'an unknown device')}`;
        tag = `<span class="chip pink">⚠️ ${f.detail === 'device_taken' ? 'Device belongs to someone else' : 'Not their device'}</span>`;
        side = '<a class="chip" href="#/employees">Staff</a>';
      } else if (f.type === 'kudos') {
        ico = 'heart';
        const [em, label, cls] = KUDOS[f.detail] || ['🙌', 'Kudos', 'lime'];
        title = `Sent kudos to ${esc(f.extra)}`;
        tag = `<span class="chip ${cls}">${em} ${label}</span>`;
      } else {
        ico = f.detail === 'green' ? 'star' : f.detail === 'red' ? 'alert' : 'ban';
        title = esc(f.extra || 'Points updated');
        tag = pointsChip(f.detail, Number(f.amount) * (f.times || 1));
        if (f.times) title += ` (×${f.times})`;
      }
      return `<div class="feed-item"><div class="when"><span class="ico">${icon(ico)}</span><span>${shortWhen(f.at)}</span></div>
        <div class="feed-card"><div class="top">${avatar(f.name, 'sm')}<div class="grow"><strong>${esc(f.name)}</strong><span>${title}</span></div></div>
        <div class="bottom">${tag}${side}</div></div></div>`;
    })
    .join('');
}

function manualAttendance(userId, name, date, r) {
  modal({
    title: `Record attendance`,
    sub: `For <strong>${esc(name)}</strong>. Use when GPS failed: it clears that day's absence. Points aren't added automatically.`,
    body: `<div class="form-grid">
        <label class="f">Date<input type="date" name="work_date" value="${date}" max="${localISODate()}" required></label>
        <label class="f">Time<input type="time" name="time" value="${r.early_end}" required></label>
        <div class="f full"><span>Status</span><div class="choice">${['early', 'on_time', 'late', 'very_late', 'off_day']
          .map((s) => `<label><input type="radio" name="status" value="${s}" ${s === 'on_time' ? 'checked' : ''}>${STATUS[s][0]}</label>`)
          .join('')}</div></div></div>`,
    submit: 'Record',
    onSubmit: async (data) => {
      await api('/admin/attendance', { method: 'POST', body: { ...data, user_id: Number(userId) } });
      toast('Attendance recorded', 'success');
      route();
    },
  });
}

// ---------- Owner: staff ----------

function addEmployeeModal() {
  modal({
    title: 'Add employee',
    sub: 'They log in with this username and password. Absences count from today (or tomorrow if check-in already closed).',
    body: `<div class="form-grid">
      <label class="f full">Full name<input name="name" required></label>
      <label class="f">Username<input name="username" pattern="[A-Za-z0-9_.@\\-]{3,40}" title="3+ letters/numbers, no spaces" autocomplete="off" required></label>
      <label class="f">Password<div class="row"><input name="password" type="text" minlength="6" autocomplete="off" required>
        <button type="button" class="icon-btn sm" id="gen-pw" title="Generate" aria-label="Generate password">${icon('refresh')}</button></div></label>
      <label class="f">Job title<input name="job_title" placeholder="e.g. Senior Designer"></label>
      <label class="f">Phone<input name="phone" inputmode="tel"></label>
      <label class="f">Department<select name="department"><option value="">—</option>${(rules().departments || []).map((d) => `<option ${false ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
      <label class="f">Birthday <span class="muted tiny">(optional)</span><input type="date" name="birthday" value="${''}"></label>
      <label class="toggle full"><input type="checkbox" name="remote_allowed" >Allow remote check-in (shoots, client visits, WFH)</label>

      <div class="f full"><span>Pay &amp; leave <span class="muted tiny">(optional: used for payroll and leave balance)</span></span>
        <div class="form-grid three">
          <label class="f">Monthly salary<input type="number" name="salary" min="0" step="any" inputmode="decimal" value="" placeholder="e.g. 12000"></label>
          <label class="f">Annual leave/yr<input type="number" name="annual_leave" min="0" max="365" value="" placeholder="${rules().annual_leave_days ?? 21}"></label>
          <label class="f">Sick leave/yr<input type="number" name="sick_leave" min="0" max="365" value="" placeholder="${rules().sick_leave_days ?? 7}"></label>
        </div></div>
      <div class="f full"><span>Role</span><div class="choice"><label><input type="radio" name="role" value="employee" checked>${icon('user')}Employee</label>
        <label><input type="radio" name="role" value="lead" >${icon('team')}Team lead <span class="muted tiny">approves their department</span></label>
        <label><input type="radio" name="role" value="owner" >${icon('key')}Owner</label></div></div></div>`,
    submit: 'Add employee',
    onSubmit: async (data) => {
      await api('/admin/users', { method: 'POST', body: { ...data, remote_allowed: !!data.remote_allowed } });
      confetti({ count: 80 });
      staffCache = null;
      toast(`${data.name} added. Share: @${data.username} / ${data.password}`, 'success');
      route();
    },
  });
  $('#gen-pw').onclick = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    $('#modal [name=password]').value = Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => chars[n % chars.length]).join('');
  };
}

async function viewStaff(params) {
  const [users, st] = await Promise.all([api('/admin/users'), api('/admin/settings')]);
  cachedRules = st;
  staffCache = users;
  let show = params.get('show') || 'active';
  let q = '';
  $('#app').innerHTML = `
    ${pageHead('Staff', `${users.filter((u) => u.active && u.role !== 'owner').length} active employees`, `<button class="btn" id="add">${icon('plus')}Add employee</button>`)}
    <div class="card" style="margin-bottom:16px"><div class="row wrap between">
      <div class="input-icon" style="flex:1;min-width:200px;max-width:360px">${icon('search')}<input id="q" placeholder="Search by name, job, department"></div>
      <div class="seg" id="show">${['active', 'inactive', 'all'].map((s) => `<button type="button" data-s="${s}" class="${s === show ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
    </div></div>
    <div class="cards-grid" id="staff"></div>`;
  const draw = () => {
    const list = users
      .filter((u) => (show === 'all' ? true : show === 'active' ? u.active : !u.active))
      .filter((u) => !q || `${u.name} ${u.username} ${u.job_title || ''} ${u.department || ''}`.toLowerCase().includes(q));
    $('#staff').innerHTML = list.length
      ? list
          .map(
            (u) => `<div class="card" style="margin:0">
              <div class="row">${avatar(u.name, 'lg')}<div style="min-width:0;flex:1"><strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name)}</strong>
                <span class="muted small">${u.role === 'owner' ? 'Owner' : u.role === 'lead' ? `⭐ Team lead${u.job_title ? ` · ${esc(u.job_title)}` : ''}` : esc(u.job_title || 'Employee')}</span></div>
                ${u.active ? '<span class="chip lime"><span class="dot"></span>Active</span>' : '<span class="chip slate">Inactive</span>'}</div>
              <div class="muted small mt row wrap" style="gap:14px"><span class="row" style="gap:6px">${icon('at')}${esc(u.username)}</span>${u.phone ? `<span class="row" style="gap:6px">${icon('phone')}${esc(u.phone)}</span>` : ''}</div>
              ${u.department || u.remote_allowed ? `<div class="chips mt">${u.department ? `<span class="chip dept-chip">${esc(u.department)}</span>` : ''}${u.remote_allowed ? '<span class="chip sky">🌍 Remote OK</span>' : ''}</div>` : ''}
              ${u.role !== 'owner' ? `<div class="chips mt">${['mobile', 'desktop'].map((k) => {
                const d = (u.devices || []).find((x) => x.kind === k);
                const em = k === 'mobile' ? '📱' : '💻';
                return d
                  ? `<span class="chip teal" title="Linked ${relTime(d.bound_at)}${d.last_seen_at ? ` · last used ${relTime(d.last_seen_at)}` : ''}">${em} ${esc(d.label || 'Linked')}</span>`
                  : `<span class="chip">${em} ${k === 'mobile' ? 'No phone yet' : 'No laptop yet'}</span>`;
              }).join('')}${Number(u.device_blocks) ? `<span class="chip pink" title="Blocked login attempts in the last 30 days">⚠️ ${u.device_blocks} blocked</span>` : ''}</div>` : ''}
              ${u.role !== 'owner' && u.salary == null ? `<div class="chips mt"><button type="button" class="chip amber" data-edit="${u.id}">💰 Add salary for payroll</button></div>` : ''}
              ${u.balances ? `<div class="chips mt"><span class="chip lime">${u.balances.green} green</span><span class="chip pink">${u.balances.month.red} red</span><span class="chip dark">${u.balances.month.black} black</span></div>` : ''}
              <div class="row mt" style="gap:6px">
                ${u.role !== 'owner' ? `<a class="btn sm" href="#/staff?id=${u.id}">${icon('activity')}Profile</a>` : ''}
                <button class="btn sm light" data-edit="${u.id}">${icon('pen')}Edit</button>
                ${u.role !== 'owner' && (u.devices || []).length ? `<button class="icon-btn sm" data-reset-dev="${u.id}" aria-label="Reset device" title="Reset device">${icon('phoneLock')}</button>` : ''}
                ${u.id !== me.id ? `<button class="icon-btn sm" data-toggle="${u.id}" aria-label="${u.active ? 'Deactivate' : 'Activate'}" title="${u.active ? 'Deactivate' : 'Activate'}">${icon(u.active ? 'ban' : 'check')}</button>` : ''}
              </div></div>`,
          )
          .join('')
      : `<div class="card" style="grid-column:1/-1">${empty('users', 'No staff found')}</div>`;
    $$('[data-edit]').forEach((b) => (b.onclick = () => editEmployee(users.find((x) => x.id === Number(b.dataset.edit)))));
    $$('[data-reset-dev]').forEach((b) => (b.onclick = () => {
      const u = users.find((x) => x.id === Number(b.dataset.resetDev));
      const has = (k) => (u.devices || []).find((d) => d.kind === k);
      modal({
        title: `Reset ${u.name}'s device`,
        sub: 'Use this when they change phones or laptops. They are signed out on that device, and the next one they sign in from gets registered.',
        body: `<div class="choice">
          ${has('mobile') ? `<label><input type="radio" name="which" value="mobile" checked>📱 Phone · ${esc(has('mobile').label || '')}</label>` : ''}
          ${has('desktop') ? `<label><input type="radio" name="which" value="desktop" ${has('mobile') ? '' : 'checked'}>💻 Laptop · ${esc(has('desktop').label || '')}</label>` : ''}
          ${has('mobile') && has('desktop') ? '<label><input type="radio" name="which" value="all">Both</label>' : ''}</div>`,
        submit: 'Reset',
        danger: true,
        onSubmit: async (d) => {
          await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { reset_device: d.which === 'all' ? true : d.which } });
          toast('Device reset. They can sign in from the new device now', 'success');
          route();
        },
      });
    }));
    $$('[data-toggle]').forEach((b) => (b.onclick = () => {
      const u = users.find((x) => x.id === Number(b.dataset.toggle));
      const run = async () => {
        await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } });
        staffCache = null;
        toast(u.active ? `${u.name} deactivated` : `${u.name} activated`, 'success');
        route();
      };
      u.active ? confirmBox(`Deactivate ${u.name}?`, 'They will be logged out and can no longer check in. You can re-activate them any time.', run, { submit: 'Deactivate' }) : act(b, run);
    }));
  };
  $('#q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  $$('#show button').forEach((b) => (b.onclick = () => {
    show = b.dataset.s;
    $$('#show button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  $('#add').onclick = addEmployeeModal;
  draw();
}

function editEmployee(u) {
  modal({
    title: `Edit ${u.name}`,
    body: `<div class="form-grid">
      <label class="f full">Full name<input name="name" value="${esc(u.name)}" required></label>
      <label class="f">Job title<input name="job_title" value="${esc(u.job_title || '')}"></label>
      <label class="f">Phone<input name="phone" value="${esc(u.phone || '')}"></label>
      <label class="f">Department<select name="department"><option value="">—</option>${(rules().departments || []).map((d) => `<option ${u.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
      <label class="f">Birthday <span class="muted tiny">(optional)</span><input type="date" name="birthday" value="${esc(u.birthday || '')}"></label>
      <label class="toggle full"><input type="checkbox" name="remote_allowed" ${u.remote_allowed ? 'checked' : ''}>Allow remote check-in (shoots, client visits, WFH)</label>
      <label class="f">Absences counted from<input type="date" name="start_date" value="${esc(u.start_date)}"></label>
      <label class="f">New password <span class="muted tiny">(leave empty to keep)</span><input name="password" type="text" minlength="6" autocomplete="off"></label>
      <div class="f full"><span>Pay &amp; leave <span class="muted tiny">(optional: used for payroll and leave balance)</span></span>
        <div class="form-grid three">
          <label class="f">Monthly salary<input type="number" name="salary" min="0" step="any" inputmode="decimal" value="${u.salary ?? ''}" placeholder="e.g. 12000"></label>
          <label class="f">Annual leave/yr<input type="number" name="annual_leave" min="0" max="365" value="${u.annual_leave ?? ''}" placeholder="${rules().annual_leave_days ?? 21}"></label>
          <label class="f">Sick leave/yr<input type="number" name="sick_leave" min="0" max="365" value="${u.sick_leave ?? ''}" placeholder="${rules().sick_leave_days ?? 7}"></label>
        </div></div>
      ${u.id === me.id ? '' : `<div class="f full"><span>Role</span><div class="choice"><label><input type="radio" name="role" value="employee" ${u.role === 'employee' ? 'checked' : ''}>${icon('user')}Employee</label>
        <label><input type="radio" name="role" value="lead" ${u.role === 'lead' ? 'checked' : ''}>${icon('team')}Team lead <span class="muted tiny">approves their department</span></label>
        <label><input type="radio" name="role" value="owner" ${u.role === 'owner' ? 'checked' : ''}>${icon('key')}Owner</label></div></div>`}</div>`,
    onSubmit: async (data) => {
      if (!data.password) delete data.password;
      data.remote_allowed = !!data.remote_allowed;
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: data });
      staffCache = null;
      toast('Saved', 'success');
      route();
    },
  });
}

async function viewStaffProfile(params) {
  const id = Number(params.get('id'));
  const [users, { h, leaves, month }, o] = await Promise.all([api('/admin/users'), viewHistory(params, id), api('/admin/overview')]);
  const u = users.find((x) => x.id === id);
  if (!u) throw new Error('Employee not found');
  cachedRules = o.rules;
  const r = o.rules;
  const b = h.balances;
  $('#app').innerHTML = `
    ${pageHead(esc(u.name), `${esc(u.job_title || 'Employee')} · ${fmtMonth(month)}`, `${monthInput(month, `#/staff?id=${id}`)}
      <button class="btn light" id="edit">${icon('pen')}Edit</button><button class="btn" id="adjust">${icon('star')}Adjust points</button>`)}
    <div class="dash">
      <div class="stack-col">
        <div class="card">
          <div class="profile">
            <div class="photo ${hue(u.name)}">${esc(initials(u.name))}</div>
            <div class="meta"><div><h2>${esc(u.name)}</h2><p class="muted small">${esc(u.job_title || 'Employee')} · since ${fmtDate(u.start_date, { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
              <div class="info"><span>${icon('at')}@${esc(u.username)}</span><span>${icon('phone')}${esc(u.phone || '—')}</span>
              <span>${icon('star')}${b.green} green balance</span><span>${u.active ? `${icon('check')}Active` : `${icon('ban')}Inactive`}</span></div></div>
          </div>
          <div class="kpis">
            ${kpi('Days present', h.attendance.length, 'teal', Math.min(100, h.attendance.length * 4))}
            ${kpi('Red / Black', `${b.month.red} / ${b.month.black}`, 'pink', Math.min(100, (b.month.red + b.month.black) * 15))}
            ${kpi('Deduction', money(Math.max(0, b.month.red) * r.red_value + Math.max(0, b.month.black) * r.black_value), 'lime', 50)}
          </div>
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>Calendar</h2></div>
        ${calendar(month, { attendance: h.attendance, points: h.points, leaves, workDays: r.work_days, startDate: u.start_date, today: o.now.date })}</div>
    </div>
    ${historyLists(h)}`;
  $('#edit').onclick = () => editEmployee(u);
  $('#adjust').onclick = () => go(`#/points?user=${id}`);
}

// ---------- Owner: points ----------

async function viewPoints() {
  const { params } = parseHash();
  const [users, log, s] = await Promise.all([api('/admin/users'), api('/admin/points'), api('/admin/settings')]);
  cachedRules = s;
  const staff = users.filter((u) => u.role !== 'owner' && u.active);
  const pre = params.get('user');
  $('#app').innerHTML = `
    ${pageHead('Points', 'Reward great work or record penalties. Every change needs a reason.')}
    <div class="dash">
      <div class="card">
        <div class="card-head"><h2>Owner — adjust points</h2></div>
        <form id="adjust" class="grid" style="gap:16px">
          <label class="f">Employee<select name="user_id" required><option value="">Choose…</option>${staff
            .map((u) => `<option value="${u.id}" ${String(u.id) === pre ? 'selected' : ''}>${esc(u.name)}</option>`)
            .join('')}</select></label>
          <div class="f"><span>Action</span><div class="choice"><label><input type="radio" name="action" value="add" checked>${icon('plus')}Add</label><label><input type="radio" name="action" value="remove">${icon('minus')}Remove</label></div></div>
          <div class="f"><span>Type</span><div class="grid g3">
            ${['green', 'red', 'black'].map((k, i) => `<label class="tile ${KIND[k][1]}" style="min-height:90px;cursor:pointer"><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''} style="position:absolute;opacity:0">
              <span class="t-title">${KIND[k][0]}</span><span class="t-sub">${money(k === 'green' ? s.green_value : k === 'red' ? s.red_value : s.black_value)}</span></label>`).join('')}
          </div></div>
          <div class="form-grid">
            <label class="f">Points<input type="number" name="count" min="1" max="100" value="1" required></label>
            <label class="f">For date<input type="date" name="work_date" value="${localISODate()}" required></label>
          </div>
          <label class="f">Reason<input name="reason" maxlength="300" required placeholder="Reason is required"></label>
          <div class="chips" id="reasons">${['Great customer feedback', 'Extra hours', 'Helped a teammate', 'Policy violation', 'Left early without permission'].map((t) => `<button type="button" class="chip">${t}</button>`).join('')}</div>
          <div class="notice sky" id="effect"></div>
          <button class="btn xl block" type="submit">${icon('check')}Apply</button>
        </form>
      </div>
      <div class="card"><div class="card-head"><h2>Recent changes</h2>
        <select id="log-user" style="width:170px"><option value="">Everyone</option>${staff.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>
        <div id="log" class="feed"></div></div>
    </div>`;
  const drawLog = (rows) => {
    $('#log').innerHTML = rows.length
      ? `<div class="list">${rows
          .map(
            (p) => `<div class="list-item">${avatar(p.user_name, 'sm')}<div class="grow"><strong>${esc(p.user_name)}</strong>
              <span>${esc(SOURCE[p.source] || p.source)}${p.reason ? ` · ${esc(p.reason)}` : ''} · ${fmtDate(p.work_date)}${p.created_by_name ? ` · by ${esc(p.created_by_name)}` : ''}</span></div>${pointsChip(p.kind, p.delta)}</div>`,
          )
          .join('')}</div>`
      : empty('star', 'No points yet');
  };
  drawLog(log);
  $('#log-user').onchange = async (e) => drawLog(await api(`/admin/points${e.target.value ? `?user_id=${e.target.value}` : ''}`));
  const form = $('#adjust');
  const update = () => {
    const n = Number(form.count.value) || 0;
    const add = form.action.value === 'add';
    const k = form.kind.value;
    $$('.tile', form).forEach((t) => t.classList.toggle('active', $('input', t).checked));
    const value = k === 'green' ? s.green_value : k === 'red' ? s.red_value : s.black_value;
    const name = form.user_id.selectedOptions[0]?.value ? form.user_id.selectedOptions[0].text : 'the employee';
    $('#effect').innerHTML = `${icon('alert')}<span>${add ? 'Add' : 'Remove'} <strong>${n} ${KIND[k][0].toLowerCase()}</strong> ${add ? 'to' : 'from'} ${esc(name)}: ${
      k === 'green' ? `${add ? '+' : '−'}${money(n * value)} reward value` : `${add ? '+' : '−'}${money(n * value)} deduction`
    }</span>`;
  };
  form.oninput = update;
  form.onchange = update;
  $$('#reasons .chip').forEach((b) => (b.onclick = () => { form.reason.value = b.textContent; }));
  update();
  form.onsubmit = (e) => {
    e.preventDefault();
    const d = formData(form);
    act(e.submitter, async () => {
      await api('/admin/points', { method: 'POST', body: { user_id: Number(d.user_id), kind: d.kind, delta: (d.action === 'add' ? 1 : -1) * Number(d.count), reason: d.reason, work_date: d.work_date } });
      form.reason.value = '';
      drawLog(await api('/admin/points'));
    }, 'Points updated');
  };
}

// ---------- Owner: requests ----------

function statusSeg(base, active, opts) {
  return `<div class="seg">${['', ...opts]
    .map((s) => `<a href="#/${base}${s ? `?status=${s}` : ''}" class="${s === active ? 'on' : ''}">${s ? REQ[s][0] : 'All'}</a>`)
    .join('')}</div>`;
}

async function viewLeaveRequests(params, base = 'leaves') {
  const status = params.get('status') ?? 'pending';
  const list = await api(`/admin/leaves${status ? `?status=${status}` : ''}`);
  $('#app').innerHTML = `
    ${pageHead(me.role === 'lead' ? `Team leave · ${esc(me.department || '')}` : 'Leave requests', 'Approved leave removes absences for those days.', statusSeg(base, status, ['pending', 'approved', 'rejected', 'cancelled']))}
    <div class="cards-grid">${
      list.length
        ? list
            .map(
              (l) => `<div class="card" style="margin:0">
                <div class="row">${avatar(l.user_name)}<div class="grow" style="flex:1;min-width:0"><strong>${esc(l.user_name)}</strong><div class="tiny muted">${l.department ? `${esc(l.department)} · ` : ''}${relTime(l.created_at)}</div></div>${chip(REQ, l.status)}</div>
                <div class="tile ${l.type === 'sick' ? 'sky' : l.type === 'unpaid' ? 'slate' : 'amber'} mt" style="min-height:auto"><div class="row between"><div><div class="t-sub">${LEAVE_TYPES[l.type]?.[0] || ''} ${LEAVE_TYPES[l.type]?.[1] || 'Leave'}</div><strong>${fmtDate(l.from_date)} → ${fmtDate(l.to_date)}</strong></div>
                  <div class="t-num num">${daysBetween(l.from_date, l.to_date) + 1}d</div></div></div>
                <p class="small mt" style="color:var(--ink-2)">${l.reason ? esc(l.reason) : '<span class="muted">No reason given</span>'}</p>
                ${l.decided_by_name && l.status !== 'pending' ? `<p class="tiny muted">${l.status === 'approved' ? 'Approved' : 'Decided'} by ${esc(l.decided_by_name)}</p>` : ''}
                ${l.status === 'pending' ? `<div class="row mt"><button class="btn sm green" data-id="${l.id}" data-d="approve">${icon('check')}Approve</button>
                  <button class="btn sm light" data-id="${l.id}" data-d="reject">${icon('x')}Reject</button></div>` : ''}
              </div>`,
            )
            .join('')
        : `<div class="card" style="grid-column:1/-1">${empty('flag', status === 'pending' ? 'No pending leave requests. All clear!' : 'Nothing here')}</div>`
    }</div>`;
  $$('[data-d]').forEach((b) => (b.onclick = () => act(b, async () => {
    await api(`/admin/leaves/${b.dataset.id}/decision`, { method: 'POST', body: { decision: b.dataset.d } });
    await refreshCounts();
    route();
  }, b.dataset.d === 'approve' ? 'Leave approved' : 'Leave rejected')));
}

async function viewRewardRequests(params) {
  const status = params.get('status') ?? 'pending';
  const [list, s] = await Promise.all([api(`/admin/rewards${status ? `?status=${status}` : ''}`), api('/admin/settings')]);
  cachedRules = s;
  const total = list.filter((x) => x.status === 'pending').reduce((a, x) => a + x.amount, 0);
  $('#app').innerHTML = `
    ${pageHead('Reward requests', total ? `${money(total)} waiting to be paid` : 'Points are reserved when requested and returned if rejected.', statusSeg('rewards', status, ['pending', 'paid', 'rejected', 'cancelled']))}
    <div class="cards-grid">${
      list.length
        ? list
            .map(
              (x) => `<div class="card" style="margin:0">
                <div class="row">${avatar(x.user_name)}<div style="flex:1;min-width:0"><strong>${esc(x.user_name)}</strong><div class="tiny muted">${relTime(x.created_at)}</div></div>${chip(REQ, x.status)}</div>
                <div class="tile lime mt" style="min-height:auto"><div class="row between"><div><div class="t-sub">${x.points} green points</div><div class="t-big num" style="font-size:1.6rem">${money(x.amount)}</div></div>${icon('gift')}</div></div>
                <div class="list-item" style="border:0;padding-inline:0">${icon(x.method === 'cash' ? 'wallet' : 'phone')}<div class="grow"><strong>${METHODS[x.method]}</strong><span class="num">${esc(x.payout_number || 'Pay in person')}</span></div>
                  ${x.payout_number ? `<button class="icon-btn xs" data-copy="${esc(x.payout_number)}" aria-label="Copy number" title="Copy">${icon('copy')}</button>` : ''}</div>
                ${x.status === 'pending' ? `<div class="row"><button class="btn sm green" data-id="${x.id}" data-d="paid">${icon('check')}Mark paid</button>
                  <button class="btn sm light" data-id="${x.id}" data-d="reject">${icon('x')}Reject</button></div>` : ''}
              </div>`,
            )
            .join('')
        : `<div class="card" style="grid-column:1/-1">${empty('gift', status === 'pending' ? 'No pending reward requests' : 'Nothing here')}</div>`
    }</div>`;
  $$('[data-copy]').forEach((b) => (b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Number copied', 'success'); } catch { toast('Copy failed', 'error'); }
  }));
  $$('[data-d]').forEach((b) => (b.onclick = () => {
    const run = async () => {
      await api(`/admin/rewards/${b.dataset.id}/decision`, { method: 'POST', body: { decision: b.dataset.d } });
      await refreshCounts();
      toast(b.dataset.d === 'paid' ? 'Marked as paid' : 'Rejected, points returned', 'success');
      route();
    };
    b.dataset.d === 'paid' ? confirmBox('Mark as paid?', 'Confirm you have transferred the money. The employee will be notified.', run, { submit: 'Yes, paid', danger: false }) : act(b, run);
  }));
}

// ---------- Owner: report ----------

async function viewReport(params) {
  const month = params.get('month') || thisMonth();
  const [rep, s] = await Promise.all([api(`/admin/report?month=${month}`), api('/admin/settings')]);
  cachedRules = s;
  const dept = params.get('dept') || '';
  const depts = [...new Set(rep.rows.map((r) => r.department).filter(Boolean))].sort();
  rep.rows = rep.rows.filter((r) => !dept || r.department === dept);
  const sum = (k) => rep.rows.reduce((a, r) => a + r[k], 0);
  setTimeout(() => {
    const el = $('#dept');
    if (el) el.onchange = (e) => go(`#/reports?month=${month}${e.target.value ? `&dept=${encodeURIComponent(e.target.value)}` : ''}`);
  });
  $('#app').innerHTML = `
    ${pageHead('Monthly report', fmtMonth(month), `${depts.length ? `<select id="dept" style="width:180px"><option value="">All departments</option>${depts.map((d) => `<option ${d === dept ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>` : ''}${monthInput(month, '#/reports')}
      <button class="btn light" onclick="window.print()">${icon('printer')}Print</button>
      <a class="btn" href="/api/admin/report.csv?month=${month}">${icon('download')}Export CSV</a>`)}
    <div class="grid g4" style="margin-bottom:16px">
      ${tile('pink', 'Total deductions', money(sum('total_deduction')), `${sum('red')} red · ${sum('black')} black`, { arrow: false })}
      ${tile('teal', 'Days present', sum('days_present'), `${sum('late')} late arrivals`, { big: true, arrow: false })}
      ${tile('lime', 'Green earned', sum('green_month'), `${sum('early')} early check-ins`, { big: true, arrow: false })}
      ${tile('amber', 'Leave days', sum('leave_days'), 'approved', { big: true, arrow: false })}
    </div>
    <div class="card">${
      rep.rows.length
        ? `<div class="table-wrap"><table class="stack"><thead><tr><th>Employee</th><th>Present</th><th>Early</th><th>On time</th><th>Late</th><th>Leave</th><th>Hours</th><th>Green</th><th>Red</th><th>Black</th><th>Deduction</th></tr></thead><tbody>
          ${rep.rows
            .map(
              (r) => `<tr><td><a href="#/staff?id=${r.user_id}&month=${month}" style="text-decoration:none" class="row">${avatar(r.name, 'sm')}<span><strong>${esc(r.name)}</strong>${r.active ? '' : ' <span class="chip slate">Inactive</span>'}<div class="tiny muted">${esc(r.department || '')}</div></span></a></td>
                <td class="num" data-label="Present">${r.days_present}</td><td class="num" data-label="Early">${r.early}</td><td class="num" data-label="On time">${r.on_time}</td><td class="num" data-label="Late">${r.late}</td><td class="num" data-label="Leave">${r.leave_days}</td>
                <td class="num nowrap" data-label="Hours">${fmtHours(r.worked_minutes)}${r.overtime_minutes ? `<div class="tiny" style="color:var(--green)">+${fmtHours(r.overtime_minutes)} OT</div>` : ''}</td>
                <td data-label="Green"><span class="chip lime num">${r.green_month}</span></td><td data-label="Red"><span class="chip pink num">${r.red}</span></td><td data-label="Black"><span class="chip dark num">${r.black}</span></td>
                <td class="num strong td-total" data-label="Deduction">${money(r.total_deduction)}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : empty('chart', 'No employees yet')
    }</div>`;
}

// ---------- Owner: settings ----------

let reopenSections = null; // sections to keep open when the page re-renders after saving
async function viewSettings() {
  const [s, dr] = await Promise.all([api('/admin/settings'), api('/admin/drive').catch(() => null)]);
  const hp = parseHash().params;
  if (hp.get('drive') === 'connected') { setTimeout(() => { confetti({ count: 90 }); toast('Google Drive connected. Teams can upload files to tasks now 🎉', 'success'); }); reopenSections = ['files']; }
  if (hp.get('drive') === 'error') { setTimeout(() => toast(hp.get('msg') || 'Google Drive could not be connected', 'error')); reopenSections = ['files']; }
  if (hp.get('open')) reopenSections = [hp.get('open')];
  if (hp.get('drive') || hp.get('open')) history.replaceState(null, '', '#/settings');
  cachedRules = s;
  const mapLink = s.office_lat != null ? `https://www.google.com/maps?q=${s.office_lat},${s.office_lng}` : '';
  const timeField = (name, label, color) => `<label class="f"><span class="row" style="gap:6px"><span class="dot" style="width:8px;height:8px;border-radius:50%;background:var(--${color})"></span>${label}</span><input type="time" name="${name}" value="${s[name]}" required></label>`;
  const daysShort = s.work_days.slice().sort((x, y) => ((x + 1) % 7) - ((y + 1) % 7)).map((d) => DAYS[d].slice(0, 2)).join(' ');
  // Collapsible sections with a one-line summary of the current values, so the page stays short.
  const sec = (key, emoji, title, summary, body, open = false) => `
    <details class="card set-sec" data-sec="${key}" ${(reopenSections ? reopenSections.includes(key) : open) ? 'open' : ''}>
      <summary><span class="set-ico">${emoji}</span><span class="set-title"><strong>${title}</strong><span class="muted small" data-sum="${key}">${summary}</span></span>
        <span class="set-chev">${icon('chevron')}</span></summary>
      <div class="set-body">${body}</div>
    </details>`;
  $('#app').innerHTML = `
    ${pageHead('Settings', 'Tap a section to edit it. Changes apply to everyone after saving.')}
    <form id="settings" class="grid" style="gap:12px">
      ${sec('loc', '📍', 'Office location',
        s.office_lat == null ? '<span style="color:var(--red)">Not set: staff can\'t check in yet</span>' : `${Number(s.office_lat).toFixed(4)}, ${Number(s.office_lng).toFixed(4)} · ${s.radius_m} m radius`,
        `<div class="row between wrap" style="margin-bottom:12px"><span class="chip ${s.office_lat == null ? 'amber' : 'lime'}" id="loc-status">${s.office_lat == null ? 'Not set yet' : 'Set'}</span>
          ${mapLink ? `<a class="btn sm light" href="${mapLink}" target="_blank" rel="noopener">${icon('pin')}Open in Google Maps</a>` : ''}</div>
        <div class="loc-grid">
          <div class="map-wrap"><div id="map"><div class="empty" style="height:100%;justify-content:center">${icon('pin')}Loading map…</div></div>
            <p class="muted tiny" style="margin-top:6px">Tap the map or drag the pin to the office entrance. The circle is the allowed check-in area.</p></div>
          <div class="grid" style="gap:14px;align-content:start">
            <div class="f"><span>Search an address</span>
              <div class="input-icon">${icon('search')}<input id="loc-search" placeholder="e.g. Bahr Network, Hurghada"></div>
              <div id="loc-results" class="list"></div></div>
            <div class="f"><span>Or paste a Google Maps link</span>
              <div class="row"><input id="loc-link" placeholder="https://maps.app.goo.gl/…"><button class="btn sm light" type="button" id="loc-link-go">Use</button></div></div>
            <button class="btn light" type="button" id="use-loc">${icon('pin')}Use my current location</button>
            <div class="form-grid two">
              <label class="f">Latitude<input name="office_lat" value="${s.office_lat ?? ''}" inputmode="decimal"></label>
              <label class="f">Longitude<input name="office_lng" value="${s.office_lng ?? ''}" inputmode="decimal"></label>
            </div>
            <label class="f">Allowed radius: <strong id="radius-label">${s.radius_m} m</strong>
              <input type="range" id="radius-range" min="20" max="1000" step="10" value="${Math.min(1000, s.radius_m)}" style="height:auto;padding:0;accent-color:var(--green)">
              <input type="hidden" name="radius_m" value="${s.radius_m}"></label>
            <div class="form-grid two">
              <button class="btn block" type="button" id="save-loc">${icon('check')}Save location</button>
              <button class="btn light block" type="button" id="test-loc">${icon('activity')}Test distance</button>
            </div>
          </div>
        </div>`, s.office_lat == null)}

      ${sec('times', '⏰', 'Check-in times', `Early ${fmtTime(s.early_start)}–${fmtTime(s.early_end)} · Closes ${fmtTime(s.close)} · ${daysShort}`,
        `<div id="track-preview"></div>
        <div class="form-grid two mt">
          ${timeField('early_start', 'Early from', 'lime')}${timeField('early_end', 'Early until', 'lime')}
          ${timeField('late_after', 'Late after', 'pink')}${timeField('very_late_after', 'Very late after', 'pink')}
          ${timeField('close', 'Check-in closes', 'black')}
          <label class="f">Reds when very late<input type="number" name="very_late_reds" value="${s.very_late_reds}" min="1" max="10" required></label>
        </div>
        <div class="f mt"><span>Work days <span class="muted tiny">(missing one without leave = black point)</span></span>
          <div class="choice days">${DAYS.map((d, i) => `<label><input type="checkbox" name="wd" value="${i}" ${s.work_days.includes(i) ? 'checked' : ''}>${d.slice(0, 3)}</label>`).join('')}</div></div>
        <label class="f mt">Max GPS uncertainty (m) <span class="muted tiny">Less precise readings are rejected. 100–200 m suits most phones.</span>
          <input type="number" name="max_accuracy_m" value="${s.max_accuracy_m}" min="5" required></label>`)}

      ${sec('money', '💰', 'Money rules', `Red ${money(s.red_value)} · Black ${money(s.black_value)} · Green ${money(s.green_value)}`,
        `<div class="grid g2 money-grid">
          <label class="tile pink"><span class="t-title">🔴 Red penalty</span><input type="number" name="red_value" value="${s.red_value}" min="0" required></label>
          <label class="tile dark"><span class="t-title">⚫ Black absence</span><input type="number" name="black_value" value="${s.black_value}" min="0" required></label>
          <label class="tile lime"><span class="t-title">🟢 Green point value</span><input type="number" name="green_value" value="${s.green_value}" min="0" required></label>
          <label class="tile teal"><span class="t-title">🎁 Min. points per reward</span><input type="number" name="min_reward_points" value="${s.min_reward_points}" min="1" required></label>
        </div>`)}

      ${sec('hours', '🕘', 'Working hours & schedules', `${s.daily_hours} h/day · overtime ×${s.overtime_rate}${Object.keys(s.dept_schedules || {}).length ? ` · ${Object.keys(s.dept_schedules).length} custom schedule${Object.keys(s.dept_schedules).length === 1 ? '' : 's'}` : ''}`,
        `<div class="form-grid two">
          <label class="f">Work hours per day <span class="muted tiny">(beyond this = overtime)</span><input type="number" name="daily_hours" value="${s.daily_hours}" min="1" max="24" step="0.5" required></label>
          <label class="f">Overtime pay rate <span class="muted tiny">(× hourly rate)</span><input type="number" name="overtime_rate" value="${s.overtime_rate}" min="0" max="10" step="0.05" required></label>
        </div>
        <div class="f mt"><span>Department schedules <span class="muted tiny">Give a team its own hours and days (e.g. video crews starting later). Others follow the company times above.</span></span>
          <div class="grid" style="gap:8px" id="dept-sch">${s.departments.map((dep) => {
            const own = (s.dept_schedules || {})[dep];
            const v = own || { early_start: s.early_start, early_end: s.early_end, late_after: s.late_after, very_late_after: s.very_late_after, close: s.close, work_days: s.work_days, daily_hours: s.daily_hours };
            const t = (k, label) => `<label class="f"><span>${label}</span><input type="time" data-k="${k}" value="${v[k]}"></label>`;
            return `<details class="dept-sch" data-dept="${esc(dep)}" ${own ? 'open' : ''}>
              <summary><span class="chip dept-chip">${esc(dep)}</span><span class="muted small grow">${own ? `${fmtTime(own.early_start)}–${fmtTime(own.close)} · ${own.work_days.length} days · ${own.daily_hours} h` : 'Company schedule'}</span>
                <label class="toggle" onclick="event.stopPropagation()"><input type="checkbox" data-own ${own ? 'checked' : ''}></label></summary>
              <div class="form-grid three mt">${t('early_start', 'Early from')}${t('early_end', 'Early until')}${t('late_after', 'Late after')}${t('very_late_after', 'Very late after')}${t('close', 'Closes')}
                <label class="f"><span>Hours/day</span><input type="number" data-k="daily_hours" value="${v.daily_hours}" min="1" max="24" step="0.5"></label></div>
              <div class="choice days mt">${DAYS.map((d, i) => `<label><input type="checkbox" data-wd value="${i}" ${v.work_days.includes(i) ? 'checked' : ''}>${d.slice(0, 3)}</label>`).join('')}</div>
            </details>`;
          }).join('')}</div></div>`)}

      ${sec('leave', '🏖️', 'Leave & payroll', `${s.annual_leave_days} annual · ${s.sick_leave_days} sick days a year`,
        `<div class="form-grid two">
          <label class="f">Annual leave days per year<input type="number" name="annual_leave_days" value="${s.annual_leave_days}" min="0" max="365" required></label>
          <label class="f">Sick leave days per year<input type="number" name="sick_leave_days" value="${s.sick_leave_days}" min="0" max="365" required></label>
        </div>
        <p class="muted tiny" style="margin-top:6px">You can give someone a different allowance from Staff → Edit. Unpaid leave has no limit and is deducted from salary (salary ÷ work days in the month).</p>
        <div class="row between mt" style="gap:14px;align-items:flex-start">
          <div><strong>Add paid rewards to the payslip</strong><p class="muted small" style="margin-top:4px">Off: rewards are paid separately (InstaPay, wallet, cash) and only shown on the slip. On: they're added to net pay.</p></div>
          <label class="toggle"><input type="checkbox" name="payroll_add_rewards" ${s.payroll_add_rewards ? 'checked' : ''}></label></div>
        <div class="row wrap mt" style="gap:8px"><a class="btn sm light" href="#/payroll">${icon('receipt')}Open payroll</a><a class="btn sm light" href="#/holidays">${icon('party')}Official holidays</a></div>`)}

      ${sec('team', '🤝', 'Team & culture', `${s.departments.length} departments · ${s.kudos_daily_limit} kudos/day`,
        `<div class="f"><span>Departments</span><div class="chips" id="depts">${s.departments.map((d) => `<span class="chip dept-chip" data-dept="${esc(d)}">${esc(d)} <button type="button" class="icon-btn xs ghost" style="width:20px;height:20px" aria-label="Remove">${icon('x')}</button></span>`).join('')}</div>
          <div class="row mt"><input id="new-dept" placeholder="Add a department, e.g. SEO"><button class="btn sm light" type="button" id="add-dept">${icon('plus')}Add</button></div></div>
        <label class="f mt">Account managers department <span class="muted tiny">Its members can send tasks to every department</span>
          <select name="am_department"><option value="">Nobody (only owners and leads create tasks)</option>${s.departments.map((d) => `<option ${d === s.am_department ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
        <div class="form-grid two mt">
          <label class="f">Kudos per person per day<input type="number" name="kudos_daily_limit" value="${s.kudos_daily_limit}" min="0" max="50" required></label>
          <label class="f">Green points per kudos <span class="muted tiny">(0 = none)</span><input type="number" name="kudos_green" value="${s.kudos_green}" min="0" max="10" required></label>
        </div>`)}

      ${sec('security', '🔒', 'Security', s.device_lock ? 'Device lock on · 1 phone + 1 laptop per employee' : 'Device lock off',
        `<div class="row between" style="gap:14px;align-items:flex-start">
          <div><strong>Lock employees to their devices</strong><p class="muted small" style="margin-top:4px">Each employee can use one phone and one laptop (the first ones they sign in from), and a device can't be shared between employees. Owners can sign in from anywhere.</p></div>
          <label class="toggle"><input type="checkbox" name="device_lock" ${s.device_lock ? 'checked' : ''}></label></div>`)}

      ${sec('data', '💾', 'Reports & backup', s.weekly_summary ? 'Weekly summary every Thursday · Excel backup' : 'Weekly summary off · Excel backup',
        `<div class="row between" style="gap:14px;align-items:flex-start">
          <div><strong>Weekly summary notification</strong><p class="muted small" style="margin-top:4px">Every Thursday afternoon: attendance rate, late arrivals, absences, the week's stars and what's waiting for you.</p></div>
          <label class="toggle"><input type="checkbox" name="weekly_summary" ${s.weekly_summary ? 'checked' : ''}></label></div>
        <div class="row wrap mt" style="gap:8px">
          <button class="btn sm light" type="button" id="send-weekly">${icon('bell')}Send me this week's summary now</button>
          <a class="btn sm" href="/api/admin/export.xlsx">${icon('download')}Download full backup (Excel)</a>
          <a class="btn sm light" href="#/audit">${icon('list')}Activity log</a></div>
        <p class="muted tiny" style="margin-top:8px">The backup has every table (staff, attendance, points, leave, fixes, rewards, kudos, holidays, settings) on its own sheet. Passwords are never included.</p>`)}

      ${dr ? sec('files', '🗂️', 'File storage (Google Drive)', dr.connected ? `Connected · ${esc(dr.email || 'Google Drive')}${dr.quota ? ` · ${fmtBytes(dr.quota.limit - dr.quota.usage)} free` : ''}` : dr.configured ? '<span style="color:var(--red)">Not connected: teams can only share links</span>' : 'Not set up yet',
        (dr.connected
          ? `<div class="row between wrap" style="gap:12px">
              <div class="row" style="gap:12px"><span class="avatar lg sky">🗂️</span><div><strong>${esc(dr.email || 'Google Drive')}</strong>
                <div class="muted small">Connected ${relTime(dr.connected_at)} · ${dr.files} file${dr.files === 1 ? '' : 's'} uploaded (${fmtBytes(dr.bytes)})</div></div></div>
              <button class="btn sm light" type="button" id="drive-off">Disconnect</button></div>
            ${dr.error ? `<div class="notice pink mt">${icon('alert')}${esc(dr.error)} <a href="/api/admin/drive/connect">Reconnect</a></div>` : ''}
            ${dr.quota ? `<div class="mt"><div class="row between small"><span>Drive storage</span><span class="muted">${fmtBytes(dr.quota.usage)} of ${fmtBytes(dr.quota.limit)}</span></div>
              <div class="task-progress big"><i style="width:${Math.max(1, pct(dr.quota.usage, dr.quota.limit))}%"></i></div></div>` : ''}
            <p class="muted small mt">Files land in <b>Bahr Network Files / client / task</b> in this Drive and are shared by link so the team can open them. Removing a file in the app moves it to the Drive trash.</p>`
          : dr.configured
            ? dr.config_problem ? `<div class="notice pink">${icon('alert')}<span>${esc(dr.config_problem)} Then redeploy in Vercel.</span></div>` : `<p class="small">Connect the Google account whose Drive should hold the team's files (your 5 TB account works great). You'll be asked to allow access; the app can only see the files it creates.</p>
               <a class="btn mt" href="/api/admin/drive/connect">${icon('download')}Connect Google Drive</a>
               <p class="muted tiny mt">Using client ${esc(dr.client_id_hint || '')} · If Google says "OAuth client was not found", wait a few minutes (new clients take time to activate) and check the Client ID in Vercel.</p>`
            : `<p class="small">One-time setup (about 10 minutes, free):</p>
               <ol class="setup-steps small">
                 <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">Google Cloud Console</a> with your Google account and create a project (e.g. "Bahr Files").</li>
                 <li>Go to <b>APIs &amp; Services → Library</b>, search <b>Google Drive API</b> and click <b>Enable</b>.</li>
                 <li><b>OAuth consent screen</b>: choose <b>External</b>, fill the app name and your email, save. Then click <b>Publish app</b> so access doesn't expire after 7 days.</li>
                 <li><b>Credentials → Create credentials → OAuth client ID</b> → <b>Web application</b>. Under <b>Authorized redirect URIs</b> add:
                   <div class="row mt" style="gap:6px"><input readonly value="${esc(dr.redirect_uri)}" id="redir"><button class="btn sm light" type="button" id="copy-redir">${icon('copy')}</button></div></li>
                 <li>In <b>Vercel → your project → Settings → Environment Variables</b> add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> from the client you created, then <b>Redeploy</b>.</li>
                 <li>Come back here and tap <b>Connect Google Drive</b>.</li>
               </ol>`)
        + `<label class="f mt">Largest file per upload (GB)<input type="number" id="max-gb" value="${Math.round((s.max_upload_mb / 1024) * 10) / 10}" min="0.1" max="5000" step="0.1"></label>
           <input type="hidden" name="max_upload_mb" value="${s.max_upload_mb}">`) : ''}

      ${sec('company', '🏢', 'Company', `${esc(s.company_name)} · ${esc(s.currency)} · ${esc(s.timezone)}`,
        `<div class="form-grid">
          <label class="f full">Company name<input name="company_name" value="${esc(s.company_name)}" required></label>
          <label class="f">Currency<input name="currency" value="${esc(s.currency)}" required></label>
          <label class="f">Timezone<input name="timezone" value="${esc(s.timezone)}" required></label>
        </div>`)}

      <div class="card row between save-bar">
        <span class="muted small" id="dirty">All changes saved</span>
        <button class="btn" type="submit">${icon('check')}Save settings</button>
      </div>
    </form>`;
  const form = $('#settings');
  const preview = () => {
    const v = (k) => form[k].value || s[k];
    try {
      $('#track-preview').innerHTML = timeTrack({ early_start: v('early_start'), early_end: v('early_end'), late_after: v('late_after'), very_late_after: v('very_late_after'), close: v('close'), very_late_reds: v('very_late_reds') });
    } catch { /* partial input */ }
  };
  preview();
  form.oninput = () => { preview(); ($('#dirty').textContent = 'Unsaved changes', $('.save-bar').classList.add('show')); };
  const bindDepts = () => $$('#depts [data-dept] button').forEach((b) => (b.onclick = () => { b.parentElement.remove(); ($('#dirty').textContent = 'Unsaved changes', $('.save-bar').classList.add('show')); }));
  bindDepts();
  const addDept = () => {
    const v = $('#new-dept').value.trim();
    if (!v || $$('#depts [data-dept]').some((c) => c.dataset.dept.toLowerCase() === v.toLowerCase())) return;
    $('#depts').insertAdjacentHTML('beforeend', `<span class="chip dept-chip pop" data-dept="${esc(v)}">${esc(v)} <button type="button" class="icon-btn xs ghost" style="width:20px;height:20px" aria-label="Remove">${icon('x')}</button></span>`);
    $('#new-dept').value = '';
    ($('#dirty').textContent = 'Unsaved changes', $('.save-bar').classList.add('show'));
    bindDepts();
  };
  $('#add-dept').onclick = addDept;
  $('#new-dept').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addDept(); } };
  form.onchange = form.oninput;
  // ----- Location picker -----
  let map;
  let pin;
  let ring;
  const markDirty = () => (($('#dirty').textContent = 'Unsaved changes', $('.save-bar').classList.add('show')));
  const setLoc = (lat, lng, { zoom = false, from = '' } = {}) => {
    form.office_lat.value = Number(lat).toFixed(6);
    form.office_lng.value = Number(lng).toFixed(6);
    if (map) {
      pin.setLatLng([lat, lng]);
      ring.setLatLng([lat, lng]);
      if (zoom) map.setView([lat, lng], 17);
      else map.panTo([lat, lng]);
    }
    $('#loc-status').className = 'chip amber';
    $('#loc-status').textContent = 'Not saved yet';
    markDirty();
    if (from) toast(`Location set from ${from}. Tap "Save office location".`, 'success');
  };
  const setRadius = (r) => {
    form.radius_m.value = r;
    $('#radius-range').value = Math.min(1000, r);
    $('#radius-label').textContent = `${r} m`;
    ring?.setRadius(Number(r));
  };
  loadLeaflet()
    .then((L) => {
      const start = s.office_lat != null ? [s.office_lat, s.office_lng] : [30.0444, 31.2357];
      $('#map').innerHTML = '';
      map = L.map('map', { zoomControl: true }).setView(start, s.office_lat != null ? 17 : 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      pin = L.marker(start, { draggable: true }).addTo(map);
      ring = L.circle(start, { radius: s.radius_m, color: '#22a35a', fillColor: '#dcf29b', fillOpacity: 0.35, weight: 2 }).addTo(map);
      if (s.office_lat == null) pin.setOpacity(0.4);
      pin.on('drag', (e) => ring.setLatLng(e.latlng));
      pin.on('dragend', (e) => { pin.setOpacity(1); setLoc(e.target.getLatLng().lat, e.target.getLatLng().lng); });
      map.on('click', (e) => { pin.setOpacity(1); setLoc(e.latlng.lat, e.latlng.lng); });
      setTimeout(() => map.invalidateSize(), 200);
    })
    .catch((err) => ($('#map').innerHTML = `<div class="empty" style="height:100%;justify-content:center">${esc(err.message)}</div>`));

  $('#radius-range').oninput = (e) => { setRadius(e.target.value); markDirty(); };
  $('[data-sec="loc"]').addEventListener('toggle', (e) => {
    if (e.target.open && map) setTimeout(() => map.invalidateSize(), 50);
  });
  form.radius_m.addEventListener('input', (e) => setRadius(e.target.value));
  ['office_lat', 'office_lng'].forEach((k) => form[k].addEventListener('change', () => {
    const lat = Number(form.office_lat.value);
    const lng = Number(form.office_lng.value);
    if (Number.isFinite(lat) && Number.isFinite(lng) && form.office_lat.value && form.office_lng.value) setLoc(lat, lng, { zoom: true });
  }));

  let searchTimer;
  $('#loc-search').oninput = (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length < 3) return ($('#loc-results').innerHTML = '');
    searchTimer = setTimeout(async () => {
      $('#loc-results').innerHTML = '<p class="muted small">Searching…</p>';
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=en,ar&q=${encodeURIComponent(q)}`);
        const rows = await r.json();
        $('#loc-results').innerHTML = rows.length
          ? rows.map((x, i) => `<button type="button" class="list-item" data-i="${i}" style="background:none;border:0;border-bottom:1px solid var(--line);text-align:left;cursor:pointer;width:100%">${icon('pin')}<div class="grow"><strong>${esc(x.display_name.split(',')[0])}</strong><span>${esc(x.display_name)}</span></div></button>`).join('')
          : '<p class="muted small">No results. Try a nearby landmark or paste a Google Maps link.</p>';
        $$('#loc-results [data-i]').forEach((b) => (b.onclick = () => {
          const x = rows[b.dataset.i];
          pin?.setOpacity(1);
          setLoc(x.lat, x.lon, { zoom: true, from: 'search' });
          $('#loc-results').innerHTML = '';
        }));
      } catch {
        $('#loc-results').innerHTML = '<p class="muted small">Search is unavailable right now. Paste a Google Maps link instead.</p>';
      }
    }, 450);
  };

  $('#loc-link-go').onclick = (e) => act(e.currentTarget, async () => {
    const url = $('#loc-link').value.trim();
    if (!url) throw new Error('Paste a Google Maps link first');
    const c = await api('/admin/resolve-map-link', { method: 'POST', body: { url } });
    pin?.setOpacity(1);
    setLoc(c.lat, c.lng, { zoom: true, from: 'Google Maps' });
  });

  $('#use-loc').onclick = (e) => act(e.currentTarget, async () => {
    const btn = e.currentTarget;
    btn.innerHTML = `${icon('pin')}Finding you…`;
    try {
      const p = await getPosition();
      pin?.setOpacity(1);
      setLoc(p.lat, p.lng, { zoom: true });
      toast(`Location found (±${Math.round(p.accuracy)} m). Drag the pin if needed, then save.`, 'success');
    } finally {
      btn.innerHTML = `${icon('pin')}Use my current location`;
    }
  });

  $('#test-loc').onclick = (e) => act(e.currentTarget, async () => {
    const lat = Number(form.office_lat.value);
    const lng = Number(form.office_lng.value);
    if (!form.office_lat.value || !Number.isFinite(lat)) throw new Error('Set the office location first');
    const p = await getPosition();
    const R = 6371000;
    const rad = (d) => (d * Math.PI) / 180;
    const a = Math.sin(rad(p.lat - lat) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(p.lat)) * Math.sin(rad(p.lng - lng) / 2) ** 2;
    const dist = Math.round(2 * R * Math.asin(Math.sqrt(a)));
    const ok = dist <= Number(form.radius_m.value) && p.accuracy <= Number(form.max_accuracy_m.value);
    modal({
      title: ok ? 'You can check in from here ✅' : 'Check-in would be refused ❌',
      sub: `Distance from office: <strong>${dist} m</strong> (allowed ${form.radius_m.value} m)<br>GPS precision: <strong>±${Math.round(p.accuracy)} m</strong> (allowed ±${form.max_accuracy_m.value} m)`,
      body: '',
      submit: 'OK',
      onSubmit: async () => {},
    });
  });

  const save = async (btn, msg) => {
    const d = formData(form);
    delete d.wd;
    const body = {
      ...d,
      work_days: $$('[name=wd]:checked', form).map((c) => Number(c.value)),
      office_lat: d.office_lat === '' ? null : Number(d.office_lat),
      office_lng: d.office_lng === '' ? null : Number(d.office_lng),
      departments: $$('#depts [data-dept]').map((c) => c.dataset.dept),
      device_lock: !!form.device_lock.checked,
      payroll_add_rewards: !!form.payroll_add_rewards.checked,
      weekly_summary: !!form.weekly_summary.checked,
      dept_schedules: Object.fromEntries($$('#dept-sch [data-dept]').filter((el) => $('[data-own]', el).checked).map((el) => [el.dataset.dept, {
        ...Object.fromEntries($$('[data-k]', el).map((i) => [i.dataset.k, i.dataset.k === 'daily_hours' ? Number(i.value) : i.value])),
        work_days: $$('[data-wd]:checked', el).map((c) => Number(c.value)),
      }])),
    };
    for (const k of ['max_upload_mb', 'radius_m', 'max_accuracy_m', 'very_late_reds', 'red_value', 'black_value', 'green_value', 'min_reward_points', 'kudos_daily_limit', 'kudos_green', 'daily_hours', 'overtime_rate', 'annual_leave_days', 'sick_leave_days']) body[k] = Number(body[k]);
    return act(btn, async () => {
      const saved = await api('/admin/settings', { method: 'PUT', body });
      company = saved.company_name;
      $('#dirty').textContent = 'All changes saved ✓';
      // Re-render so the section summaries show the new values, keeping open sections open.
      reopenSections = $$('.set-sec[open]').map((d) => d.dataset.sec);
      setTimeout(async () => {
        if (parseHash().path === 'settings') await route();
        reopenSections = null;
      }, 700);
      $('#loc-status').className = `chip ${saved.office_lat == null ? 'amber' : 'lime'}`;
      $('#loc-status').textContent = saved.office_lat == null ? 'Not set yet' : 'Saved ✓';
      if (saved.office_lat != null) confetti({ count: 60 });
    }, msg);
  };
  $$('#dept-sch [data-own]').forEach((c) => c.addEventListener('change', () => {
    if (c.checked) c.closest('details').open = true;
  }));
  $('#max-gb')?.addEventListener('input', (e) => { form.max_upload_mb.value = Math.max(1, Math.round(Number(e.target.value) * 1024)); });
  $('#copy-redir')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#redir').value); toast('Copied', 'success'); } catch { $('#redir').select(); }
  });
  $('#drive-off')?.addEventListener('click', () => confirmBox('Disconnect Google Drive?', 'Files already uploaded stay in Drive and their links keep working, but nobody can upload new files until you connect again.', async () => {
    await api('/admin/drive/disconnect', { method: 'POST', body: {} });
    toast('Google Drive disconnected', 'success');
    route();
  }, { submit: 'Disconnect' }));
  $('#send-weekly').onclick = (e) => act(e.currentTarget, async () => {
    const r = await api('/admin/weekly-summary', { method: 'POST', body: {} });
    const w = r.summary;
    modal({
      title: '📊 This week at a glance',
      sub: `${fmtDate(w.from)} → ${fmtDate(w.to)}${r.sent ? ' · also sent to your devices' : ' · turn on notifications in Account to get it as a push'}`,
      body: `<div class="grid g2">
        ${tile('teal', 'Attendance', `${w.rate}%`, `${w.present}/${w.expected} check-ins`, { big: true, arrow: false })}
        ${tile('pink', 'Late', w.late, 'arrivals', { big: true, arrow: false })}
        ${tile('dark', 'Absences', w.absences, 'black points', { big: true, arrow: false })}
        ${tile('amber', 'Waiting', w.pending.leaves + w.pending.rewards + w.pending.corrections, 'requests', { big: true, arrow: false })}</div>
        ${w.stars.length ? `<p class="strong mt">⭐ Stars of the week</p><div class="chips mt">${w.stars.map((x) => `<span class="chip lime">${esc(x.name)} · +${x.green}</span>`).join('')}</div>` : ''}`,
      submit: 'Nice',
      onSubmit: async () => {},
    });
  });
  $('#save-loc').onclick = (e) => {
    if (!form.office_lat.value) return toast('Pick the office on the map first', 'error');
    save(e.currentTarget, 'Office location saved. Staff can check in now 🎉');
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    save(e.submitter, 'Settings saved');
  };
}

// ---------- Attendance fixes ----------

async function viewMyCorrections() {
  const today = localISODate();
  const prev = (() => {
    const x = toDate(`${today.slice(0, 7)}-01`);
    x.setUTCMonth(x.getUTCMonth() - 1);
    return x.toISOString().slice(0, 7);
  })();
  const [list, h1, h2] = await Promise.all([api('/me/corrections'), api(`/me/history?month=${thisMonth()}`), api(`/me/history?month=${prev}`)]);
  const min = (() => {
    const x = toDate(today);
    x.setUTCDate(x.getUTCDate() - 30);
    return x.toISOString().slice(0, 10);
  })();
  const pendingDays = new Set(list.filter((c) => c.status === 'pending').map((c) => c.work_date));
  // Suggestions: recent days with a missing check-out, or recorded as absent.
  const att = [...h1.attendance, ...h2.attendance];
  const pts = [...h1.points, ...h2.points];
  const suggest = [
    ...att.filter((a) => !a.check_out_time && a.work_date < today && a.work_date >= min).map((a) => ({ d: a.work_date, kind: 'out', in: a.check_in_time })),
    ...pts.filter((p) => p.source === 'absent' && p.work_date >= min).map((p) => ({ d: p.work_date, kind: 'in' })),
  ].filter((x) => !pendingDays.has(x.d)).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 6);

  $('#app').innerHTML = `
    ${pageHead('Fix attendance 🛠️', 'Forgot to check in or out? Ask your manager to fix it. Approved fixes remove the absence.')}
    <div class="split">
      <div class="card">
        <div class="card-head"><h2>New request</h2></div>
        ${suggest.length ? `<p class="list-label" style="margin-top:0">Needs fixing</p><div class="chips" id="suggest" style="margin-bottom:14px">${suggest
          .map((x, i) => `<button type="button" class="chip ${x.kind === 'in' ? 'dark' : 'amber'}" data-i="${i}">${x.kind === 'in' ? '⚫' : '⏱️'} ${fmtDate(x.d)} · ${x.kind === 'in' ? 'absent' : 'no check-out'}</button>`)
          .join('')}</div>` : ''}
        <form id="fix" class="grid" style="gap:14px">
          <label class="f">Day<input type="date" name="work_date" min="${min}" max="${today}" value="${suggest[0]?.d || today}" required></label>
          <div class="form-grid two">
            <label class="f">Check-in time<input type="time" name="check_in_time" value="${suggest[0]?.kind === 'out' ? '' : rules().early_end || '09:00'}"></label>
            <label class="f">Check-out time<input type="time" name="check_out_time"></label>
          </div>
          <p class="muted tiny" id="fix-hint" style="margin-top:-6px">Leave check-in empty if you only forgot to check out.</p>
          <label class="f">What happened?<textarea name="reason" maxlength="500" rows="2" required placeholder="e.g. My phone died when I arrived"></textarea></label>
          <button class="btn xl block" type="submit">${icon('wrench')}Send to my manager</button>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>My requests</h2><span class="chip">${list.length}</span></div>
        ${list.length ? `<div class="list">${list.map((c) => `<div class="list-item"><span class="avatar sm ${REQ[c.status][1]}">${icon('wrench')}</span>
            <div class="grow"><strong>${fmtDate(c.work_date)}</strong><span>${[c.check_in_time && `In ${fmtTime(c.check_in_time)}`, c.check_out_time && `Out ${fmtTime(c.check_out_time)}`].filter(Boolean).join(' · ')} · ${esc(c.reason)}</span></div>
            ${chip(REQ, c.status)}${c.status === 'pending' ? `<button class="btn sm light" data-cancel="${c.id}">Cancel</button>` : ''}</div>`).join('')}</div>`
          : empty('wrench', 'No fixes requested. Nice and tidy!')}
      </div>
    </div>`;
  const form = $('#fix');
  $$('#suggest [data-i]').forEach((b) => (b.onclick = () => {
    const x = suggest[b.dataset.i];
    form.work_date.value = x.d;
    form.check_in_time.value = x.kind === 'out' ? '' : rules().early_end || '09:00';
    form.check_out_time.value = '';
    $('#fix-hint').textContent = x.kind === 'out' ? `You checked in at ${fmtTime(x.in)}. Enter when you left.` : 'Enter when you actually arrived (and left, if you remember).';
    (x.kind === 'out' ? form.check_out_time : form.check_in_time).focus();
    $$('#suggest .chip').forEach((c) => c.classList.toggle('on', c === b));
  }));
  form.onsubmit = (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const d = formData(form);
      await api('/me/corrections', { method: 'POST', body: { ...d, check_in_time: d.check_in_time || null, check_out_time: d.check_out_time || null } });
      route();
    }, 'Sent. Your manager will review it');
  };
  $$('[data-cancel]').forEach((b) => (b.onclick = () => act(b, async () => {
    await api(`/me/corrections/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} });
    route();
  }, 'Request cancelled')));
}

async function viewCorrectionRequests(params, base = 'corrections') {
  const status = params.get('status') ?? 'pending';
  const list = await api(`/admin/corrections${status ? `?status=${status}` : ''}`);
  $('#app').innerHTML = `
    ${pageHead(me.role === 'lead' ? `Team fixes · ${esc(me.department || '')}` : 'Attendance fixes', 'Approving a missed check-in records it with the normal points and removes the absence.', statusSeg(base, status, ['pending', 'approved', 'rejected', 'cancelled']))}
    <div class="cards-grid">${
      list.length
        ? list.map((c) => `<div class="card" style="margin:0">
            <div class="row">${avatar(c.user_name)}<div class="grow" style="flex:1;min-width:0"><strong>${esc(c.user_name)}</strong><div class="tiny muted">${c.department ? `${esc(c.department)} · ` : ''}${relTime(c.created_at)}</div></div>${chip(REQ, c.status)}</div>
            <div class="tile teal mt" style="min-height:auto"><div class="row between"><div><div class="t-sub">${c.check_in_time ? 'Missed check-in' : 'Missed check-out'}</div><strong>${fmtDate(c.work_date)}</strong></div>
              <div class="t-num num" style="font-size:1.1rem;text-align:right">${c.check_in_time ? `In ${fmtTime(c.check_in_time)}` : ''}${c.check_in_time && c.check_out_time ? '<br>' : ''}${c.check_out_time ? `Out ${fmtTime(c.check_out_time)}` : ''}</div></div></div>
            <p class="small mt" style="color:var(--ink-2)">${esc(c.reason)}</p>
            ${c.decided_by_name && c.status !== 'pending' ? `<p class="tiny muted">By ${esc(c.decided_by_name)}</p>` : ''}
            ${c.status === 'pending' ? `<div class="row mt"><button class="btn sm green" data-id="${c.id}" data-d="approve">${icon('check')}Approve</button>
              <button class="btn sm light" data-id="${c.id}" data-d="reject">${icon('x')}Reject</button></div>` : ''}
          </div>`).join('')
        : `<div class="card" style="grid-column:1/-1">${empty('wrench', status === 'pending' ? 'No fixes waiting. All clear!' : 'Nothing here')}</div>`
    }</div>`;
  $$('[data-d]').forEach((b) => (b.onclick = () => act(b, async () => {
    await api(`/admin/corrections/${b.dataset.id}/decision`, { method: 'POST', body: { decision: b.dataset.d } });
    await refreshCounts();
    route();
  }, b.dataset.d === 'approve' ? 'Attendance fixed' : 'Request rejected')));
}

// ---------- Payroll & payslips ----------

function payslipHtml(row, meta) {
  const cur = meta.currency;
  const m = (n) => money(n, cur);
  const line = (label, value, cls = '', sub = '') => `<div class="slip-line ${cls}"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><b class="num">${value}</b></div>`;
  return `<div class="card slip">
    <div class="slip-head">${logoMark(38)}<div class="grow"><strong>${esc(meta.company_name || company)}</strong><span class="muted small">Payslip · ${fmtMonth(meta.month)}</span></div>
      <span class="chip ${row.net_pay ? 'lime' : ''}">${esc(row.name)}</span></div>
    <div class="slip-meta muted small">${esc(row.job_title || 'Team member')}${row.department ? ` · ${esc(row.department)}` : ''} · ${row.days_present}/${row.work_days} days present · ${fmtHours(row.worked_minutes)} worked</div>
    ${row.salary ? '' : `<div class="notice amber mt">${icon('alert')}No salary on file yet. Deductions are shown, but net pay needs a salary.</div>`}
    <div class="slip-body">
      ${line('Base salary', m(row.salary))}
      ${row.overtime_pay ? line('Overtime', `+ ${m(row.overtime_pay)}`, 'plus', `${row.overtime_hours} h × ${meta.overtime_rate}`) : ''}
      ${row.rewards_paid && row.rewards_in_net ? line('Rewards paid', `+ ${m(row.rewards_paid)}`, 'plus', 'green points') : ''}
      ${row.red_deduction ? line('Red penalties', `− ${m(row.red_deduction)}`, 'minus', `${row.red} × ${m(meta.red_value ?? row.red_deduction / row.red)}`) : ''}
      ${row.black_deduction ? line('Absences', `− ${m(row.black_deduction)}`, 'minus', `${row.black} × ${m(meta.black_value ?? row.black_deduction / row.black)}`) : ''}
      ${row.unpaid_deduction ? line('Unpaid leave', `− ${m(row.unpaid_deduction)}`, 'minus', `${row.unpaid_days} day${row.unpaid_days === 1 ? '' : 's'}`) : ''}
      ${line('Net pay', m(row.net_pay), 'total')}
      ${row.rewards_paid && !row.rewards_in_net ? `<p class="muted tiny" style="margin-top:8px">🎁 ${m(row.rewards_paid)} in rewards was paid separately this month.</p>` : ''}
    </div>
    <p class="muted tiny slip-foot">Generated ${fmtLong(localISODate())}. Red/black points are based on the check-in record; ask your manager if something looks wrong.</p>
  </div>`;
}

async function viewPayslip(params) {
  const month = params.get('month') || thisMonth();
  const userId = Number(params.get('user')) || null;
  let row;
  let meta;
  if (me.role === 'owner') {
    const [pay, s] = await Promise.all([api(`/admin/payroll?month=${month}`), api('/admin/settings')]);
    row = pay.rows.find((r) => r.user_id === userId);
    meta = { ...pay, company_name: s.company_name, red_value: s.red_value, black_value: s.black_value };
  } else {
    meta = await api(`/me/payslip?month=${month}`);
    row = meta.row;
  }
  if (!row) throw new Error('No payslip for that month');
  $('#app').innerHTML = `
    ${pageHead(me.role === 'owner' ? `Payslip · ${esc(row.name)}` : 'My payslip', fmtMonth(month), `${monthInput(month, me.role === 'owner' ? `#/payslip?user=${userId}` : '#/payslip')}
      ${me.role === 'owner' ? `<a class="btn light" href="#/payroll?month=${month}">${icon('arrow')}Payroll</a>` : ''}
      <button class="btn" onclick="window.print()">${icon('printer')}Print / PDF</button>`)}
    <div class="slip-wrap">${payslipHtml(row, { ...meta, month })}</div>
    ${month === thisMonth() ? `<p class="muted small no-print" style="text-align:center;margin-top:10px">This month isn't over yet: numbers update as the month goes on.</p>` : ''}`;
  $('#month').max = thisMonth();
}

async function viewPayroll(params) {
  const month = params.get('month') || thisMonth();
  const pay = await api(`/admin/payroll?month=${month}`);
  const rows = pay.rows.filter((r) => r.active);
  const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const m = (n) => money(Math.round(n), pay.currency);
  const noSalary = rows.filter((r) => !r.salary).length;
  $('#app').innerHTML = `
    ${pageHead('Payroll 💸', `${fmtMonth(month)} · net pay = salary − deductions − unpaid leave + overtime${pay.rewards_in_net ? ' + rewards' : ''}`, `${monthInput(month, '#/payroll')}
      <button class="btn light" onclick="window.print()">${icon('printer')}Print</button>
      <a class="btn" href="/api/admin/payroll.csv?month=${month}">${icon('download')}Export CSV</a>`)}
    ${noSalary ? `<a class="announce amber" href="#/employees" style="text-decoration:none;margin-bottom:16px"><span class="em">💰</span>
      <div style="flex:1"><h3>${noSalary} ${noSalary === 1 ? 'person has' : 'people have'} no salary yet</h3><p>Add it from Staff → Edit to get their net pay.</p></div><span class="btn sm">Staff</span></a>` : ''}
    <div class="grid g4" style="margin-bottom:16px">
      ${tile('teal', 'Total net pay', m(sum('net_pay')), `${rows.length} people`, { arrow: false })}
      ${tile('slate', 'Salaries', m(sum('salary')), 'base', { arrow: false })}
      ${tile('pink', 'Deductions', m(sum('total_deduction') + sum('unpaid_deduction')), `${sum('red')} red · ${sum('black')} black${sum('unpaid_days') ? ` · ${sum('unpaid_days')} unpaid` : ''}`, { arrow: false })}
      ${tile('lime', 'Overtime', m(sum('overtime_pay')), `${Math.round(sum('overtime_hours') * 10) / 10} h at ×${pay.overtime_rate}`, { arrow: false })}
    </div>
    <div class="card">${rows.length
      ? `<div class="table-wrap"><table class="stack"><thead><tr><th>Employee</th><th>Salary</th><th>Hours</th><th>Overtime</th><th>Red / black</th><th>Unpaid leave</th><th>Net pay</th><th class="no-print"></th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><span class="row">${avatar(r.name, 'sm')}<span><strong>${esc(r.name)}</strong><div class="tiny muted">${esc(r.department || '')}</div></span></span></td>
          <td class="num" data-label="Salary">${r.salary ? m(r.salary) : '<span class="chip amber">Not set</span>'}</td>
          <td class="num nowrap" data-label="Hours">${fmtHours(r.worked_minutes)}</td>
          <td class="num nowrap" data-label="Overtime">${r.overtime_hours ? `${r.overtime_hours} h<div class="tiny" style="color:var(--green)">+ ${m(r.overtime_pay)}</div>` : '—'}</td>
          <td class="num nowrap" data-label="Red / black">${r.total_deduction ? `${r.red} / ${r.black}<div class="tiny" style="color:var(--red)">− ${m(r.total_deduction)}</div>` : '—'}</td>
          <td class="num nowrap" data-label="Unpaid leave">${r.unpaid_days ? `${r.unpaid_days} d<div class="tiny" style="color:var(--red)">− ${m(r.unpaid_deduction)}</div>` : '—'}</td>
          <td class="num strong nowrap td-total" data-label="Net pay">${m(r.net_pay)}</td>
          <td class="no-print td-action"><a class="btn sm light" href="#/payslip?user=${r.user_id}&month=${month}">${icon('receipt')}Slip</a></td></tr>`).join('')}
        </tbody></table></div>`
      : empty('receipt', 'No employees yet')}</div>`;
}

// ---------- Owner: holidays ----------

async function viewHolidays(params) {
  const year = params.get('year') || localISODate().slice(0, 4);
  const today = localISODate();
  const list = await api(`/holidays?year=${year}`);
  const years = [Number(year) - 1, Number(year), Number(year) + 1];
  $('#app').innerHTML = `
    ${pageHead('Official holidays 🎉', 'Nobody is expected to check in on these days, so no absences are recorded.', `<div class="seg">${years.map((y) => `<a href="#/holidays?year=${y}" class="${String(y) === year ? 'on' : ''}">${y}</a>`).join('')}</div>`)}
    <div class="split">
      <div class="card">
        <div class="card-head"><h2>Add a holiday</h2></div>
        <form id="hol" class="grid" style="gap:14px">
          <label class="f">Name<input name="name" maxlength="80" required placeholder="e.g. Eid al-Fitr"></label>
          <div class="form-grid two">
            <label class="f">From<input type="date" name="date" value="${year === today.slice(0, 4) ? today : `${year}-01-01`}" required></label>
            <label class="f">Until<input type="date" name="to_date" value="${year === today.slice(0, 4) ? today : `${year}-01-01`}"></label>
          </div>
          <button class="btn block" type="submit">${icon('plus')}Add holiday</button>
        </form>
        <div class="notice sky mt">${icon('calendar')}<div><strong>Egypt's fixed holidays</strong><div class="small">Coptic Christmas, 25 January, Sinai Liberation, Labour Day, 30 June, 23 July and 6 October. Eid and other Islamic holidays move each year, so add those by hand.</div>
          <button class="btn sm light mt" type="button" id="preset">${icon('download')}Add the ${year} fixed holidays</button></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>${year}</h2><span class="chip">${list.length} day${list.length === 1 ? '' : 's'}</span></div>
        ${list.length ? `<div class="list">${list.map((h) => `<div class="list-item ${h.date < today ? 'past' : ''}">
            <div class="leave-date ${h.date < today ? 'slate' : 'sky'}"><b>${toDate(h.date).getUTCDate()}</b><span>${toDate(h.date).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</span></div>
            <div class="grow"><strong>${esc(h.name)}</strong><span>${fmtDate(h.date, { weekday: 'long' })}${h.date >= today ? ` · in ${daysBetween(today, h.date)} days` : ''}</span></div>
            <button class="icon-btn sm" data-del="${h.id}" data-name="${esc(h.name)}" aria-label="Remove">${icon('x')}</button></div>`).join('')}</div>`
          : empty('party', 'No holidays for this year yet')}
      </div>
    </div>`;
  $('#hol').date.onchange = (e) => {
    const to = $('#hol').to_date;
    to.min = e.target.value;
    if (!to.value || to.value < e.target.value) to.value = e.target.value;
  };
  $('#hol').onsubmit = (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const d = formData(e.target);
      await api('/admin/holidays', { method: 'POST', body: { ...d, to_date: d.to_date || d.date } });
      confetti({ count: 40 });
      go(`#/holidays?year=${d.date.slice(0, 4)}`);
      route();
    }, 'Holiday added. Absences for it were cleared');
  };
  $('#preset').onclick = (e) => act(e.currentTarget, async () => {
    await api('/admin/holidays/preset', { method: 'POST', body: { year: Number(year) } });
    route();
  }, `${year} holidays added`);
  $$('[data-del]').forEach((b) => (b.onclick = () => confirmBox(`Remove ${b.dataset.name}?`, 'If this day already passed, it becomes a normal work day again and missed check-ins count as absences.', async () => {
    await api(`/admin/holidays/${b.dataset.del}/delete`, { method: 'POST', body: {} });
    route();
  }, { submit: 'Remove' })));
}

// ---------- Owner: activity log ----------

const AUDIT = {
  'user.create': ['👤', 'added'], 'user.update': ['✏️', 'edited'], 'points.adjust': ['⭐', 'adjusted points for'],
  'attendance.manual': ['🕘', 'recorded attendance for'], 'leave.approve': ['✅', 'approved leave for'], 'leave.reject': ['❌', 'rejected leave for'],
  'reward.paid': ['💸', 'paid a reward to'], 'reward.reject': ['↩️', 'rejected a reward for'], 'correction.approve': ['🛠️', 'fixed attendance for'],
  'correction.reject': ['❌', 'rejected a fix for'], 'settings.update': ['⚙️', 'changed settings'], 'holiday.add': ['🎉', 'added a holiday'],
  'holiday.preset': ['🎉', 'added official holidays'], 'holiday.remove': ['🗑️', 'removed a holiday'], 'payroll.export': ['💰', 'exported payroll'],
  'data.export': ['💾', 'downloaded a full backup'],
};

async function viewAudit() {
  let rows = await api('/admin/audit');
  const draw = () => {
    let lastDay = '';
    $('#audit').innerHTML = rows.length
      ? rows.map((a) => {
          const day = new Date(a.created_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
          const head = day !== lastDay ? `<p class="list-label">${day}</p>` : '';
          lastDay = day;
          const [em, verb] = AUDIT[a.action] || ['•', a.action];
          return `${head}<div class="list-item"><span class="avatar sm slate">${em}</span>
            <div class="grow"><strong>${esc(a.actor_name || 'System')}${a.actor_role === 'lead' ? ' <span class="chip tiny">lead</span>' : ''} <span style="font-weight:500">${verb}</span>${a.target_name ? ` ${esc(a.target_name)}` : ''}</strong>
              ${a.detail ? `<span>${esc(a.action === 'settings.update' ? a.detail.replace(/_/g, ' ').replace(/\bdept\b/g, 'department').replace(/\bwd\b/, 'work days') : a.detail)}</span>` : ''}</div>
            <span class="tiny muted nowrap">${new Date(a.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>`;
        }).join('')
      : empty('list', 'No activity yet. Approvals, edits and exports will show up here.');
  };
  $('#app').innerHTML = `
    ${pageHead('Activity log', 'Every change made by owners and team leads, newest first.', `<a class="btn" href="/api/admin/export.xlsx">${icon('download')}Full backup (Excel)</a>`)}
    <div class="card"><div class="list" id="audit"></div>
      <button class="btn light block mt" id="more-audit" ${rows.length < 100 ? 'hidden' : ''}>Load older</button></div>`;
  draw();
  $('#more-audit').onclick = (e) => act(e.currentTarget, async () => {
    const older = await api(`/admin/audit?before=${rows[rows.length - 1].id}`);
    rows = [...rows, ...older];
    draw();
    if (older.length < 100) e.currentTarget.hidden = true;
  });
}

// ---------- Team lead: team board ----------

async function viewTeam(params) {
  const date = params.get('date') || '';
  const o = await api(`/admin/overview${date ? `?date=${date}` : ''}`);
  pending = o.pending;
  renderShell('team');
  const c = (st) => o.rows.filter((x) => x.status === st).length;
  const present = o.rows.filter((x) => PRESENT.includes(x.status)).length;
  const total = o.rows.length;
  $('#app').innerHTML = `
    ${pageHead(`My team${o.scope ? ` · ${esc(o.scope)}` : ''}`, `${fmtLong(o.date)}${o.holiday ? ` · 🎉 ${esc(o.holiday)}` : ''}`, `<input type="date" id="date" value="${o.date}" style="width:170px">`)}
    ${o.scope ? '' : `<div class="notice amber" style="margin-bottom:16px">${icon('alert')}You don't have a department yet. Ask the owner to set one on your profile.</div>`}
    <div class="grid g4" style="margin-bottom:16px">
      ${tile('teal', 'Present', `${present}/${total}`, `${pct(present, total)}% of the team`, { big: true, arrow: false })}
      ${tile('lime', 'Early', c('early'), 'green points earned', { big: true, arrow: false })}
      ${tile('pink', 'Late', c('late') + c('very_late'), 'red penalties', { big: true, arrow: false })}
      ${tile('amber', 'Waiting for you', o.pending.leaves + o.pending.corrections, `${o.pending.leaves} leave · ${o.pending.corrections} fix${o.pending.corrections === 1 ? '' : 'es'}`, { big: true, href: o.pending.corrections && !o.pending.leaves ? '#/team-fixes' : '#/team-leaves' })}
    </div>
    <div class="card"><div class="card-head"><h2>Attendance</h2>${o.mood.avg ? `<span class="chip">${MOODS[Math.round(o.mood.avg)][0]} mood ${o.mood.avg}</span>` : ''}</div>
      ${o.rows.length ? `<div class="list">${o.rows.map((x) => `<a class="list-item" href="#/member?id=${x.id}" style="text-decoration:none">${avatar(x.name)}
          <div class="grow"><strong>${esc(x.name)} ${x.mood ? `<i class="mood-inline">${MOODS[x.mood][0]}</i>` : ''}</strong><span>${esc(x.job_title || 'Team member')}${x.mode === 'remote' ? ' · 🌍 Remote' : ''}${x.worked_minutes ? ` · ${fmtHours(x.worked_minutes)}` : ''}</span></div>
          <div class="tiny muted nowrap" style="text-align:right">${x.check_in_time ? `In ${fmtTime(x.check_in_time)}` : ''}${x.check_out_time ? `<br>Out ${fmtTime(x.check_out_time)}` : ''}</div>
          ${chip(STATUS, x.status)}</a>`).join('')}</div>` : empty('users', 'Nobody in your department yet')}
    </div>`;
  $('#date').onchange = (e) => go(`#/team?date=${e.target.value}`);
}

async function viewMember(params) {
  const id = Number(params.get('id'));
  const [{ h, leaves, month }, d, people] = await Promise.all([viewHistory(params, id), api('/me/dashboard'), api('/people')]);
  const p = people.find((x) => x.id === id) || { name: 'Team member' };
  const b = h.balances;
  $('#app').innerHTML = `
    ${pageHead(esc(p.name), `${esc(p.job_title || 'Team member')} · ${fmtMonth(month)}`, monthInput(month, `#/member?id=${id}`))}
    <div class="dash">
      <div class="card"><div class="card-head"><h2>Summary</h2></div>
        <div class="grid g2">
          ${tile('teal', 'Days present', h.attendance.length, 'this month', { big: true, arrow: false })}
          ${tile('lime', 'Green', b.month.green, `balance ${b.green}`, { big: true, arrow: false })}
          ${tile('pink', 'Red', b.month.red, 'late arrivals', { big: true, arrow: false })}
          ${tile('dark', 'Absences', b.month.black, 'black points', { big: true, arrow: false })}
        </div></div>
      <div class="card"><div class="card-head"><h2>Calendar</h2></div>
        ${calendar(month, { attendance: h.attendance, points: h.points, leaves, workDays: d.rules.work_days, startDate: p.start_date, today: d.now.date })}</div>
    </div>
    ${historyLists(h)}`;
}

// ---------- Tasks ----------

const TASK_STATUS = { todo: ['To do', 'slate'], in_progress: ['In progress', 'sky'], review: ['In review', 'amber'], done: ['Done', 'lime'] };
const PRIORITY = { low: ['Low', ''], medium: ['Medium', 'teal'], high: ['High', 'amber'], urgent: ['Urgent', 'pink'] };
const TASK_VIEWS = { board: ['Board', 'kanban'], list: ['List', 'list'], timeline: ['Timeline', 'calendar'] };
let taskMeta = null;
let taskReload = null; // re-renders the open Tasks page after a change in the detail sheet

const dueChip = (t) => {
  if (!t.due_date) return '';
  const today = localISODate();
  const late = t.status !== 'done' && t.due_date < today;
  const soon = t.status !== 'done' && t.due_date === today;
  return `<span class="chip ${late ? 'pink' : soon ? 'amber' : ''} task-due" title="Due ${fmtLong(t.due_date)}">${icon('calendar')}${late ? 'Late · ' : soon ? 'Today · ' : ''}${fmtDate(t.due_date, { day: 'numeric', month: 'short' })}</span>`;
};
const progressHtml = (t) => (t.items_total
  ? `<div class="task-progress" title="${t.items_done} of ${t.items_total} done"><i style="width:${pct(t.items_done, t.items_total)}%"></i></div><span class="tiny muted num">${t.items_done}/${t.items_total}</span>`
  : '');
const assigneeHtml = (t, size = 'sm') => (t.assignee_name
  ? `<span class="row task-who" style="gap:6px">${avatar(t.assignee_name, size)}<span class="small">${esc(t.assignee_name.split(' ')[0])}</span></span>`
  : `<span class="chip amber task-who">${icon('user')}Unassigned</span>`);

function taskCard(t) {
  return `<article class="task-card prio-${t.priority}" data-task="${t.id}" draggable="true" tabindex="0">
    <div class="task-tags">${t.client ? `<span class="chip">${esc(t.client)}</span>` : ''}
      ${t.priority === 'urgent' || t.priority === 'high' ? `<span class="chip ${PRIORITY[t.priority][1]}">${icon('flag')}${PRIORITY[t.priority][0]}</span>` : ''}
      ${me.role === 'owner' || taskMeta?.is_am ? `<span class="chip dept-chip">${esc(t.department)}</span>` : ''}</div>
    <h4>${esc(t.title)}</h4>
    ${t.description ? `<p class="task-desc">${esc(t.description)}</p>` : ''}
    ${t.items_total ? `<div class="row" style="gap:8px;margin-top:10px">${progressHtml(t)}</div>` : ''}
    <div class="task-foot">${assigneeHtml(t)}<span class="row" style="gap:6px">${t.files ? `<span class="tiny muted row" style="gap:3px">📎 ${t.files}</span>` : ''}${t.comments ? `<span class="tiny muted row" style="gap:3px">💬 ${t.comments}</span>` : ''}${dueChip(t)}</span></div>
  </article>`;
}

function boardHtml(list) {
  return `<div class="task-board">${Object.entries(TASK_STATUS).map(([k, [label, c]]) => {
    const col = list.filter((t) => t.status === k);
    return `<section class="task-col" data-status="${k}">
      <header><span class="dot ${c}"></span><strong>${label}</strong><span class="muted small">${col.length}</span></header>
      <div class="task-col-body">${col.map(taskCard).join('') || `<div class="task-empty">${k === 'review' ? 'Nothing waiting for review' : k === 'done' ? 'Finished tasks land here' : 'No tasks'}</div>`}</div>
    </section>`;
  }).join('')}</div>`;
}

function listHtml(list) {
  return `<div class="card task-list">${Object.entries(TASK_STATUS).map(([k, [label, c]]) => {
    const rows = list.filter((t) => t.status === k);
    if (!rows.length) return '';
    return `<div class="task-group"><span class="dot ${c}"></span>${label} <span class="muted">${rows.length}</span></div>
      ${rows.map((t) => `<button type="button" class="task-row" data-task="${t.id}">
        <span class="task-row-main"><strong>${esc(t.title)}</strong><span class="tiny muted">${[t.client, t.department].filter(Boolean).map(esc).join(' · ')}</span></span>
        <span class="task-row-prio"><span class="chip ${PRIORITY[t.priority][1]}"><span class="dot"></span>${PRIORITY[t.priority][0]}</span></span>
        <span class="task-row-prog">${t.items_total ? `<span class="ring" style="--p:${pct(t.items_done, t.items_total)}"></span><span class="small num">${pct(t.items_done, t.items_total)}% <span class="muted">${t.items_done}/${t.items_total}</span></span>` : '<span class="muted small">—</span>'}</span>
        <span class="task-row-who">${assigneeHtml(t)}</span>
        <span class="task-row-due">${dueChip(t) || '<span class="muted small">No date</span>'}</span>
      </button>`).join('')}`;
  }).join('') || empty('kanban', 'No tasks here')}</div>`;
}

// Gantt-style view: bars from start (or creation) to due date, with a "today" line.
function timelineHtml(list) {
  const today = localISODate();
  const monday = (() => { const x = toDate(today); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7) - 7); return x.toISOString().slice(0, 10); })();
  const days = 56;
  const dayW = 26;
  const idx = (d) => daysBetween(monday, d);
  const weeks = Array.from({ length: days / 7 }, (_, i) => { const x = toDate(monday); x.setUTCDate(x.getUTCDate() + i * 7); return x.toISOString().slice(0, 10); });
  const rows = Object.keys(TASK_STATUS).flatMap((k) => {
    const group = list.filter((t) => t.status === k);
    if (!group.length) return [];
    return [`<div class="tl-row tl-group"><div class="tl-name"><span class="dot ${TASK_STATUS[k][1]}"></span>${TASK_STATUS[k][0]} <span class="muted">${group.length}</span></div><div class="tl-track"></div></div>`,
      ...group.map((t) => {
        const from = t.start_date || String(t.created_at).slice(0, 10);
        const to = t.due_date && t.due_date >= from ? t.due_date : from;
        const a = Math.max(0, idx(from));
        const b = Math.min(days - 1, idx(to));
        const bar = b >= 0 && a <= days - 1
          ? `<span class="tl-bar ${TASK_STATUS[t.status][1]} prio-${t.priority}" style="left:${a * dayW}px;width:${Math.max(1, b - a + 1) * dayW - 4}px">${t.items_total ? `${pct(t.items_done, t.items_total)}% · ${t.items_done}/${t.items_total}` : esc(t.assignee_name?.split(' ')[0] || 'Unassigned')}</span>`
          : `<span class="tl-off muted tiny" style="${idx(to) < 0 ? 'left:4px' : 'right:4px'}">${idx(to) < 0 ? '← ' : ''}${fmtDate(to, { day: 'numeric', month: 'short' })}${idx(to) < 0 ? '' : ' →'}</span>`;
        return `<div class="tl-row" data-task="${t.id}"><div class="tl-name"><strong>${esc(t.title)}</strong><span class="tiny muted">${esc(t.client || t.department)}</span></div><div class="tl-track">${bar}</div></div>`;
      })];
  });
  return `<div class="card tl-card"><div class="tl-scroll"><div class="tl" style="--days:${days};--day:${dayW}px">
    <div class="tl-row tl-head"><div class="tl-name muted tiny">TASK</div><div class="tl-track">${weeks.map((w, i) => `<span style="left:${i * 7 * dayW}px">${fmtDate(w, { day: 'numeric', month: 'short' }).toUpperCase()}</span>`).join('')}</div></div>
    ${rows.join('') || `<div style="padding:30px">${empty('calendar', 'No tasks here')}</div>`}
    <i class="tl-today" style="left:calc(var(--name) + ${idx(today) * dayW + dayW / 2}px)" title="Today"></i>
  </div></div></div>`;
}

async function viewTasks(params) {
  taskMeta = await api('/tasks/meta');
  const role = me.role;
  const scopes = role === 'owner'
    ? [['all', 'All tasks'], ['created', 'Created by me']]
    : role === 'lead'
      ? [['team', `Team · ${me.department || ''}`], ['inbox', 'To assign', taskMeta.counts.inbox], ['mine', 'My tasks']]
      : taskMeta.is_am
        ? [['created', 'My requests', taskMeta.counts.to_review], ['mine', 'My tasks']]
        : [['mine', 'My tasks']];
  const scope = scopes.some((x) => x[0] === params.get('scope')) ? params.get('scope') : scopes[0][0];
  let view = params.get('view') || store.get('taskView', 'board');
  if (!TASK_VIEWS[view]) view = 'board';
  let q = '';
  let client = '';
  let dept = '';
  let list = await api(`/tasks?scope=${scope}`);
  const today = localISODate();
  const openCount = list.filter((t) => t.status !== 'done').length;
  const late = list.filter((t) => t.status !== 'done' && t.due_date && t.due_date < today).length;
  const subtitle = role === 'lead' && taskMeta.counts.inbox
    ? `<b style="color:var(--amber-ink, inherit)">${taskMeta.counts.inbox} new task${taskMeta.counts.inbox === 1 ? '' : 's'} waiting for you to assign</b>`
    : `${openCount} open${late ? ` · <b style="color:var(--red)">${late} late</b>` : ''}${taskMeta.is_am ? ' · send work to any department' : ''}`;

  $('#app').innerHTML = `
    ${pageHead('Tasks', subtitle, taskMeta.can_create ? `<button class="btn" id="new-task">${icon('plus')}New task</button>` : '')}
    ${scopes.length > 1 ? `<div class="seg task-scopes" style="margin-bottom:12px">${scopes.map(([k, label, n]) => `<a href="#/tasks?scope=${k}" class="${k === scope ? 'on' : ''}">${esc(label)}${n ? ` <i class="nav-badge static">${n}</i>` : ''}</a>`).join('')}</div>` : ''}
    <div class="task-toolbar">
      <div class="seg" id="tview">${Object.entries(TASK_VIEWS).map(([k, [label, ic]]) => `<button type="button" data-v="${k}" class="${k === view ? 'on' : ''}">${icon(ic)}${label}</button>`).join('')}</div>
      <div class="input-icon task-search">${icon('search')}<input id="tq" placeholder="Search tasks"></div>
      ${taskMeta.clients.length ? `<select id="tclient" class="task-filter"><option value="">All clients</option>${taskMeta.clients.map((c) => `<option>${esc(c)}</option>`).join('')}</select>` : ''}
      ${role === 'owner' || taskMeta.is_am ? `<select id="tdept" class="task-filter"><option value="">All departments</option>${(rules().departments || []).map((d) => `<option>${esc(d)}</option>`).join('')}</select>` : ''}
    </div>
    <div id="tasks"></div>`;

  const draw = () => {
    const rows = list
      .filter((t) => !client || t.client === client)
      .filter((t) => !dept || t.department === dept)
      .filter((t) => !q || `${t.title} ${t.client || ''} ${t.description || ''} ${t.assignee_name || ''}`.toLowerCase().includes(q));
    $('#tasks').innerHTML = !list.length
      ? `<div class="card">${empty('kanban', scope === 'inbox' ? 'Nothing to assign. All caught up!' : scope === 'mine' ? 'No tasks for you yet. Enjoy the calm ☕' : 'No tasks yet',
          taskMeta.can_create && scope !== 'inbox' ? `<button class="btn sm" id="new-task-2">${icon('plus')}Create the first task</button>` : '')}</div>`
      : view === 'list' ? listHtml(rows) : view === 'timeline' ? timelineHtml(rows) : boardHtml(rows);
    $$('#tasks [data-task]').forEach((el) => el.addEventListener('click', () => openTask(Number(el.dataset.task))));
    $('#new-task-2')?.addEventListener('click', () => taskForm());
    if (view === 'board') {
      bindDrag();
      // Phones show one column at a time: start at the first one with work in it.
      const first = $$('.task-col').find((c) => c.querySelector('.task-card'));
      if (first && matchMedia('(max-width: 640px)').matches) $('.task-board').scrollLeft = first.offsetLeft - 16;
    }
    if (view === 'timeline') {
      const sc = $('.tl-scroll');
      const line = $('.tl-today');
      if (sc && line) sc.scrollLeft = Math.max(0, line.offsetLeft - sc.clientWidth / 2);
    }
  };
  // Desktop: drag a card to another column to change its status.
  const bindDrag = () => {
    let dragId = null;
    $$('.task-card').forEach((c) => {
      c.addEventListener('dragstart', (e) => { dragId = Number(c.dataset.task); c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      c.addEventListener('dragend', () => { c.classList.remove('dragging'); $$('.task-col').forEach((x) => x.classList.remove('drop')); });
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter') openTask(Number(c.dataset.task)); });
    });
    $$('.task-col').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drop');
        const t = list.find((x) => x.id === dragId);
        if (!t || t.status === col.dataset.status) return;
        const prev = t.status;
        t.status = col.dataset.status;
        draw();
        try {
          await api(`/tasks/${t.id}`, { method: 'PATCH', body: { status: t.status } });
          if (t.status === 'done') { confetti({ count: 70 }); chime(); }
          toast(`Moved to ${TASK_STATUS[t.status][0]}`, 'success');
        } catch (err) {
          t.status = prev;
          draw();
          toast(err.message, 'error');
        }
      });
    });
  };
  $$('#tview button').forEach((b) => (b.onclick = () => {
    view = b.dataset.v;
    store.set('taskView', view);
    $$('#tview button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
    animateIn($('#tasks'));
  }));
  $('#tq').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  if ($('#tclient')) $('#tclient').onchange = (e) => { client = e.target.value; draw(); };
  if ($('#tdept')) $('#tdept').onchange = (e) => { dept = e.target.value; draw(); };
  $('#new-task')?.addEventListener('click', () => taskForm());
  taskReload = async () => {
    if (parseHash().path !== 'tasks') return;
    list = await api(`/tasks?scope=${scope}`);
    draw();
  };
  draw();
  if (params.get('task')) openTask(Number(params.get('task')));
}

// Create or edit a task.
function taskForm(t = null) {
  const m = taskMeta;
  const depts = m.departments;
  const canPick = (d) => me.role === 'owner' || (me.role === 'lead' && me.department === d);
  const startDept = t?.department || (me.role === 'lead' ? me.department : '') || '';
  modal({
    title: t ? 'Edit task' : 'New task',
    sub: t ? '' : me.role === 'owner' ? 'Send it to a department, or assign someone directly.' : me.role === 'lead' ? 'For your own team you can assign someone directly; other departments get it in their lead\'s inbox.' : 'It goes to the department lead, who assigns it to someone on the team.',
    body: `<div class="grid" style="gap:14px">
      <label class="f">What needs doing?<input name="title" maxlength="140" required value="${esc(t?.title || '')}" placeholder="e.g. 3 reels for the Ramadan campaign"></label>
      <div class="form-grid two">
        <label class="f">Client<input name="client" maxlength="80" list="client-list" value="${esc(t?.client || '')}" placeholder="e.g. Nike Egypt" autocomplete="off">
          <datalist id="client-list">${m.clients.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="f">Department<select name="department" required ${t && !t.can.change_department ? 'disabled' : ''}><option value="">Choose…</option>${depts.map((d) => `<option ${d === startDept ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
      </div>
      <div class="f"><span>Priority</span><div class="choice">${Object.entries(PRIORITY).map(([k, [label]]) => `<label><input type="radio" name="priority" value="${k}" ${(t?.priority || 'medium') === k ? 'checked' : ''}>${k === 'urgent' ? '🔥 ' : ''}${label}</label>`).join('')}</div></div>
      <div class="form-grid two">
        <label class="f">Start<input type="date" name="start_date" value="${esc(t?.start_date || '')}"></label>
        <label class="f">Due<input type="date" name="due_date" value="${esc(t?.due_date || '')}"></label>
      </div>
      <label class="f">Brief<textarea name="description" maxlength="4000" rows="3" placeholder="Goal, references, links, deliverables…">${esc(t?.description || '')}</textarea></label>
      ${t ? '' : `<label class="f">Checklist <span class="muted tiny">one step per line (optional)</span><textarea name="items" rows="3" placeholder="Script\nShoot\nEdit\nClient approval"></textarea></label>`}
      ${t ? '' : `<label class="f" id="assign-wrap" hidden>Assign to <span class="muted tiny">(optional)</span><select name="assignee_id"></select></label>`}
    </div>`,
    submit: t ? 'Save' : 'Create task',
    onSubmit: async (d) => {
      const body = { ...d, start_date: d.start_date || null, due_date: d.due_date || null };
      if (t) {
        if (!t.can.change_department) delete body.department;
        await api(`/tasks/${t.id}`, { method: 'PATCH', body });
        toast('Saved', 'success');
        setTimeout(() => openTask(t.id), 60);
      } else {
        body.items = String(d.items || '').split('\n').map((x) => x.trim()).filter(Boolean);
        body.assignee_id = d.assignee_id ? Number(d.assignee_id) : null;
        const row = await api('/tasks', { method: 'POST', body });
        confetti({ count: 50 });
        toast(body.assignee_id ? 'Task assigned' : `Sent to ${body.department}. Their lead will assign it`, 'success');
        if (parseHash().path === 'tasks') await taskReload?.();
        else go(`#/tasks?scope=${me.role === 'owner' ? 'all' : me.role === 'lead' ? 'team' : 'created'}`);
        return row;
      }
      await taskReload?.();
    },
  });
  // Show "Assign to" only for departments this person may assign in, with each member's workload.
  const form = $('#modal form');
  const syncAssign = () => {
    const wrap = $('#assign-wrap', form);
    if (!wrap) return;
    const d = form.department.value;
    const people = m.people.filter((p) => p.department === d);
    wrap.hidden = !canPick(d) || !people.length;
    form.assignee_id.innerHTML = `<option value="">Leave for the lead to assign</option>${people.map((p) => `<option value="${p.id}">${esc(p.name)} · ${p.open_tasks} open</option>`).join('')}`;
    if (me.role === 'lead' && d === me.department) form.assignee_id.options[0].textContent = 'Not yet';
  };
  form.department.onchange = syncAssign;
  syncAssign();
}

async function openTask(id) {
  const dlg = $('#modal');
  let t;
  try {
    t = await api(`/tasks/${id}`);
  } catch (err) {
    return toast(err.message, 'error');
  }
  const isMine = t.assignee_id === me.id;
  const next = [];
  if (t.status === 'todo' && t.can.work && t.assignee_id) next.push(['in_progress', '▶️ Start', '']);
  if (t.status === 'in_progress' && t.can.work) next.push(['review', '👀 Send for review', '']);
  if (t.status === 'review' && t.can.manage) next.push(['done', '✅ Approve', 'green'], ['in_progress', '↩️ Send back', 'light']);
  if (t.status === 'done' && t.can.manage) next.push(['in_progress', 'Reopen', 'light']);
  if (t.status === 'review' && isMine && !t.can.manage) next.push(['in_progress', 'Keep working', 'light']);
  const people = (taskMeta?.people || []).filter((p) => p.department === t.department);
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  dlg.className = 'modal task-modal';
  dlg.dataset.task = id;
  dlg.innerHTML = `<div class="card">
    <div class="row between" style="align-items:flex-start;gap:10px">
      <div class="task-tags">${chip(TASK_STATUS, t.status)}<span class="chip ${PRIORITY[t.priority][1]}">${icon('flag')}${PRIORITY[t.priority][0]}</span>${t.client ? `<span class="chip">${esc(t.client)}</span>` : ''}</div>
      <div class="row" style="gap:6px">${t.can.manage ? `<button class="icon-btn sm" data-act="edit" aria-label="Edit">${icon('pen')}</button>` : ''}
        ${t.can.delete ? `<button class="icon-btn sm" data-act="delete" aria-label="Delete task" title="Delete task">${icon('trash')}</button>` : ''}
        <button class="icon-btn ghost" data-close aria-label="Close">${icon('x')}</button></div>
    </div>
    <h2 class="task-title">${esc(t.title)}</h2>
    <div class="task-meta">
      <div><span>Department</span><strong>${esc(t.department)}</strong></div>
      <div><span>Assigned to</span>${t.can.assign
        ? `<select id="t-assign"><option value="">Unassigned</option>${people.map((p) => `<option value="${p.id}" ${p.id === t.assignee_id ? 'selected' : ''}>${esc(p.name)} · ${p.open_tasks} open</option>`).join('')}</select>`
        : `<strong>${t.assignee_name ? esc(t.assignee_name) : '<span class="chip amber">Waiting for the lead</span>'}</strong>`}</div>
      <div><span>Requested by</span><strong>${esc(t.created_by_name || '—')}</strong></div>
      <div><span>Due</span><strong>${t.due_date ? `${dueChip(t)}` : '—'}</strong></div>
    </div>
    ${next.length ? `<div class="row wrap task-actions">${next.map(([s, label, cls]) => `<button class="btn ${cls}" data-status="${s}">${label}</button>`).join('')}</div>` : ''}
    ${t.description ? `<div class="task-brief">${esc(t.description).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')}</div>` : ''}
    <div class="task-section">
      <div class="row between"><h3>Checklist</h3><span class="muted small num">${t.items.filter((i) => i.done).length}/${t.items.length}</span></div>
      ${t.items.length ? `<div class="task-progress big"><i style="width:${pct(t.items.filter((i) => i.done).length, t.items.length)}%"></i></div>` : ''}
      <div class="task-items">${t.items.map((i) => `<label class="task-item ${i.done ? 'done' : ''}"><input type="checkbox" data-item="${i.id}" ${i.done ? 'checked' : ''} ${t.can.work ? '' : 'disabled'}><span>${esc(i.text)}</span>
        ${t.can.manage ? `<button type="button" class="icon-btn xs ghost" data-del-item="${i.id}" aria-label="Remove">${icon('x')}</button>` : ''}</label>`).join('')}</div>
      ${t.can.work ? `<form class="row task-add" id="t-item"><input name="text" maxlength="200" placeholder="Add a step…" autocomplete="off"><button class="btn sm light" type="submit">${icon('plus')}</button></form>` : ''}
    </div>
    ${filesSection(t)}
    <div class="task-section">
      <h3>Activity</h3>
      <div class="task-feed">${t.comments.map((c) => c.kind === 'event'
        ? `<div class="task-event"><span class="dot"></span><span><b>${esc(c.user_name || 'Someone')}</b> ${esc(c.body)}</span><span class="tiny muted">${when(c.created_at)}</span></div>`
        : `<div class="task-comment ${c.user_id === me.id ? 'mine' : ''}">${avatar(c.user_name || '?', 'sm')}<div><div class="row between"><b class="small">${esc(c.user_name || '')}</b><span class="tiny muted">${when(c.created_at)}</span></div><p>${esc(c.body).replace(/\n/g, '<br>')}</p></div></div>`).join('')}</div>
      <form class="task-reply" id="t-comment"><textarea name="body" rows="1" maxlength="2000" placeholder="Write a comment…"></textarea><button class="btn" type="submit" aria-label="Send">${icon('arrow')}</button></form>
    </div>
  </div>`;
  const reopen = async (msg) => {
    if (msg) toast(msg, 'success');
    await openTask(id);
    taskReload?.();
    refreshCounts().then(() => renderShell(parseHash().path));
  };
  $$('[data-close]', dlg).forEach((b) => (b.onclick = () => dlg.close()));
  dlg.onclose = () => { dlg.className = 'modal'; delete dlg.dataset.task; setTimeout(drawUploads); };
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  $$('[data-status]', dlg).forEach((b) => (b.onclick = () => act(b, async () => {
    await api(`/tasks/${id}`, { method: 'PATCH', body: { status: b.dataset.status } });
    if (b.dataset.status === 'done') { confetti({ count: 90 }); chime(); }
    await reopen(`${TASK_STATUS[b.dataset.status][0]}`);
  })));
  $('#t-assign', dlg)?.addEventListener('change', (e) => act(e.target, async () => {
    await api(`/tasks/${id}`, { method: 'PATCH', body: { assignee_id: e.target.value ? Number(e.target.value) : null } });
    await reopen(e.target.value ? `Assigned to ${e.target.selectedOptions[0].textContent.split(' · ')[0]}` : 'Unassigned');
  }));
  $$('[data-item]', dlg).forEach((c) => (c.onchange = async () => {
    try {
      await api(`/tasks/${id}/items/${c.dataset.item}/toggle`, { method: 'POST', body: {} });
      if (c.checked) haptic(15);
      await reopen();
    } catch (err) { toast(err.message, 'error'); }
  }));
  $$('[data-del-item]', dlg).forEach((b) => (b.onclick = (e) => {
    e.preventDefault();
    act(b, async () => { await api(`/tasks/${id}/items/${b.dataset.delItem}/delete`, { method: 'POST', body: {} }); await reopen(); });
  }));
  $('#t-item', dlg)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (text) act(e.submitter, async () => { await api(`/tasks/${id}/items`, { method: 'POST', body: { text } }); await reopen(); });
  });
  const reply = $('#t-comment', dlg);
  reply.body.oninput = () => { reply.body.style.height = 'auto'; reply.body.style.height = `${Math.min(140, reply.body.scrollHeight)}px`; };
  reply.onsubmit = (e) => {
    e.preventDefault();
    const body = reply.body.value.trim();
    if (body) act(e.submitter, async () => { await api(`/tasks/${id}/comments`, { method: 'POST', body: { body } }); await reopen(); });
  };
  bindFiles(t, dlg, reopen);
  drawUploads(); // the sheet was just re-rendered: put the upload tray back
  $('[data-act=edit]', dlg)?.addEventListener('click', () => taskForm(t));
  $('[data-act=delete]', dlg)?.addEventListener('click', () => confirmBox('Delete this task?', 'Its checklist and comments are deleted too.', async () => {
    await api(`/tasks/${id}/delete`, { method: 'POST', body: {} });
    toast('Task deleted', 'success');
    taskReload?.();
  }, { submit: 'Delete' }));
  if (!dlg.open) dlg.showModal();
  if (parseHash().params.get('task')) history.replaceState(null, '', location.href.replace(/([?&])task=\d+&?/, '$1').replace(/[?&]$/, ''));
}

// ---------- Task files: direct, chunked uploads to Google Drive ----------

const fmtBytes = (n) => {
  if (n == null) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
};
const fileEmoji = (f) => (f.kind === 'link' ? '🔗' : /^video/.test(f.mime) ? '🎬' : /^image/.test(f.mime) ? '🖼️' : /^audio/.test(f.mime) ? '🎧'
  : /pdf/.test(f.mime) ? '📕' : /zip|rar|7z|compressed/.test(f.mime || f.name) ? '🗜️' : /photoshop|illustrator|\.psd|\.ai$|figma/.test(`${f.mime} ${f.name}`) ? '🎨' : '📄');

const uploads = []; // { id, taskId, name, size, sent, state: 'up'|'done'|'error', error }
const CHUNK = 16 * 1024 * 1024; // must be a multiple of 256 KB

function drawUploads() {
  let tray = $('#upload-tray');
  const active = uploads.filter((u) => u.state !== 'gone');
  if (!active.length) return tray?.remove();
  if (!tray) {
    tray = document.createElement('div');
    tray.id = 'upload-tray';
  }
  // An open sheet is in the browser's top layer, so the tray lives inside it while it's open.
  const host = $('#modal').open ? $('#modal') : document.body;
  if (tray.parentElement !== host) host.append(tray);
  const busy = active.filter((u) => u.state === 'up' || u.state === 'queued');
  tray.innerHTML = `<div class="row between"><strong class="small">${busy.length ? `Uploading ${busy.length} file${busy.length === 1 ? '' : 's'}…` : 'Uploads finished'}</strong>
      ${busy.length ? '' : `<button class="icon-btn xs ghost" type="button" data-tray-close aria-label="Close">${icon('x')}</button>`}</div>
    ${active.map((u) => `<div class="up-row ${u.state}"><div class="row between small"><span class="up-name">${esc(u.name)}</span>
        <span class="tiny muted nowrap">${u.state === 'done' ? '✓ Done' : u.state === 'error' ? 'Failed' : u.state === 'queued' ? 'Waiting…' : `${pct(u.sent, u.size)}% · ${fmtBytes(u.sent)} / ${fmtBytes(u.size)}`}</span></div>
      <div class="task-progress"><i style="width:${u.state === 'done' ? 100 : pct(u.sent, u.size)}%"></i></div>
      ${u.error ? `<div class="tiny" style="color:var(--red)">${esc(u.error)}</div>` : ''}</div>`).join('')}`;
  $('[data-tray-close]', tray)?.addEventListener('click', () => { uploads.forEach((u) => (u.state = 'gone')); drawUploads(); });
}

// PUT one chunk with progress. Resolves with { status, range } (range = last byte Google has).
function putChunk(url, blob, start, total, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (blob) xhr.setRequestHeader('Content-Range', `bytes ${start}-${start + blob.size - 1}/${total}`);
    else xhr.setRequestHeader('Content-Range', `bytes */${total}`);
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader('Range') });
    xhr.onerror = () => reject(new Error('Connection lost'));
    xhr.send(blob || null);
  });
}

async function uploadFile(task, file, done) {
  const u = { id: Math.random(), taskId: task.id, name: file.name, size: file.size, sent: 0, state: 'up' };
  uploads.push(u);
  drawUploads();
  try {
    const { upload_url: url } = await api(`/tasks/${task.id}/uploads`, { method: 'POST', body: { name: file.name, size: file.size, mime: file.type } });
    let offset = 0;
    let tries = 0;
    while (offset < file.size) {
      const end = Math.min(file.size, offset + CHUNK);
      try {
        const r = await putChunk(url, file.slice(offset, end), offset, file.size, (n) => { u.sent = offset + n; drawUploads(); });
        if (r.status === 308) offset = r.range ? Number(r.range.split('-')[1]) + 1 : end;
        else if (r.status === 200 || r.status === 201) offset = file.size;
        else throw new Error(`Google answered ${r.status}`);
        tries = 0;
      } catch (err) {
        // Dropped connection: wait, ask Google how much arrived, and carry on from there.
        if (++tries > 6) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** tries));
        try {
          const r = await putChunk(url, null, 0, file.size);
          if (r.status === 200 || r.status === 201) offset = file.size;
          else if (r.status === 308) offset = r.range ? Number(r.range.split('-')[1]) + 1 : offset;
        } catch { /* still offline: retry the same chunk */ }
      }
      u.sent = offset;
      drawUploads();
    }
    u.state = 'done';
    done?.(file.name);
  } catch (err) {
    u.state = 'error';
    u.error = err.message === 'Connection lost' ? 'Connection lost. Try again on a stable connection.' : err.message;
  }
  drawUploads();
}

async function uploadFiles(task, files) {
  const names = [];
  const list = [...files];
  // One at a time: full bandwidth for each file and a clear queue in the tray.
  list.forEach((f) => uploads.push({ id: Math.random(), taskId: task.id, name: f.name, size: f.size, sent: 0, state: 'queued', file: f }));
  drawUploads();
  for (const f of list) {
    const q = uploads.findIndex((u) => u.file === f && u.state === 'queued');
    if (q >= 0) uploads.splice(q, 1);
    await uploadFile(task, f, (n) => names.push(n));
  }
  if (!names.length) return;
  try {
    await api(`/tasks/${task.id}/files/sync`, { method: 'POST', body: { names } });
    toast(names.length === 1 ? `${names[0]} uploaded` : `${names.length} files uploaded`, 'success');
    chime();
  } catch (err) {
    toast(err.message, 'error');
  }
  if ($('#modal').open && $('#modal').dataset.task === String(task.id)) openTask(task.id);
  taskReload?.();
}
window.addEventListener('beforeunload', (e) => {
  if (uploads.some((u) => u.state === 'up')) e.preventDefault();
});

function filesSection(t) {
  const up = t.uploads;
  return `<div class="task-section">
    <div class="row between"><h3>Files</h3><span class="muted small">${t.files.length || ''}</span></div>
    ${t.files.length ? `<div class="task-files">${t.files.map((f) => `<div class="task-file">
        <a class="task-file-main" href="${esc(f.url)}" target="_blank" rel="noopener">
          ${f.kind === 'drive' && /^(image|video)/.test(f.mime || '') ? `<img class="file-thumb" loading="lazy" alt="" src="https://drive.google.com/thumbnail?id=${encodeURIComponent(f.drive_id)}&sz=w160" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'file-ico',textContent:'${fileEmoji(f)}'}))">` : `<span class="file-ico">${fileEmoji(f)}</span>`}
          <span class="grow"><strong>${esc(f.name)}</strong><span class="tiny muted">${[f.kind === 'link' ? 'Link' : fmtBytes(f.size), f.user_name, relTime(f.created_at)].filter(Boolean).map(esc).join(' · ')}</span></span></a>
        ${f.kind === 'drive' ? `<a class="icon-btn xs" href="https://drive.google.com/uc?id=${encodeURIComponent(f.drive_id)}&export=download" target="_blank" rel="noopener" aria-label="Download" title="Download">${icon('download')}</a>` : ''}
        ${f.can_delete ? `<button class="icon-btn xs ghost" type="button" data-del-file="${f.id}" data-name="${esc(f.name)}" aria-label="Remove">${icon('trash')}</button>` : ''}</div>`).join('')}</div>` : ''}
    ${up.allowed ? `${up.drive
        ? `<label class="dropzone" id="t-drop"><input type="file" id="t-file" multiple hidden>
            <span>${icon('download')}</span><span><strong>Drop files or tap to upload</strong><span class="tiny muted">Saved to Google Drive · up to ${up.max_mb >= 1024 ? `${Math.round(up.max_mb / 102.4) / 10} GB` : `${up.max_mb} MB`} each</span></span></label>`
        : `<div class="notice slate small">${icon('alert')}<span>File uploads need Google Drive. ${me.role === 'owner' ? '<a href="#/settings?open=files">Connect it in Settings</a>' : 'Ask the owner to connect it.'} You can still add a link below.</span></div>`}
      <form class="row task-add" id="t-link"><input name="url" type="url" placeholder="…or paste a link (WeTransfer, Frame.io, Drive)" autocomplete="off"><button class="btn sm light" type="submit">${icon('plus')}</button></form>` : ''}
  </div>`;
}

function bindFiles(t, dlg, reopen) {
  const input = $('#t-file', dlg);
  const drop = $('#t-drop', dlg);
  if (input) input.onchange = () => { if (input.files.length) uploadFiles(t, input.files); input.value = ''; };
  if (drop) {
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) uploadFiles(t, e.dataTransfer.files); });
  }
  $('#t-link', dlg)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = e.target.url.value.trim();
    if (url) act(e.submitter, async () => { await api(`/tasks/${t.id}/links`, { method: 'POST', body: { url } }); await reopen('Link added'); });
  });
  $$('[data-del-file]', dlg).forEach((b) => (b.onclick = () => act(b, async () => {
    await api(`/tasks/${t.id}/files/${b.dataset.delFile}/delete`, { method: 'POST', body: {} });
    await reopen(`${b.dataset.name} removed`);
  })));
}

// Compact "my tasks" card for the employee home page.
function myTasksCard(list) {
  const open = list.filter((t) => t.status !== 'done').slice(0, 4);
  if (!open.length) return '';
  return `<div class="card"><div class="card-head"><h2>My tasks</h2><a class="btn sm light" href="#/tasks">All</a></div>
    <div class="list">${open.map((t) => `<a class="list-item" href="#/tasks?task=${t.id}" style="text-decoration:none">
      <span class="avatar sm ${TASK_STATUS[t.status][1]}">${icon('kanban')}</span>
      <div class="grow"><strong>${esc(t.title)}</strong><span>${[t.client, TASK_STATUS[t.status][0]].filter(Boolean).map(esc).join(' · ')}</span></div>${dueChip(t)}</a>`).join('')}</div></div>`;
}

// ---------- Culture: kudos, wall, people, profiles ----------

async function kudosModal(toId = null, cat = 'creative') {
  const people = (await api('/people')).filter((p) => p.id !== me.id);
  modal({
    title: 'Send kudos 🙌',
    sub: me.role === 'owner' ? 'Recognise great work. It shows on the Team Wall for everyone.' : `Recognise a teammate. You can send ${rules().kudos_daily_limit ?? 3} a day.`,
    body: `<div class="grid" style="gap:14px">
      <label class="f">Teammate<select name="to_user_id" required><option value="">Choose…</option>${people
        .map((p) => `<option value="${p.id}" ${p.id === toId ? 'selected' : ''}>${esc(p.name)}${p.department ? ` · ${esc(p.department)}` : ''}</option>`)
        .join('')}</select></label>
      <div class="f"><span>What for?</span><div class="cat-grid">${Object.entries(KUDOS)
        .map(([k, [em, label, cls]]) => `<label class="${cls}"><input type="radio" name="category" value="${k}" ${k === (cat || 'creative') ? 'checked' : ''}><b>${em}</b>${label}</label>`)
        .join('')}</div></div>
      <label class="f">Message <span class="muted tiny">(optional)</span><textarea name="message" maxlength="280" placeholder="That reel you cut for the client was 🔥"></textarea></label>
    </div>`,
    submit: 'Send kudos',
    onSubmit: async (d, form) => {
      await api('/kudos', { method: 'POST', body: { ...d, to_user_id: Number(d.to_user_id) } });
      burst(KUDOS[d.category][0], form.querySelector('[type=submit]'), 10);
      confetti({ count: 90 });
      chime('success');
      toast('Kudos sent! 🙌', 'success');
      if (['wall', 'person', 'profile', ''].includes(parseHash().path)) setTimeout(route, 250);
    },
  });
}

function kudoCard(k, { compact = false } = {}) {
  const [em, label, cls] = KUDOS[k.category] || ['🙌', 'Kudos', 'lime'];
  const canDelete = me.role === 'owner' || k.from_user === me.id;
  const reacted = Object.fromEntries((k.reactions || []).map((r) => [r.emoji, r]));
  return `<div class="card kudo" style="margin:0">
    <div class="row">${avatar(k.from_name, 'sm')}<span class="small nowrap"><strong>${esc(k.from_name)}</strong> <span class="muted">→</span></span>
      <a href="#/person?id=${k.to_user}" class="row" style="text-decoration:none;gap:8px">${avatar(k.to_name, 'sm')}<strong class="small">${esc(k.to_name)}</strong></a>
      <span class="spacer"></span><span class="tiny muted nowrap">${relTime(k.created_at)}</span>
      ${canDelete && !compact ? `<button class="icon-btn xs ghost" data-del-kudo="${k.id}" aria-label="Delete">${icon('x')}</button>` : ''}</div>
    <div class="mt"><span class="kudo-tag ${cls}">${em} ${label}</span></div>
    ${k.message ? `<p class="msg">${esc(k.message)}</p>` : '<div style="height:10px"></div>'}
    ${compact ? '' : `<div class="reacts" data-kudo="${k.id}">${REACTIONS.map((e) => {
      const r = reacted[e];
      return `<button type="button" data-react="${e}" class="${r?.mine ? 'mine' : r ? '' : 'add'}">${e}${r ? ` <span class="num">${r.n}</span>` : ''}</button>`;
    }).join('')}</div>`}
  </div>`;
}

function bindKudoCards(root, reload) {
  $$('[data-react]', root).forEach((b) => (b.onclick = async () => {
    const id = b.closest('[data-kudo]').dataset.kudo;
    try {
      const r = await api(`/kudos/${id}/react`, { method: 'POST', body: { emoji: b.dataset.react } });
      if (r.reacted) { burst(b.dataset.react, b, 6); haptic(15); }
      reload();
    } catch (err) { toast(err.message, 'error'); }
  }));
  $$('[data-del-kudo]', root).forEach((b) => (b.onclick = () => confirmBox('Delete this kudos?', 'It will be removed from the Team Wall.', async () => {
    await api(`/kudos/${b.dataset.delKudo}`, { method: 'DELETE' });
    reload();
  }, { submit: 'Delete' })));
}

async function viewWall(params) {
  const filter = params.get('f') || 'all';
  const [wall, ann] = await Promise.all([
    api(`/kudos${filter === 'mine' ? `?user_id=${me.id}` : ''}`),
    api('/announcements'),
  ]);
  const limit = rules().kudos_daily_limit ?? 3;
  const left = me.role === 'owner' ? '∞' : Math.max(0, limit - wall.sent_today);
  $('#app').innerHTML = `
    ${pageHead('Team Wall <span class="wave">🎉</span>', 'Shout-outs, wins and news from across the agency.', `
      <div class="seg"><a href="#/wall" class="${filter === 'all' ? 'on' : ''}">Everyone</a><a href="#/wall?f=mine" class="${filter === 'mine' ? 'on' : ''}">Mine</a></div>
      <button class="btn" data-kudos-to="">${icon('heart')}Send kudos</button>`)}
    <div class="dash">
      <div class="stack-col">
        <div class="tile lime" style="min-height:auto">
          <div class="row between wrap"><div><div class="t-title" style="max-width:none">Who made your day better? 💛</div>
            <div class="t-sub" style="margin-top:4px">${me.role === 'owner' ? 'Recognition from the top means the most.' : `${left} kudos left today. They reset tomorrow.`}</div></div>
            <div class="chips">${Object.entries(KUDOS).map(([k, [em, label]]) => `<button class="chip" type="button" data-kudos-to="" data-kudos-cat="${k}">${em} ${label}</button>`).join('')}</div></div>
        </div>
        <div class="grid" id="kudos" style="gap:12px">${
          wall.rows.length ? wall.rows.map((k) => kudoCard(k)).join('') : `<div class="card">${empty('heart', 'No kudos yet. Be the first to say thanks!')}</div>`
        }</div>
      </div>
      <div class="stack-col">
        ${me.role === 'owner' ? `<div class="card"><div class="card-head"><h2>Post an announcement</h2>${icon('megaphone')}</div>
          <form id="ann" class="grid" style="gap:12px">
            <input name="title" maxlength="120" placeholder="e.g. Team lunch on Thursday 🍕" required>
            <textarea name="body" maxlength="1000" placeholder="Details (optional)"></textarea>
            <div class="choice">${Object.entries(ANNOUNCE).map(([k, [em, label]], i) => `<label><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''}>${em} ${label}</label>`).join('')}</div>
            <div class="row between"><label class="toggle"><input type="checkbox" name="pinned">Pin to top of everyone's home</label><button class="btn" type="submit">Post</button></div>
          </form></div>` : ''}
        <div class="card"><div class="card-head"><h2>Announcements</h2></div>
          <div class="grid" style="gap:10px">${ann.length ? ann.map((a) => announceHtml(a, me.role === 'owner')).join('') : empty('megaphone', 'No announcements yet')}</div></div>
      </div>
    </div>`;
  bindKudoCards($('#kudos'), route);
  bindAnnouncements($('#app'));
  const form = $('#ann');
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const d = formData(form);
      act(e.submitter, async () => {
        await api('/admin/announcements', { method: 'POST', body: { ...d, pinned: !!d.pinned } });
        if (d.kind === 'celebration') confetti();
        route();
      }, 'Announcement posted');
    };
  }
}

function announceHtml(a, manage = false, dismissible = false) {
  const [em, label, cls] = ANNOUNCE[a.kind] || ANNOUNCE.news;
  return `<div class="announce ${cls}" data-ann="${a.id}"><span class="em float">${em}</span>
    <div style="flex:1;min-width:0"><div class="row wrap" style="gap:6px"><h3>${esc(a.title)}</h3>${a.pinned ? '<span class="chip">📌 Pinned</span>' : ''}</div>
      ${a.body ? `<p>${esc(a.body)}</p>` : ''}<div class="tiny" style="opacity:.7;margin-top:6px">${label} · ${esc(a.author || 'Team')} · ${relTime(a.created_at)}</div></div>
    ${manage ? `<div class="row" style="gap:4px"><button class="icon-btn xs" data-pin="${a.id}" data-pinned="${a.pinned}" title="${a.pinned ? 'Unpin' : 'Pin'}" aria-label="Pin">📌</button>
      <button class="icon-btn xs" data-del-ann="${a.id}" aria-label="Delete">${icon('x')}</button></div>` : ''}
    ${dismissible ? `<button class="icon-btn xs ghost" data-dismiss="${a.id}" aria-label="Dismiss">${icon('x')}</button>` : ''}</div>`;
}

function bindAnnouncements(root) {
  $$('[data-pin]', root).forEach((b) => (b.onclick = () => act(b, async () => {
    await api(`/admin/announcements/${b.dataset.pin}`, { method: 'PATCH', body: { pinned: b.dataset.pinned !== '1' } });
    route();
  })));
  $$('[data-del-ann]', root).forEach((b) => (b.onclick = () => confirmBox('Delete announcement?', 'Everyone will stop seeing it.', async () => {
    await api(`/admin/announcements/${b.dataset.delAnn}`, { method: 'DELETE' });
    route();
  }, { submit: 'Delete' })));
}

async function viewPeople(params) {
  const people = await api('/people');
  const depts = [...new Set(people.map((p) => p.department).filter(Boolean))].sort();
  let dept = params.get('dept') || '';
  let q = '';
  const today = localISODate();
  const soon = upcomingCelebrations(people, today, 14);
  $('#app').innerHTML = `
    ${pageHead('People', `${people.length} people across ${depts.length || 1} department${depts.length === 1 ? '' : 's'}`, `<button class="btn" data-kudos-to="">${icon('heart')}Send kudos</button>`)}
    <div class="card" style="margin-bottom:16px"><div class="row wrap between">
      <div class="input-icon" style="flex:1;min-width:200px;max-width:360px">${icon('search')}<input id="q" placeholder="Search people"></div>
      <div class="seg" id="depts"><button type="button" data-d="" class="on">All</button>${depts.map((d) => `<button type="button" data-d="${esc(d)}">${esc(d)}</button>`).join('')}</div>
    </div></div>
    <div class="cards-grid" id="people"></div>`;
  const draw = () => {
    const list = people.filter((p) => (!dept || p.department === dept) && (!q || `${p.name} ${p.job_title || ''} ${p.department || ''}`.toLowerCase().includes(q)));
    $('#people').innerHTML = list.length
      ? list.map((p) => {
          const c = soon.find((x) => x.p.id === p.id);
          return `<div class="card" style="margin:0">
            <a href="#/person?id=${p.id}" class="row" style="text-decoration:none">${avatar(p.name, 'lg')}<div style="flex:1;min-width:0"><strong>${esc(p.name)}</strong>
              <div class="muted small">${p.role === 'owner' ? 'Owner' : esc(p.job_title || 'Team member')}</div></div></a>
            <div class="chips mt">${p.department ? `<span class="chip dept-chip">${esc(p.department)}</span>` : ''}${p.kudos_month ? `<span class="chip lime">🙌 ${p.kudos_month} this month</span>` : ''}
              ${c ? `<span class="chip pink">${c.kind === 'birthday' ? '🎂' : '🏆'} ${c.inDays === 0 ? 'Today' : fmtDate(c.date)}</span>` : ''}</div>
            ${p.id !== me.id ? `<div class="row mt"><button class="btn sm" data-kudos-to="${p.id}">${icon('heart')}Kudos</button><a class="btn sm light" href="#/person?id=${p.id}">Profile</a></div>` : ''}
          </div>`;
        }).join('')
      : `<div class="card" style="grid-column:1/-1">${empty('users', 'No one matches')}</div>`;
    animateIn($('#people'));
  };
  $$('#depts button').forEach((b) => (b.onclick = () => {
    dept = b.dataset.d;
    $$('#depts button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  $('#q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  draw();
}

async function viewPerson(params) {
  const id = Number(params.get('id')) || me.id;
  const [p, wall] = await Promise.all([api(`/people/${id}`), api(`/kudos?user_id=${id}`)]);
  const isMe = p.id === me.id;
  if (isMe) checkMilestones(p);
  const L = p.level;
  const fill = L.to ? pct(L.xp - L.from, L.to - L.from) : 100;
  const received = wall.rows.filter((k) => k.to_user === id);
  const unlocked = p.badges.filter((b) => b.unlocked).length;
  $('#app').innerHTML = `
    ${pageHead(isMe ? 'My Profile' : esc(p.name), isMe ? 'Your level, badges and kudos' : esc(p.job_title || 'Team member'),
      isMe ? `<a class="btn light" href="#/account">${icon('settings')}Account</a>` : `<button class="btn" data-kudos-to="${p.id}">${icon('heart')}Send kudos</button>
      ${me.role === 'owner' && p.role !== 'owner' ? `<a class="btn light" href="#/staff?id=${p.id}">${icon('activity')}Attendance</a>` : ''}`)}
    <div class="dash">
      <div class="stack-col">
        <div class="card">
          <div class="profile">
            <div class="photo ${hue(p.name)}">${esc(initials(p.name))}</div>
            <div class="meta">
              <div><h2>${esc(p.name)}</h2><p class="muted small">${p.role === 'owner' ? 'Owner' : esc(p.job_title || 'Team member')}${p.department ? ` · ${esc(p.department)}` : ''}</p></div>
              <div class="row wrap" style="gap:8px"><span class="level-chip"><b>${L.level}</b>${esc(L.name)}</span>
                ${p.streak ? `<span class="chip pink">🔥 ${p.streak}-day streak</span>` : ''}<span class="chip lime">🏅 ${unlocked} badge${unlocked === 1 ? '' : 's'}</span></div>
              <div class="info"><span>${icon('calendar')}Since ${fmtDate(p.start_date, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                ${p.birthday ? `<span>🎂 ${fmtDate(`2000-${p.birthday}`, { day: 'numeric', month: 'long' })}</span>` : ''}</div>
            </div>
          </div>
          <div class="mt"><div class="row between small"><span class="strong num">${L.xp.toLocaleString('en-US')} XP</span>
            <span class="muted">${L.to ? `${(L.to - L.xp).toLocaleString('en-US')} XP to ${esc(L.next_name)}` : 'Max level 👑'}</span></div>
            <div class="xp-bar" style="margin-top:8px"><i style="width:${Math.max(3, fill)}%"></i></div></div>
          <div class="kpis">
            ${kpi('Days present', p.stats.present, 'teal', Math.min(100, p.stats.present))}
            ${kpi('Kudos received', p.stats.kudos_in, 'lime', Math.min(100, p.stats.kudos_in * 10))}
            ${kpi('Kudos given', p.stats.kudos_out, 'pink', Math.min(100, p.stats.kudos_out * 10))}
          </div>
        </div>
        <div class="card"><div class="card-head"><h2>Badges</h2><span class="chip">${unlocked}/${p.badges.length}</span></div>${badgesGrid(p.badges)}</div>
      </div>
      <div class="stack-col">
        <div class="card"><div class="card-head"><h2>How XP works</h2></div>
          <div class="list small">
            <div class="list-item"><span class="avatar sm teal">📍</span><div class="grow"><strong>+10 XP</strong><span>every day you show up</span></div></div>
            <div class="list-item"><span class="avatar sm lime">🐦</span><div class="grow"><strong>+15 XP</strong><span>every early check-in</span></div></div>
            <div class="list-item"><span class="avatar sm pink">🙌</span><div class="grow"><strong>+20 XP</strong><span>every kudos you receive</span></div></div>
            <div class="list-item"><span class="avatar sm sky">💌</span><div class="grow"><strong>+5 XP</strong><span>every kudos you give</span></div></div>
            <div class="list-item"><span class="avatar sm amber">🏅</span><div class="grow"><strong>+50 XP</strong><span>every badge unlocked</span></div></div>
          </div></div>
        <div class="card"><div class="card-head"><h2>Kudos received</h2><span class="chip">${received.length}</span></div>
          <div class="grid" id="pk" style="gap:10px">${received.length ? received.slice(0, 8).map((k) => kudoCard(k, { compact: true })).join('') : empty('heart', isMe ? 'Your first kudos is on its way' : 'No kudos yet. Send the first one!')}</div></div>
      </div>
    </div>`;
}

start();
