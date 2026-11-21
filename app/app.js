/* ============================================================
   ByAzen — working messenger
   Local-first: data lives in this device's storage,
   message text is encrypted at rest with AES-GCM.
   ============================================================ */
'use strict';

/* ------------------------------------------------------------------
   MODES
   • demo   — всё локально, собеседники-симуляция (без сервера)
   • online — реальный сервер ByAzen: аккаунты, чаты, медиа, WebSocket
   ------------------------------------------------------------------ */

const LS_DATA = 'byazen.data.v1';
const LS_KEY  = 'byazen.deckey.v1';
const LS_PREFS = 'byazen.prefs.v1';
const LS_SESSION = 'byazen.session.v1';
const LS_SERVER = 'byazen.server.url';

const EMOJI = ['❤️', '🔥', '👍', '😂', '👀', '✨'];

/* ---------------- crypto helpers ---------------- */
let cryptoKey = null;

const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function ensureKey() {
  if (!window.crypto || !crypto.subtle) return false;
  let raw = localStorage.getItem(LS_KEY);
  if (!raw) {
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    raw = b64(new Uint8Array(await crypto.subtle.exportKey('raw', k)));
    localStorage.setItem(LS_KEY, raw);
  }
  cryptoKey = await crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return true;
}

async function encryptText(text) {
  if (!cryptoKey || !text) return text;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(text));
  return 'v1.' + b64(iv) + '.' + b64(new Uint8Array(ct));
}

async function decryptText(text) {
  if (!cryptoKey || typeof text !== 'string' || !text.startsWith('v1.')) return text;
  try {
    const [, ivs, cts] = text.split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivs) }, cryptoKey, unb64(cts));
    return new TextDecoder().decode(pt);
  } catch {
    return '‹сообщение не расшифровано›';
  }
}

/* ---------------- state ---------------- */
const AV = [
  ['linear-gradient(140deg,#9ECBFF,#4D7FE0)', '#07080b'],
  ['linear-gradient(140deg,#F0D9B5,#C98D5E)', '#1a1208'],
  ['linear-gradient(140deg,#C8B6FF,#7D5CF0)', '#0b0818'],
  ['linear-gradient(140deg,#B8F0DC,#4FC3A1)', '#04140f'],
  ['linear-gradient(140deg,#FFC9C9,#E06A7B)', '#170608'],
  ['linear-gradient(140deg,#BFD0FF,#5B6BDE)', '#060814'],
  ['linear-gradient(140deg,#FFE1A8,#E0A24A)', '#1a1204'],
];

const now = () => Date.now();
const uid = () => Math.random().toString(36).slice(2, 10) + now().toString(36).slice(-4);

let state = null;
let prefs = null;
let ui = {
  view: 'chats',
  chatId: null,
  search: '',
  searchOpen: false,
  replyTo: null,
  panel: null,
  recording: null,
  installEvt: null,
};

/* ---------------- seed data ---------------- */
function seed() {
  const t = now();
  const min = 60 * 1000;
  const mk = (id, name, handle, dirs, av, extra = {}) => ({
    id, name, handle, av,
    kind: extra.kind || 'dm',
    memberCount: extra.members || 2,
    members: [],
    muted: !!extra.muted,
    pinned: !!extra.pinned,
    quote: extra.quote || '',
    persona: extra.persona || 'calm',
    unread: extra.unread || 0,
    messages: dirs.map((m, i) => ({
      id: uid(),
      dir: m[0],
      text: m[1],
      ts: t - (dirs.length - i) * 3 * min - 5 * min,
      type: m[2] || 'text',
      status: 'read',
      reactions: {},
    })),
  });

  return {
    version: 1,
    me: { name: '', handle: '', quote: 'Пишу редко. Читаю всё.', avIndex: 0, avatar: null },
    chats: [
      mk('mila', 'Мила К.', '@mila', [
        ['in', 'Ты уже видел, какое небо сегодня?'],
        ['out', 'Нет. Покажи.'],
        ['in', 'Вечером скину. Оно цвета твоего экрана 🌌'],
        ['out', 'Тогда жду вечера.'],
      ], 0, { unread: 1, pinned: true, quote: 'Смотрю в окно чаще, чем в телефон.', persona: 'mila' }),

      mk('dima', 'Дима Ковач', '@kovach', [
        ['in', 'Слушай, у тебя остались те файлы?'],
        ['out', 'Да, скину вечером.'],
        ['in', 'Не горит, до завтра'],
      ], 1, { unread: 1, persona: 'dima' }),

      mk('lena', 'Лена П.', '@lenap', [
        ['in', 'Хорошо, тогда до завтра'],
        ['out', 'До завтра.'],
      ], 2, { muted: true, quote: 'Тихая, но не молчаливая.' }),

      mk('kuhnya', 'Круг «Кухня»', '7 человек', [
        ['in', 'Марк: кто за пасту?'],
        ['in', 'Оля: я за, но давайте в восемь'],
        ['out', 'В восемь удобно.'],
        ['in', 'Марк: тогда решено'],
      ], 3, { kind: 'circle', members: 7, unread: 2, persona: 'kuhnya' }),

      mk('olya', 'Оля С.', '@olya', [
        ['in', 'Спасибо большое!'],
        ['out', 'Всегда.'],
      ], 4, { persona: 'olya' }),

      mk('saved', 'Избранное', 'только вы', [], 5, { quote: 'Заметки для себя' }),
    ],
    prefs: {
      quiet: true,
      quietFrom: '23:00',
      quietTo: '08:00',
      sound: true,
      notifications: false,
      accent: 'aurora',
      density: 'comfortable',
    },
  };
}

const PERSONAS = {
  mila: ['Согласна 🌙', 'Ты как всегда вовремя', 'Покажу, обещаю', 'Тишина тоже ответ, знаешь?', 'Хорошо. До вечера.'],
  dima: ['Понял, спасибо', 'Окей, тогда завтра', 'Скинь, когда будет минутка', 'Не тороплю'],
  lena: ['Хорошо.', 'Договорились', 'Спокойной ночи', 'Пиши, если что'],
  kuhnya: ['Марк: поддерживаю', 'Оля: я за', 'Марк: тогда так и делаем', 'Оля: не забудьте!'],
  olya: ['Спасибо!', 'Ты лучший', 'Обнял(а)', 'Отправлю вечером'],
  saved: [],
};

function personaReply(chat, userText) {
  const pool = PERSONAS[chat.persona] || ['Хорошо.'];
  if (!pool.length) return null;
  if (/[?]$/.test(userText.trim())) return 'Давай так и сделаем.';
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------------- persistence ---------------- */
function save() {
  return (async () => {
    const clone = JSON.parse(JSON.stringify(state));
    for (const c of clone.chats) {
      for (const m of c.messages) {
        if (m.text) m.text = await encryptText(m.text);
      }
    }
    try {
      localStorage.setItem(LS_DATA, JSON.stringify(clone));
      localStorage.setItem(LS_PREFS, JSON.stringify(state.prefs));
    } catch (e) {
      toast('Память устройства заполнена. Сделайте резервную копию в профиле.');
    }
  })();
}

async function load() {
  const raw = localStorage.getItem(LS_DATA);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    for (const c of data.chats) {
      for (const m of c.messages) {
        if (m.text) m.text = await decryptText(m.text);
      }
    }
    return data;
  } catch {
    return null;
  }
}


/* ================= NETWORK LAYER ================= */
const net = {
  base: '',
  token: '',
  ws: null,
  wsState: 'idle',            // idle | connecting | open | closed
  retries: 0,
  onlineUsers: new Set(),
  pending: new Map(),         // tempId -> message
  typingTimers: new Map(),
};

function normalizeServer(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u.replace(/\/+$/, '');
}

function saveSession() {
  if (net.token) localStorage.setItem(LS_SESSION, JSON.stringify({ base: net.base, token: net.token }));
  else localStorage.removeItem(LS_SESSION);
  localStorage.setItem(LS_SERVER, net.base || '');
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    if (raw) {
      const s = JSON.parse(raw);
      net.base = s.base || '';
      net.token = s.token || '';
    } else {
      net.base = localStorage.getItem(LS_SERVER) || '';
    }
  } catch {}
}

function apiPath(p) {
  return (net.base || '') + p;
}

async function api(path, { method = 'GET', body, raw, token = net.token, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  if (raw) {
    opts.body = raw;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(apiPath(path), opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Ошибка ' + res.status);
    err.status = res.status;
    throw err;
  }
  return data;
}

function setConn(kind) {
  const dot = $('#conn');
  if (!dot) return;
  if (!net.base) { dot.hidden = true; return; }
  dot.hidden = false;
  dot.classList.toggle('off', kind === 'off');
  dot.classList.toggle('wait', kind === 'wait');
  dot.title = kind === 'on' ? 'На связи' : kind === 'wait' ? 'Подключаемся…' : 'Нет связи — сообщения в очереди';
}

function connectWs() {
  if (!net.token) return;
  if (net.ws && (net.ws.readyState === 0 || net.ws.readyState === 1)) return;
  const base = net.base || location.origin;
  const proto = base.startsWith('https') ? 'wss' : 'ws';
  const host = base.replace(/^https?:\/\//, '');
  const url = `${proto}://${host}/ws?token=${encodeURIComponent(net.token)}`;

  net.wsState = 'connecting';
  setConn('wait');
  let ws;
  try {
    ws = new WebSocket(url);
  } catch {
    net.wsState = 'closed';
    setConn('off');
    return;
  }
  net.ws = ws;

  ws.onopen = () => {
    net.wsState = 'open';
    net.retries = 0;
    setConn('on');
    flushOutbox();
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleWs(msg);
  };

  ws.onclose = () => {
    net.wsState = 'closed';
    net.ws = null;
    setConn('off');
    const delay = Math.min(30000, 1200 * Math.pow(1.7, net.retries++));
    setTimeout(() => { if (net.token) connectWs(); }, delay);
  };

  ws.onerror = () => {};
}

function wsSend(obj) {
  if (net.ws && net.ws.readyState === 1) {
    net.ws.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

function handleWs(msg) {
  switch (msg.t) {
    case 'hello':
      net.onlineUsers = new Set(msg.online || []);
      paintPresence();
      break;

    case 'message': {
      const incoming = msg.message;
      const chat = chatById(incoming.chatId);
      if (!chat) { refreshChats(); return; }
      if (chat.messages.some((m) => m.id === incoming.id)) break;
      if (incoming.dir === 'out') {
        const p = [...net.pending.values()].find((m) => m.text === incoming.text && m.type === incoming.type);
        if (p) { net.pending.delete(p.id); Object.assign(p, incoming, { pending: false }); }
        else chat.messages.push(incoming);
      } else {
        chat.messages.push(incoming);
        if (ui.chatId !== incoming.chatId) {
          chat.unread = (chat.unread || 0) + 1;
          blip(660);
          notify(chat, incoming);
        } else {
          wsSend({ t: 'read', chatId: chat.id });
        }
      }
      bumpChat(chat);
      if (ui.chatId === incoming.chatId) renderThread(true);
      renderRows();
      break;
    }

    case 'ack': {
      const temp = net.pending.get(msg.tempId);
      if (temp) {
        const chat = chatById(temp.chatId);
        const real = msg.message;
        if (chat) {
          const i = chat.messages.findIndex((m) => m.id === temp.id);
          if (i >= 0) chat.messages[i] = real;
        }
        net.pending.delete(msg.tempId);
      }
      if (ui.chatId === msg.message.chatId) renderThread();
      break;
    }

    case 'typing': {
      const chat = chatById(msg.chatId);
      if (!chat) break;
      chat.typingUsers = chat.typingUsers || {};
      chat.typingUsers[msg.userId] = msg.name;
      if (ui.chatId === msg.chatId) renderThread();
      clearTimeout(net.typingTimers.get(msg.chatId + msg.userId));
      net.typingTimers.set(msg.chatId + msg.userId, setTimeout(() => {
        delete chat.typingUsers[msg.userId];
        if (ui.chatId === msg.chatId) renderThread();
      }, 3200));
      break;
    }

    case 'presence': {
      if (msg.online) net.onlineUsers.add(msg.userId);
      else net.onlineUsers.delete(msg.userId);
      paintPresence();
      break;
    }

    case 'read': {
      const chat = chatById(msg.chatId);
      if (!chat) break;
      chat.messages.forEach((m) => { if (m.dir === 'out') m.status = 'read'; });
      if (ui.chatId === msg.chatId) renderThread();
      break;
    }

    case 'reaction': {
      const chat = chatById(msg.chatId);
      if (!chat) break;
      const m = chat.messages.find((x) => x.id === msg.msgId);
      if (m) {
        m.reactions = msg.reactions || {};
        if (ui.chatId === msg.chatId) renderThread();
      }
      break;
    }

    case 'deleted': {
      const chat = chatById(msg.chatId);
      if (!chat) break;
      const m = chat.messages.find((x) => x.id === msg.msgId);
      if (m) { m.deleted = true; m.text = ''; m.type = 'text'; m.reactions = {}; }
      if (ui.chatId === msg.chatId) renderThread();
      renderRows();
      break;
    }

    case 'chat:new':
    case 'chat:update':
      refreshChats();
      break;

    case 'profile': {
      const u = dbUserById(msg.userId);
      if (u) { u.name = msg.name; u.avatar = msg.avatar; }
      renderRows();
      if (ui.chatId) renderChatHead();
      break;
    }

    case 'me':
      applyMe(msg.user);
      break;

    case 'error':
      toast(msg.error === 'unauthorized' ? 'Сессия истекла — войдите снова' : msg.error);
      break;
  }
}

function dbUserById(id) {
  for (const c of state.chats) {
    for (const m of c.members || []) if (m.id === id) return m;
  }
  return null;
}

function paintPresence() {
  document.querySelectorAll('.row').forEach((r) => {
    const chat = chatById(r.dataset.id);
    const ava = r.querySelector('.ava');
    if (!chat || !ava) return;
    const list = Array.isArray(chat.members) ? chat.members : [];
    const peerOnline = list.some((m) => m && net.onlineUsers.has(m.id));
    ava.classList.toggle('online', chat.kind === 'dm' && peerOnline);
  });
}

function notify(chat, message) {
  if (quietNow()) return;
  if (!state.prefs.notifications) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const body = message.type === 'text' ? message.text : message.type === 'image' ? 'Фотография' : 'Голосовое';
  try {
    const n = new Notification(chat.name, { body, icon: 'icons/icon-192.png', tag: chat.id, silent: true });
    n.onclick = () => { window.focus(); openChat(chat.id); };
  } catch {}
}

function applyMe(user) {
  if (!user) return;
  state.me.name = user.name || user.nick;
  state.me.handle = '@' + user.nick;
  state.me.avatar = user.avatar || null;
  paintMe();
}

async function refreshChats() {
  if (!net.token) return;
  try {
    const { chats } = await api('/api/chats');
    const existing = new Map(state.chats.map((c) => [c.id, c]));
    state.chats = chats.map((c) => {
      const prev = existing.get(c.id);
      return {
        id: c.id,
        name: c.name,
        handle: c.kind === 'dm' ? (c.members[0] ? '@' + c.members[0].nick : '') : `${c.memberCount} человека`,
        kind: c.kind,
        members: c.members,
        memberCount: c.memberCount,
        avatar: c.avatar,
        unread: c.unread,
        muted: prev?.muted || false,
        pinned: prev?.pinned || false,
        persona: prev?.persona || null,
        av: prev?.av ?? hashIndex(c.id),
        messages: prev?.messages || [],
        typingUsers: prev?.typingUsers || {},
        loaded: prev?.loaded || false,
      };
    });
    renderRows();
    paintPresence();
  } catch (e) {
    if (e.status === 401) forceLogout();
  }
}

function hashIndex(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 7;
}

function bumpChat(chat) {
  // keep newest conversations on top
  const i = state.chats.indexOf(chat);
  if (i > 0 && !chat.pinned) {
    state.chats.splice(i, 1);
    state.chats.unshift(chat);
  }
}

async function loadMessages(chatId) {
  const chat = chatById(chatId);
  if (!chat || chat.loaded || !net.token) return;
  try {
    const { messages } = await api(`/api/chats/${chatId}/messages?limit=150`);
    chat.messages = messages;
    chat.loaded = true;
    if (ui.chatId === chatId) renderThread(true);
  } catch (e) {
    if (e.status === 401) forceLogout();
  }
}

function queueOutbox(item) {
  const q = JSON.parse(localStorage.getItem('byazen.outbox') || '[]');
  q.push(item);
  localStorage.setItem('byazen.outbox', JSON.stringify(q.slice(-100)));
}

function flushOutbox() {
  const q = JSON.parse(localStorage.getItem('byazen.outbox') || '[]');
  if (!q.length) return;
  localStorage.setItem('byazen.outbox', '[]');
  for (const item of q) {
    if (item.t === 'send') wsSend(item);
  }
  toast('Отправлено из очереди');
}

function askConfirm(text) {
  try { return window.confirm(text); } catch { return true; }
}

/* ---------------- utils ---------------- */
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function fmtDur(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(today.getTime() - 864e5);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Сегодня';
  if (same(d, y)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
function shortStamp(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return fmtTime(ts);
  const y = new Date(today.getTime() - 864e5);
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}
function initial(name) {
  const s = String(name || '?').replace(/^Круг\s*«?/, '').trim();
  return (s[0] || '?').toUpperCase();
}
function avatarCss(chat) {
  return AV[(chat.av ?? 0) % AV.length][0];
}
function toast(text, ms = 2600) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}
function quietNow() {
  if (!state.prefs.quiet) return false;
  const [fh, fm] = state.prefs.quietFrom.split(':').map(Number);
  const [th, tm] = state.prefs.quietTo.split(':').map(Number);
  const d = new Date();
  const cur = d.getHours() * 60 + d.getMinutes();
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to;
}

/* ---------------- sound ---------------- */
let actx = null;
function blip(freq = 540) {
  if (!state.prefs.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.value = 0.0001;
    o.connect(g).connect(actx.destination);
    const t = actx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.start(t);
    o.stop(t + 0.3);
  } catch {}
}

/* ---------------- accents ---------------- */
function applyAccent() {
  const map = {
    aurora: ['#2e7bff', '#7cf2d4'],
    mint: ['#20c8a0', '#a8f0d8'],
    violet: ['#7d5cf0', '#c9b6ff'],
    amber: ['#e0a24a', '#ffe1a8'],
  };
  const [a, b] = map[state.prefs.accent] || map.aurora;
  document.documentElement.style.setProperty('--blue', a);
  document.documentElement.style.setProperty('--blue-2', b);
  document.documentElement.style.setProperty('--mint', b);
}

/* ---------------- rendering: chat list ---------------- */
function chatById(id) { return state.chats.find((c) => c.id === id); }
function lastMessage(c) { return c.messages[c.messages.length - 1]; }
function previewOf(c) {
  const m = lastMessage(c);
  if (!m) return c.kind === 'circle' ? `${c.memberCount || c.members?.length || 2} человека · тихий круг` : 'Нет сообщений';
  if (m.deleted) return 'Сообщение удалено';
  if (m.type === 'image') return 'Фотография';
  if (m.type === 'voice') return `Голосовое · ${fmtDur(m.dur || 0)}`;
  return (m.dir === 'out' ? 'Вы: ' : '') + m.text;
}
function sortChats(list) {
  return list.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (lastMessage(b)?.ts || 0) - (lastMessage(a)?.ts || 0);
  });
}

function renderRows() {
  const rows = $('#rows');
  rows.innerHTML = '';
  const q = ui.search.trim().toLowerCase();
  let list = state.chats;

  if (ui.view === 'circles') list = list.filter((c) => c.kind === 'circle');
  if (ui.view === 'saved') list = list.filter((c) => c.id === 'saved');
  if (q) {
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.handle || '').toLowerCase().includes(q) ||
        c.messages.some((m) => !m.deleted && (m.text || '').toLowerCase().includes(q))
    );
  } else {
    list = list.filter((c) => (ui.view === 'chats' ? c.id !== 'saved' : true));
  }

  list = sortChats(list);

  if (!list.length) {
    rows.append(el('div', 'empty-rows', q ? 'Ничего не найдено. Тишина бывает и такой.' : 'Здесь пока пусто.'));
    updateListSub();
    return;
  }

  for (const c of list) {
    const m = lastMessage(c);
    const row = el('div', 'row' + (c.id === ui.chatId ? ' active' : ''));
    row.dataset.id = c.id;
    row.tabIndex = 0;

    const ava = el('div', 'ava' + (c.kind === 'dm' && c.id !== 'saved' ? ' online' : ''));
    ava.style.background = avatarCss(c);
    ava.innerHTML = c.avatar ? `<img src="${c.avatar}" alt=""/>` : esc(initial(c.name));

    const main = el('div', 'row-main');
    main.innerHTML = `<div class="row-name">${esc(c.name)}${c.pinned ? '<span class="pin">◈</span>' : ''}</div>
      <div class="row-last">${esc(previewOf(c))}</div>`;

    const side = el('div', 'row-side');
    side.innerHTML = `<span class="row-time">${m ? shortStamp(m.ts) : ''}</span>` +
      (c.unread ? `<span class="unread">${c.unread > 99 ? '99+' : c.unread}</span>` :
        c.muted ? '<span class="muted">⌁</span>' : '');

    row.append(ava, main, side);
    row.addEventListener('click', () => openChat(c.id));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openChat(c.id); });
    rows.append(row);
  }
  updateListSub();
}

function updateListSub() {
  const subs = {
    chats: `${state.chats.filter((c) => c.id !== 'saved').length} разговоров · ${
      state.chats.reduce((n, c) => n + c.unread, 0) || 'тихо'
    }`,
    circles: `${state.chats.filter((c) => c.kind === 'circle').length} малых групп · до 20 человек`,
    saved: 'Заметки для себя',
    profile: 'Настройки и приватность',
  };
  const s = subs[ui.view];
  $('#listSub').textContent = typeof s === 'number' ? 'тихо' : s;
}

/* ---------------- rendering: thread ---------------- */
function openChat(id) {
  const c = chatById(id);
  if (!c) return;
  ui.chatId = id;
  ui.replyTo = null;
  c.unread = 0;
  save();
  $('#emptyState').hidden = true;
  $('#chatView').hidden = false;
  $('#chatPane').dataset.open = 'true';
  $('#replyBar').hidden = true;
  document.body.classList.add('chat-open');
  renderChatHead();
  renderThread(true);
  if (net.token) {
    loadMessages(id).then(() => {
      wsSend({ t: 'read', chatId: id });
      api(`/api/chats/${id}/read`, { method: 'POST' }).catch(() => {});
      const cc = chatById(id);
      if (cc) cc.unread = 0;
      renderRows();
    });
  }
  renderRows();
  if (window.innerWidth <= 760) $('#chatPane').style.zIndex = '50';
  $('#input').value = '';
  autoGrow();
  setTimeout(() => $('#input').focus({ preventScroll: true }), 120);
}

function closeChat() {
  ui.chatId = null;
  ui.replyTo = null;
  document.body.classList.remove('chat-open');
  $('#chatPane').dataset.open = 'false';
  $('#chatView').hidden = true;
  $('#emptyState').hidden = false;
  renderRows();
}

function renderChatHead() {
  const c = chatById(ui.chatId);
  if (!c) return;
  const ava = $('#chatAva');
  ava.style.background = avatarCss(c);
  ava.innerHTML = c.avatar ? `<img src="${c.avatar}" alt=""/>` : esc(initial(c.name));
  $('#chatName').textContent = c.name;
  const status = c.kind === 'circle'
    ? `${c.memberCount || (Array.isArray(c.members) ? c.members.length : 2)} человека · закрытый круг`
    : c.id === 'saved' ? 'Только вы · заметки' : 'в сети · E2EE';
  $('#chatStatus').innerHTML = (c.id === 'saved' ? '' : '<i class="live"></i>') + esc(status);
}

function renderThread(scroll = false) {
  const c = chatById(ui.chatId);
  const thread = $('#thread');
  if (!c) return;
  thread.innerHTML = '';
  let lastDay = '';

  c.messages.forEach((m, i) => {
    const day = dayLabel(m.ts);
    if (day !== lastDay) {
      thread.append(el('div', 'stamp', esc(day)));
      lastDay = day;
    }
    const prev = c.messages[i - 1];
    const next = c.messages[i + 1];
    const first = !prev || prev.dir !== m.dir || prev.ts < m.ts - 5 * 60 * 1000 || dayLabel(prev.ts) !== day;
    const last = !next || next.dir !== m.dir || next.ts > m.ts + 5 * 60 * 1000 || dayLabel(next.ts) !== day;

    const node = el('div', `msg ${m.dir}${first ? ' first' : ''}${last ? ' last' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}`);
    node.dataset.id = m.id;
    if (c.kind === 'circle' && first && m.dir === 'in' && m.fromName) {
      node.append(el('div', 'from-name', esc(m.fromName)));
    }
    const bubble = el('div', 'bubble');

    if (m.deleted) {
      bubble.classList.add('deleted');
      bubble.textContent = 'Сообщение удалено';
    } else if (m.type === 'image') {
      bubble.classList.add('media');
      bubble.innerHTML = `<img src="${m.text}" alt="Фото" loading="lazy"/>`;
      bubble.querySelector('img').addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(m.text);
      });
    } else if (m.type === 'voice') {
      bubble.append(voiceNode(m));
    } else {
      if (m.replyTo) {
        const q = c.messages.find((x) => x.id === m.replyTo);
        if (q) {
          const qd = el('div', 'reply-quote');
          qd.textContent = q.type === 'image' ? 'Фотография' : q.type === 'voice' ? 'Голосовое' : q.text;
          bubble.append(qd);
        }
      }
      bubble.append(document.createTextNode(m.text || ''));
    }

    if (m.err) bubble.classList.add('err');
    node.append(bubble);

    const reactions = Object.entries(m.reactions || {}).filter(([, arr]) => arr.length);
    if (reactions.length) {
      const r = el('div', 'reactions');
      for (const [emo, arr] of reactions) {
        const b = el('button', 'reaction' + (arr.includes('me') ? ' mine' : ''),
          `${emo}<span>${arr.length}</span>`);
        b.addEventListener('click', (e) => { e.stopPropagation(); toggleReaction(m, emo); });
        r.append(b);
      }
      node.append(r);
    }

    if (last) {
      const meta = el('div', 'meta-line');
      if (m.dir === 'out') {
        meta.innerHTML = `${fmtTime(m.ts)}<span class="tick">${m.status === 'read' ? '✓✓' : '✓'}</span>`;
      } else {
        meta.textContent = fmtTime(m.ts);
      }
      node.append(meta);
    }

    bindMessageActions(node, m);
    thread.append(node);
  });

  const typers = Object.values(c.typingUsers || {}).filter(Boolean);
  if (typers.length) {
    const wrap = el('div', '');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:6px';
    if (typers.length === 1 && c.kind === 'circle') {
      wrap.append(el('span', 'typing-label', esc(typers[0])));
    }
    wrap.append(el('div', 'typing-row', '<i></i><i></i><i></i>'));
    thread.append(wrap);
  }

  if (scroll) requestAnimationFrame(() => (thread.scrollTop = thread.scrollHeight));
}

function voiceNode(m) {
  const wrap = el('div', 'voice-msg');
  wrap.innerHTML = `<span class="voice-play"><svg viewBox="0 0 24 24" fill="none"><path d="M8 5.5v13l11-6.5L8 5.5Z" fill="currentColor"/></svg></span>`;
  const wave = el('div', 'voice-wave');
  const seed = (m.id.charCodeAt(0) + m.id.charCodeAt(1)) % 7;
  for (let i = 0; i < 26; i++) {
    const bar = el('i');
    const h = 5 + Math.abs(Math.sin((i + seed) * 0.9)) * 15;
    bar.style.height = h.toFixed(1) + 'px';
    wave.append(bar);
  }
  const dur = el('span', 'voice-dur', fmtDur(m.dur || 0));
  wrap.append(wave, dur);
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    playVoice(m, wrap, wave);
  });
  return wrap;
}

function playVoice(m, wrap, wave) {
  if (!m.text) return;
  const audio = new Audio(m.text);
  const bars = [...wave.children];
  audio.play().catch(() => toast('Не удалось воспроизвести запись'));
  const start = performance.now();
  const dur = m.dur || 1000;
  const tick = () => {
    const p = Math.min(1, (performance.now() - start) / dur);
    bars.forEach((b, i) => (b.style.opacity = i / bars.length < p ? '1' : '0.45'));
    if (p < 1 && !audio.paused) requestAnimationFrame(tick);
    else bars.forEach((b) => (b.style.opacity = '0.55'));
  };
  tick();
}

function bindMessageActions(node, m) {
  const openMenu = (e) => {
    e.preventDefault();
    const c = chatById(ui.chatId);
    const canDelete = true;
    const menu = el('div', 'ctx-menu');
    menu.style.left = Math.min(e.clientX || 40, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(e.clientY || 100, window.innerHeight - 250) + 'px';

    const addBtn = (label, fn, cls) => {
      const b = el('button', cls || '', label);
      b.addEventListener('click', () => { closeMenu(); fn(); });
      menu.append(b);
    };

    if (!m.deleted) {
      addBtn('Ответить', () => startReply(m));
      const row = el('div', 'sep');
      menu.append(row);
      const emo = el('div', 'ctx-emoji');
      emo.style.cssText = 'display:flex;gap:2px;padding:4px 2px 6px';
      for (const e of EMOJI) {
        const b = el('button', '', e);
        b.style.cssText = 'font-size:17px;padding:4px 5px;border-radius:8px';
        b.addEventListener('click', () => { closeMenu(); toggleReaction(m, e); });
        emo.append(b);
      }
      menu.append(emo);
      menu.append(el('div', 'sep'));
      if (m.type === 'text') addBtn('Копировать', () => copyText(m.text));
      if (m.type === 'image') addBtn('Сохранить фото', () => downloadData(m.text, 'byazen-photo.jpg'));
    }
    addBtn('Удалить', () => {
      if (net.token) {
        wsSend({ t: 'delete', chatId: m.chatId || ui.chatId, msgId: m.id });
        return;
      }
      m.deleted = true;
      m.text = '';
      m.type = 'text';
      m.reactions = {};
      save();
      renderThread();
      renderRows();
    }, 'danger');

    document.body.append(menu);
    ctxMenu = menu;
  };

  node.addEventListener('contextmenu', openMenu);
  let pressTimer = null;
  node.addEventListener('touchstart', (e) => {
    pressTimer = setTimeout(() => {
      const t = e.touches[0];
      openMenu({ preventDefault() {}, clientX: t.clientX, clientY: t.clientY });
    }, 480);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach((ev) =>
    node.addEventListener(ev, () => clearTimeout(pressTimer), { passive: true })
  );
  node.addEventListener('dblclick', () => toggleReaction(m, '❤️'));
}

let ctxMenu = null;
function closeMenu() {
  if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
}
document.addEventListener('click', () => closeMenu());
document.addEventListener('scroll', closeMenu, true);

function toggleReaction(m, emo) {
  if (net.token) {
    wsSend({ t: 'react', chatId: m.chatId || ui.chatId, msgId: m.id, emoji: emo });
    if (m.pending) return; // wait for server state
  }
  m.reactions = m.reactions || {};
  m.reactions[emo] = m.reactions[emo] || [];
  const i = m.reactions[emo].indexOf('me');
  if (i >= 0) m.reactions[emo].splice(i, 1);
  else m.reactions[emo].push('me');
  if (!m.reactions[emo].length) delete m.reactions[emo];
  save();
  renderThread();
}

function startReply(m) {
  const c = chatById(ui.chatId);
  ui.replyTo = m.id;
  const bar = $('#replyBar');
  bar.hidden = false;
  $('#replyText').textContent =
    m.type === 'image' ? 'Фотография' : m.type === 'voice' ? 'Голосовое' : m.text;
  $('#input').focus();
}

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    toast('Скопировано');
  } catch {
    toast('Копирование недоступно');
  }
}

function downloadData(dataUrl, name) {
  const a = el('a');
  a.href = dataUrl;
  a.download = name;
  a.click();
}

function openLightbox(src) {
  const lb = el('div', 'lightbox');
  lb.innerHTML = `<img src="${src}" alt=""/>`;
  lb.addEventListener('click', () => lb.remove());
  document.body.append(lb);
}

/* ---------------- sending ---------------- */
function pushMessage(chatId, msg, { silent = false } = {}) {
  const c = chatById(chatId);
  c.messages.push({ id: uid(), ts: now(), status: 'sent', reactions: {}, ...msg });
  if (silent) c.unread = (c.unread || 0) + 1;
  renderRows();
  if (ui.chatId === chatId) renderThread(true);
  return c.messages[c.messages.length - 1];
}

async function sendText() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text || !ui.chatId) return;
  const c = chatById(ui.chatId);
  input.value = '';
  autoGrow();
  const replyTo = ui.replyTo || null;
  ui.replyTo = null;
  $('#replyBar').hidden = true;

  if (net.token) {
    const tempId = 'tmp_' + uid();
    const temp = {
      id: tempId, chatId: c.id, fromId: 'me', type: 'text', text, ts: now(),
      replyTo, reactions: {}, dir: 'out', status: 'sent', pending: true, fromName: state.me.name,
    };
    c.messages.push(temp);
    net.pending.set(tempId, temp);
    renderThread(true);
    renderRows();
    const payload = { t: 'send', chatId: c.id, text, type: 'text', replyTo, tempId };
    if (!wsSend(payload)) {
      queueOutbox(payload);
      toast('Нет связи — отправим, как только сеть вернётся');
    }
    bumpChat(c);
    renderRows();
    return;
  }

  const msg = pushMessage(ui.chatId, { dir: 'out', text, type: 'text', replyTo });
  await save();
  setTimeout(() => { msg.status = 'read'; if (ui.chatId === c.id) renderThread(); save(); }, 1200);
  if (c.persona && c.id !== 'saved') {
    const reply = personaReply(c, text);
    if (reply) scheduleIncoming(c.id, reply);
  }
}

function scheduleIncoming(chatId, text) {
  const c = chatById(chatId);
  const delay = 900 + Math.random() * 1500;
  c.typing = true;
  if (ui.chatId === chatId) renderThread(true);
  setTimeout(async () => {
    c.typing = false;
    const msg = pushMessage(chatId, { dir: 'in', text, type: 'text', status: 'read' }, { silent: ui.chatId !== chatId });
    if (ui.chatId !== chatId) {
      blip(660);
      if (state.prefs.notifications && 'Notification' in window && Notification.permission === 'granted' && !quietNow()) {
        new Notification(c.name, { body: text, icon: 'icons/icon-192.png', silent: true });
      }
    }
    await save();
  }, delay);
}

/* ---------------- attach image ---------------- */
function pickImage() {
  $('#fileInput').value = '';
  $('#fileInput').click();
}

$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file || !ui.chatId) return;
  if (!file.type.startsWith('image/')) return toast('Можно прикрепить только фото');
  toast('Готовим фото…', 1200);
  const dataUrl = await compressImage(file, 1280, 0.72);
  const replyTo = ui.replyTo || null;
  ui.replyTo = null;
  $('#replyBar').hidden = true;

  if (net.token) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const { url } = await api('/api/upload?kind=image', {
        method: 'POST', raw: blob, headers: { 'Content-Type': 'image/jpeg' },
      });
      const tempId = 'tmp_' + uid();
      const temp = {
        id: tempId, chatId: ui.chatId, fromId: 'me', type: 'image', text: url,
        ts: now(), replyTo, reactions: {}, dir: 'out', status: 'sent', pending: true,
      };
      const c = chatById(ui.chatId);
      c.messages.push(temp);
      net.pending.set(tempId, temp);
      if (!wsSend({ t: 'send', chatId: c.id, type: 'image', text: url, replyTo, tempId })) {
        toast('Нет связи — фото не отправлено');
      }
      renderThread(true);
      renderRows();
    } catch (err) {
      toast('Не удалось отправить фото: ' + err.message);
    }
    return;
  }

  pushMessage(ui.chatId, { dir: 'out', text: dataUrl, type: 'image', replyTo });
  await save();
  const c = chatById(ui.chatId);
  if (c.persona && c.id !== 'saved') setTimeout(() => scheduleIncoming(c.id, 'Красиво. Сохраню.'), 700);
});

function compressImage(file, maxSide = 1000, quality = 0.72) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(reader.result);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------- voice ---------------- */
async function toggleVoice() {
  if (ui.recording) return stopVoice(true);
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    return toast('Запись голоса не поддерживается этим браузером');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    const started = now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const dur = now() - started;
      if (dur < 500) return toast('Слишком коротко');
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if (net.token) {
        try {
          const { url } = await api('/api/upload?kind=voice', {
            method: 'POST', raw: blob, headers: { 'Content-Type': blob.type || 'audio/webm' },
          });
          const tempId = 'tmp_' + uid();
          const chat = chatById(ui.chatId);
          const temp = {
            id: tempId, chatId: chat.id, fromId: 'me', type: 'voice', text: url, dur,
            ts: now(), reactions: {}, dir: 'out', status: 'sent', pending: true,
          };
          chat.messages.push(temp);
          net.pending.set(tempId, temp);
          if (!wsSend({ t: 'send', chatId: chat.id, type: 'voice', text: url, dur, tempId })) {
            toast('Нет связи — голосовое не отправлено');
          }
          renderThread(true);
          renderRows();
        } catch (err) {
          toast('Не удалось отправить голосовое: ' + err.message);
        }
        return;
      }
      const dataUrl = await blobToDataURL(blob);
      pushMessage(ui.chatId, { dir: 'out', text: dataUrl, type: 'voice', dur, status: 'sent' });
      await save();
    };
    rec.start();
    ui.recording = { rec, started };
    $('#btnMic').classList.add('recording');
    $('#recBar').hidden = false;
    $('#recTime').textContent = '0:00';
    ui.recTimer = setInterval(() => {
      $('#recTime').textContent = fmtDur(now() - started);
    }, 250);
  } catch {
    toast('Нет доступа к микрофону');
  }
}

function stopVoice(send = true) {
  if (!ui.recording) return;
  clearInterval(ui.recTimer);
  const { rec } = ui.recording;
  ui.recording = null;
  $('#btnMic').classList.remove('recording');
  $('#recBar').hidden = true;
  if (!send) {
    rec.onstop = null;
    rec.stream && rec.stream.getTracks().forEach((t) => t.stop());
  }
  try { rec.stop(); } catch {}
}

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

/* ---------------- panel: profile / circles ---------------- */
function switchView(view) {
  ui.view = view;
  ui.panel = null;
  $('#panel').hidden = true;
  document.querySelector('.app').classList.remove('panel-open');
  document.querySelectorAll('.rail-btn[data-nav]').forEach((b) =>
    b.classList.toggle('active', b.dataset.nav === view)
  );
  const titles = { chats: 'Чаты', circles: 'Круги', saved: 'Избранное', profile: 'Профиль' };
  $('#listTitle').textContent = titles[view] || 'Чаты';
  ui.search = '';
  $('#searchInput').value = '';
  if (view === 'profile') { renderProfilePanel(); return; }
  if (view === 'circles') { renderCirclesPanel(); return; }
  if (view === 'saved') {
    const c = chatById('saved');
    openChat(c.id);
  }
  renderRows();
}

function openPanel(html) {
  const p = $('#panel');
  p.innerHTML = html;
  p.hidden = false;
  document.querySelector('.app').classList.add('panel-open');
  const close = el('button', 'icon-btn panel-close', '✕');
  close.id = 'panelClose';
  close.style.cssText = 'position:absolute;right:14px;top:' + 'calc(14px + var(--sat))';
  p.style.position = 'relative';
  p.append(close);
  close.addEventListener('click', () => {
    p.hidden = true;
    document.querySelector('.app').classList.remove('panel-open');
  });
}

function renderProfilePanel() {
  const me = state.me;
  openPanel(`
    <div class="p-ava" id="pAva">${me.avatar ? `<img src="${me.avatar}" alt=""/>` : esc(initial(me.name))}</div>
    <div class="p-name">${esc(me.name)}</div>
    <div class="p-handle">${esc(me.handle)}</div>
    <p class="p-quote">«${esc(me.quote)}»</p>

    <div class="p-section">
      <div class="p-section-title">Профиль</div>
      <div class="set-row"><span class="lbl grow">Имя</span>
        <input class="select" id="meName" style="width:150px" value="${esc(me.name)}" maxlength="24"/></div>
      <div class="set-row"><span class="lbl grow">Ник</span>
        <input class="select" id="meHandle" style="width:150px" value="${esc(me.handle)}" maxlength="18"/></div>
      <div class="set-row"><span class="lbl grow">Статус</span>
        <input class="select" id="meQuote" style="width:150px" value="${esc(me.quote)}" maxlength="48"/></div>
      <button class="p-btn" id="pickAvatar">Сменить фото профиля</button>
      <button class="p-btn" id="removeAvatar">Убрать фото</button>
    </div>

    <div class="p-section">
      <div class="p-section-title">Тишина и приватность</div>
      <div class="set-row">
        <span class="lbl grow">Тихие часы</span>
        <span class="switch ${state.prefs.quiet ? 'on' : ''}" data-pref="quiet"></span>
      </div>
      <div class="set-row">
        <span class="lbl">С</span><input type="time" id="qFrom" value="${state.prefs.quietFrom}"/>
        <span class="lbl">до</span><input type="time" id="qTo" value="${state.prefs.quietTo}"/>
      </div>
      <div class="set-row">
        <span class="lbl grow">Звук сообщений</span>
        <span class="switch ${state.prefs.sound ? 'on' : ''}" data-pref="sound"></span>
      </div>
      <div class="set-row">
        <span class="lbl grow">Уведомления<span class="hint">в тихие часы молчат</span></span>
        <span class="switch ${state.prefs.notifications ? 'on' : ''}" data-pref="notifications"></span>
      </div>
      <div class="set-row">
        <span class="lbl grow">Акцент</span>
        <select class="select" id="accentSel">
          <option value="aurora"${state.prefs.accent === 'aurora' ? ' selected' : ''}>Aurora</option>
          <option value="mint"${state.prefs.accent === 'mint' ? ' selected' : ''}>Mint</option>
          <option value="violet"${state.prefs.accent === 'violet' ? ' selected' : ''}>Violet</option>
          <option value="amber"${state.prefs.accent === 'amber' ? ' selected' : ''}>Amber</option>
        </select>
      </div>
    </div>

    <div class="p-section">
      <div class="p-section-title">Сервер</div>
      <div class="set-row">
        <span class="lbl grow">Адрес</span>
        <span class="hint" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(net.base || 'демо-режим')}</span>
      </div>
      <div class="set-row">
        <span class="lbl grow">Связь</span>
        <span class="hint">${net.wsState === 'open' ? 'на связи' : net.token ? 'переподключение…' : 'локально'}</span>
      </div>
      ${net.token ? '<button class="p-btn" id="logoutBtn">Выйти из аккаунта</button>' : '<button class="p-btn" id="loginBtn">Войти по нику</button>'}
    </div>

    <div class="p-section">
      <div class="p-section-title">Данные</div>
      <button class="p-btn" id="exportBtn">Скачать резервную копию</button>
      <button class="p-btn" id="importBtn">Загрузить резервную копию</button>
      <input type="file" id="importFile" accept="application/json" hidden/>
      <div class="set-row" style="margin-top:8px">
        <span class="lbl grow">Шифрование</span>
        <span class="hint">${cryptoKey ? 'AES-256-GCM · включено' : 'недоступно в этом браузере'}</span>
      </div>
      <button class="p-btn danger" id="wipeBtn">Удалить все данные</button>
    </div>

    <p style="font-size:11px;color:#4d545e;line-height:1.6;margin-top:18px">
      ByAzen v1.0 · Aurora edition. Данные не покидают устройство.
    </p>
  `);

  $('#meName').addEventListener('change', (e) => {
    state.me.name = e.target.value.trim() || 'Вы';
    $('.p-name').textContent = state.me.name;
    paintMe();
    if (net.token) wsSend({ t: 'profile', name: state.me.name });
    save(); renderRows();
  });
  $('#meHandle').addEventListener('change', (e) => { state.me.handle = e.target.value.trim(); save(); });
  $('#meQuote').addEventListener('change', (e) => { state.me.quote = e.target.value.trim(); save(); });

  $('#pickAvatar').addEventListener('click', () => {
    const inp = el('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.addEventListener('change', async () => {
      if (!inp.files[0]) return;
      const dataUrl = await compressImage(inp.files[0], 220, 0.82);
      state.me.avatar = dataUrl;
      if (net.token) wsSend({ t: 'profile', avatar: dataUrl, name: state.me.name });
      save();
      renderProfilePanel();
      paintMe();
      renderRows();
    });
    inp.click();
  });
  $('#removeAvatar').addEventListener('click', () => { state.me.avatar = null; save(); renderProfilePanel(); paintMe(); });

  document.querySelectorAll('[data-pref]').forEach((sw) => {
    sw.addEventListener('click', async () => {
      const key = sw.dataset.pref;
      state.prefs[key] = !state.prefs[key];
      sw.classList.toggle('on', state.prefs[key]);
      if (key === 'notifications' && state.prefs.notifications) {
        if ('Notification' in window) {
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') { state.prefs.notifications = false; sw.classList.remove('on'); toast('Уведомления запрещены в браузере'); }
        } else { state.prefs.notifications = false; sw.classList.remove('on'); toast('Уведомления не поддерживаются'); }
      }
      save();
    });
  });

  $('#qFrom').addEventListener('change', (e) => { state.prefs.quietFrom = e.target.value; save(); });
  $('#qTo').addEventListener('change', (e) => { state.prefs.quietTo = e.target.value; save(); });
  $('#accentSel').addEventListener('change', (e) => { state.prefs.accent = e.target.value; applyAccent(); save(); });

  const lo = $('#logoutBtn');
  if (lo) lo.addEventListener('click', () => {
    if (!askConfirm('Выйти из аккаунта на этом устройстве? Переписка останется на сервере.')) return;
    forceLogout();
  });
  const li = $('#loginBtn');
  if (li) li.addEventListener('click', () => { $('#panel').hidden = true; document.querySelector('.app').classList.remove('panel-open'); showAuth(); });

  $('#exportBtn').addEventListener('click', () => {
    const payload = { app: 'ByAzen', version: 1, exportedAt: new Date().toISOString(), plain: true, data: state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = `byazen-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Копия скачана (незашифрованная — храните бережно)');
  });

  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const parsed = JSON.parse(r.result);
        if (!parsed.data || !parsed.data.chats) throw new Error();
        state = parsed.data;
        await save();
        toast('Копия загружена');
        paintMe();
        switchView('chats');
        renderRows();
      } catch {
        toast('Файл не похож на копию ByAzen');
      }
    };
    r.readAsText(f);
  });

  $('#wipeBtn').addEventListener('click', () => {
    if (!askConfirm('Удалить все чаты и настройки с этого устройства? Действие необратимо.')) return;
    localStorage.removeItem(LS_DATA);
    localStorage.removeItem(LS_PREFS);
    localStorage.removeItem(LS_KEY);
    location.reload();
  });
}

function renderCirclesPanel() {
  const circles = state.chats.filter((c) => c.kind === 'circle');
  openPanel(`
    <div class="p-section" style="margin-top:0">
      <div class="p-section-title">Круги</div>
      <p style="font-size:12.5px;color:#8b929c;line-height:1.6;margin:0 0 16px">
        Маленькие закрытые группы до 20 человек. Вход — по приглашению, никаких подписчиков и охватов.
      </p>
      ${circles.map((c) => `
        <div class="circle-card" data-open="${c.id}">
          <div class="circle-stack">
            ${[0, 1, 2].map((i) => `<div class="ava" style="background:${AV[(c.av + i) % AV.length][0]}">${esc(initial(c.name))}</div>`).join('')}
          </div>
          <div>
            <div class="circle-t">${esc(c.name.replace(/^Круг\s*/, ''))}</div>
            <div class="circle-s">${c.memberCount || c.members?.length || 2} человека · ${c.unread ? c.unread + ' новых' : 'тихо'}</div>
          </div>
        </div>`).join('')}
      <button class="p-btn" id="newCircle">Создать круг</button>
    </div>
  `);
  document.querySelectorAll('.circle-card').forEach((card) =>
    card.addEventListener('click', () => { $('#panel').hidden = true; document.querySelector('.app').classList.remove('panel-open'); openChat(card.dataset.open); })
  );
  $('#newCircle').addEventListener('click', () => {
    const name = prompt('Название круга', 'Круг «Тишина»');
    if (!name) return;
    const c = {
      id: uid(), name: name.startsWith('Круг') ? name : 'Круг «' + name + '»',
      handle: 'новый круг', kind: 'circle', members: 3, av: Math.floor(Math.random() * AV.length),
      unread: 0, persona: 'kuhnya', messages: [], muted: false, pinned: false,
    };
    state.chats.push(c);
    save();
    renderCirclesPanel();
    renderRows();
  });
}


/* ================= MODALS: new chat, help, members ================= */
function openModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card">${html}</div>`;
  m.hidden = false;
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(); }, { once: true });
  return m.querySelector('.modal-card');
}
function closeModal() {
  const m = $('#modal');
  m.hidden = true;
  m.innerHTML = '';
}

function askServerUrl() {
  const guess = net.base || localStorage.getItem(LS_SERVER) || (location.protocol.startsWith('http') && location.port !== '4173' ? location.origin : '');
  return guess;
}

function showHelp() {
  const origin = location.origin.startsWith('http') ? location.origin : 'http://localhost:8080';
  openModal(`
    <h3>Как поднять свой сервер</h3>
    <p class="m-sub">ByAzen работает с любым Node-хостингом: Render, Railway, Fly.io, VPS. Свой сервер — ваши данные.</p>
    <div class="code-block">npm install
npm start</div>
    <p class="m-sub">Сервер поднимется на порту 8080 и сразу отдаст приложение. Локально адрес будет таким:</p>
    <div class="code-block">${esc(origin)}</div>
    <p class="m-sub">Чтобы друг подключился из другой сети, выложите репозиторий на Render → New Web Service → Build: <b>npm install</b> → Start: <b>npm start</b>. Полученный адрес <b>https://ваш-сервис.onrender.com</b> укажите и у себя, и у друга.</p>
    <p class="m-sub">APK для Android собирается из этого же репозитория (см. BUILD.md) и указывает на ваш сервер.</p>
    <button class="btn-primary" onclick="document.querySelector('#modal').hidden=true">Понятно</button>
  `);
}

async function openNewChat() {
  if (!net.token) {
    openModal(`
      <h3>Нужен сервер</h3>
      <p class="m-sub">Поиск людей и доставка сообщений работают в сетевом режиме. Сейчас вы в демо — данные только на этом устройстве.</p>
      <button class="btn-primary" id="goAuth">Войти по нику</button>
    `);
    $('#goAuth').addEventListener('click', () => { closeModal(); showAuth(); });
    return;
  }

  const card = openModal(`
    <h3>Новый разговор</h3>
    <p class="m-sub">Найдите человека по нику или создайте закрытый круг.</p>
    <label class="field"><span>Поиск по @нику</span>
      <input id="findNick" type="text" placeholder="mila" autocomplete="off" autocapitalize="off" spellcheck="false"/>
    </label>
    <div id="findResults" style="margin-bottom:12px"></div>
    <label class="field"><span>Новый круг</span>
      <input id="circleName" type="text" placeholder="Кухня" maxlength="30"/>
    </label>
    <button class="p-btn" id="createCircle">Создать круг</button>
  `);

  const search = async () => {
    const q = $('#findNick').value.trim();
    const box = $('#findResults');
    box.innerHTML = '<div class="m-sub" style="padding:6px 2px">Ищем…</div>';
    try {
      const { users } = await api('/api/users?q=' + encodeURIComponent(q));
      if (!users.length) {
        box.innerHTML = '<div class="m-sub" style="padding:6px 2px">Никого не нашли. Ник чувствителен к написанию.</div>';
        return;
      }
      box.innerHTML = '';
      for (const u of users) {
        const row = el('div', 'person-row');
        row.innerHTML = `
          <div class="ava sm" style="background:${AV[hashIndex(u.id) % AV.length][0]}">${
            u.avatar ? `<img src="${u.avatar}" alt=""/>` : esc(initial(u.name || u.nick))
          }</div>
          <div><div class="pr-name">${esc(u.name)}</div><div class="pr-nick">@${esc(u.nick)}${u.online ? ' · в сети' : ''}</div></div>
          <span class="pr-add">написать</span>`;
        row.addEventListener('click', async () => {
          try {
            const { chat } = await api('/api/chats', { method: 'POST', body: { kind: 'dm', userId: u.id } });
            closeModal();
            await refreshChats();
            openChat(chat.id);
          } catch (e) { toast(e.message); }
        });
        box.append(row);
      }
    } catch (e) { toast(e.message); }
  };

  let debounce;
  $('#findNick').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(search, 280);
  });
  $('#findNick').focus();
  search();

  $('#createCircle').addEventListener('click', async () => {
    const name = $('#circleName').value.trim();
    if (!name) return toast('Назовите круг');
    try {
      const { chat } = await api('/api/chats', { method: 'POST', body: { kind: 'circle', name } });
      closeModal();
      await refreshChats();
      openChat(chat.id);
      toast('Круг создан — добавьте людей в профиле чата');
    } catch (e) { toast(e.message); }
  });
}

async function openAddMembers(chat) {
  if (!net.token || chat.kind !== 'circle') return;
  openModal(`
    <h3>Добавить в круг</h3>
    <p class="m-sub">До 20 человек. Приглашение по нику.</p>
    <label class="field"><span>Ник</span>
      <input id="addNick" type="text" placeholder="nickname" autocomplete="off" autocapitalize="off"/>
    </label>
    <div id="addResults"></div>
  `);
  $('#addNick').focus();
  let t;
  $('#addNick').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = $('#addNick').value.trim();
      if (!q) return ($('#addResults').innerHTML = '');
      try {
        const { users } = await api('/api/users?q=' + encodeURIComponent(q));
        const box = $('#addResults');
        box.innerHTML = '';
        for (const u of users) {
          if (chat.members.some((m) => m.id === u.id)) continue;
          const row = el('div', 'person-row');
          row.innerHTML = `<div class="ava sm" style="background:${AV[hashIndex(u.id) % AV.length][0]}">${esc(initial(u.name))}</div>
            <div><div class="pr-name">${esc(u.name)}</div><div class="pr-nick">@${esc(u.nick)}</div></div>
            <span class="pr-add">добавить</span>`;
          row.addEventListener('click', async () => {
            try {
              await api(`/api/chats/${chat.id}/members`, { method: 'POST', body: { userId: u.id } });
              toast(u.name + ' в круге');
              closeModal();
              await refreshChats();
            } catch (e) { toast(e.message); }
          });
          box.append(row);
        }
      } catch (e) { toast(e.message); }
    }, 260);
  });
}

/* ---------------- me / rail ---------------- */
function paintMe() {
  const m = $('#railMe');
  if (state.me.avatar) m.innerHTML = `<img src="${state.me.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  else m.textContent = initial(state.me.name);
}

/* ---------------- composer helpers ---------------- */
function autoGrow() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = Math.min(140, t.scrollHeight) + 'px';
  const empty = !t.value.trim();
  $('#btnSend').disabled = empty;
}

/* ---------------- boot ---------------- */
/* ================= AUTH UI ================= */
let authMode = 'login';

function authError(text) {
  const e = $('#authError');
  if (!text) { e.hidden = true; return; }
  e.textContent = text;
  e.hidden = false;
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('[data-authtab]').forEach((b) =>
    b.setAttribute('aria-selected', String(b.dataset.authtab === mode))
  );
  $('#authNameWrap').hidden = mode === 'login';
  $('#authTitle').textContent = mode === 'login' ? 'Вход в ByAzen' : 'Новый аккаунт';
  $('#authLead').textContent =
    mode === 'login'
      ? 'Сервер синхронизирует переписку между устройствами. Ключ шифрования остаётся на устройстве.'
      : 'Выберите ник — друзья найдут вас по нему. Пароль нужен только для входа.';
  $('#authGo').textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
  authError('');
}

async function showAuth() {
  $('#auth').hidden = false;
  $('#app').hidden = true;
  $('#authServer').value = localStorage.getItem(LS_SERVER) || net.base || '';
  setAuthMode('login');
  if (!$('#authServer').value) {
    await detectServer();
  }
}

async function detectServer() {
  if (!location.protocol.startsWith('http')) return;
  try {
    const res = await fetch(location.origin + '/api/health', { cache: 'no-store' });
    if (res.ok) {
      const j = await res.json();
      if (j && j.ok) {
        $('#authServer').value = location.origin;
        $('#authNote').textContent = 'Сервер найден на этом адресе. Зарегистрируйтесь — и приглашайте друзей по нику.';
      }
    }
  } catch {}
}

async function doAuth() {
  const base = normalizeServer($('#authServer').value);
  const nick = $('#authNick').value.trim().replace(/^@/, '');
  const pass = $('#authPass').value;
  const name = $('#authName').value.trim();

  if (!base) { $('#authServer').focus(); return authError('Укажите адрес сервера — он выдаётся при развёртывании (например, https://byazen.onrender.com).'); }
  if (!nick) { $('#authNick').focus(); return authError('Введите ник.'); }
  if (pass.length < 4) { $('#authPass').focus(); return authError('Пароль минимум 4 символа.'); }

  const btn = $('#authGo');
  btn.disabled = true;
  btn.textContent = 'Соединяемся…';
  authError('');

  net.base = base;
  net.token = '';
  try {
    const res = await api(authMode === 'login' ? '/api/login' : '/api/register', {
      method: 'POST',
      token: '',
      body: authMode === 'login' ? { nick, password: pass } : { nick, password: pass, name: name || nick },
    });
    net.token = res.token;
    saveSession();
    applyMe(res.user);
    await afterLogin();
  } catch (e) {
    authError(e.message || 'Не удалось подключиться к серверу');
    btn.disabled = false;
    btn.textContent = authMode === 'login' ? 'Войти' : 'Создать аккаунт';
  }
}

async function afterLogin() {
  document.querySelectorAll('.rail-btn[data-nav]').forEach((b) => b.hidden = false);
  $('#auth').hidden = true;
  $('#app').hidden = false;
  paintMe();
  setConn('wait');
  connectWs();
  await refreshChats();
  const first = sortChats(state.chats)[0];
  if (first) openChat(first.id);
  else renderRows();
  $('#splash').classList.add('hide');
  toast('Вы в ByAzen как ' + state.me.handle);
}

function forceLogout() {
  net.token = '';
  net.base = '';
  saveSession();
  if (net.ws) { try { net.ws.close(); } catch {} net.ws = null; }
  state.chats = [];
  showAuth();
}

async function boot() {
  await ensureKey();
  restoreSession();
  state = await load();
  if (!state) {
    state = seed();
    await save();
  }
  if (!state.prefs) state.prefs = seed().prefs;
  applyAccent();

  // auth wiring
  document.querySelectorAll('[data-authtab]').forEach((b) =>
    b.addEventListener('click', () => setAuthMode(b.dataset.authtab))
  );
  $('#authGo').addEventListener('click', doAuth);
  $('#authPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
  $('#authNick').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#authPass').focus(); });
  $('#authDemo').addEventListener('click', async () => {
    net.token = '';
    net.base = '';
    saveSession();
    $('#auth').hidden = true;
    $('#app').hidden = false;
    setTimeout(() => $('#splash').classList.add('hide'), 200);
    paintMe();
    renderRows();
    const first = sortChats(state.chats)[0];
    if (first) openChat(first.id);
    toast('Демо-режим: сообщения только на этом устройстве');
  });
  $('#authHelp').addEventListener('click', showHelp);
  $('#authServer').addEventListener('change', () => {
    localStorage.setItem(LS_SERVER, normalizeServer($('#authServer').value));
  });

  if (!net.token) showAuth();
  else {
    try {
      const me = await api('/api/me');
      applyMe(me.user);
      await afterLogin();
    } catch {
      showAuth();
    }
  }

  setTimeout(() => $('#splash').classList.add('hide'), 900);

  // composer
  const input = $('#input');
  let lastTyping = 0;
  input.addEventListener('input', () => {
    autoGrow();
    if (net.token && ui.chatId && now() - lastTyping > 2200) {
      lastTyping = now();
      wsSend({ t: 'typing', chatId: ui.chatId });
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 760) {
      e.preventDefault();
      sendText();
    }
  });
  $('#btnSend').addEventListener('click', sendText);
  $('#btnAttach').addEventListener('click', pickImage);
  $('#btnMic').addEventListener('click', toggleVoice);
  $('#recStop').addEventListener('click', () => stopVoice(true));
  $('#replyCancel').addEventListener('click', () => {
    ui.replyTo = null;
    $('#replyBar').hidden = true;
  });

  // nav
  document.querySelectorAll('.rail-btn[data-nav]').forEach((b) =>
    b.addEventListener('click', () => switchView(b.dataset.nav))
  );
  $('#railMe').addEventListener('click', () => switchView('profile'));
  $('#btnNew').addEventListener('click', openNewChat);
  $('#btnBack').addEventListener('click', closeChat);

  // search
  $('#btnSearch').addEventListener('click', () => {
    ui.searchOpen = !ui.searchOpen;
    $('#searchWrap').hidden = !ui.searchOpen;
    if (ui.searchOpen) $('#searchInput').focus();
    else { ui.search = ''; $('#searchInput').value = ''; renderRows(); }
  });
  $('#searchInput').addEventListener('input', (e) => {
    ui.search = e.target.value;
    renderRows();
  });

  $('#btnMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    const c = chatById(ui.chatId);
    if (!c || c.id === 'saved') return;
    const menu = el('div', 'ctx-menu');
    const r = e.currentTarget.getBoundingClientRect();
    menu.style.top = r.bottom + 8 + 'px';
    menu.style.left = Math.min(r.left - 140, window.innerWidth - 200) + 'px';
    const add = (label, fn, cls) => {
      const b = el('button', cls || '', label);
      b.addEventListener('click', () => { closeMenu(); fn(); });
      menu.append(b);
    };
    if (c.kind === 'circle') add('Добавить в круг', () => openAddMembers(c));
    add(c.pinned ? 'Открепить' : 'Закрепить', () => { c.pinned = !c.pinned; save(); renderRows(); });
    add(c.muted ? 'Включить звук' : 'Без звука', () => { c.muted = !c.muted; save(); renderRows(); toast(c.muted ? 'Чат без звука' : 'Звук включён'); });
    add('Очистить переписку', () => {
      if (!askConfirm('Удалить все сообщения в этом разговоре?')) return;
      c.messages = [];
      save(); renderThread(); renderRows();
    }, 'danger');
    document.body.append(menu);
    ctxMenu = menu;
  });

  // keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenu();
      closeModal();
      document.querySelectorAll('.lightbox').forEach((l) => l.remove());
      if (document.body.classList.contains('chat-open') && ui.panel !== 'closed') {
        if (ui.chatId && window.innerWidth <= 760) closeChat();
      }
      if (ui.recording) stopVoice(false);
    }
  });

  // install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    ui.installEvt = e;
    $('#railInstall').hidden = false;
  });
  $('#railInstall').addEventListener('click', async () => {
    if (!ui.installEvt) return toast('Меню браузера → «Установить приложение»');
    ui.installEvt.prompt();
    const res = await ui.installEvt.userChoice;
    if (res.outcome === 'accepted') { toast('ByAzen установлен'); $('#railInstall').hidden = true; }
    ui.installEvt = null;
  });

  // shortcuts (?view=)
  const qp = new URLSearchParams(location.search).get('view');
  if (qp && ['chats', 'circles', 'saved', 'profile'].includes(qp)) switchView(qp);

  // service worker (offline + installable)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // mobile chat pane state
  $('#chatPane').dataset.open = window.innerWidth <= 760 ? 'false' : 'true';
  if (ui.view === 'chats' && window.innerWidth > 760) {
    // open first chat on desktop for a warm start
    const first = sortChats(state.chats.filter((c) => c.id !== 'saved'))[0];
    if (first) openChat(first.id);
  }
}

window.addEventListener('DOMContentLoaded', boot);

// expose internals for diagnostics and automated tests
window.__byazen = {
  get net() { return net; },
  get state() { return state; },
  get ui() { return ui; },
  api, refreshChats, openChat, forceLogout,
};
