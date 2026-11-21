/* ============================================================
   ByAzen — working messenger
   Local-first: data lives in this device's storage,
   message text is encrypted at rest with AES-GCM.
   ============================================================ */
'use strict';

const LS_DATA = 'byazen.data.v1';
const LS_KEY  = 'byazen.deckey.v1';
const LS_PREFS = 'byazen.prefs.v1';

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
    members: extra.members || 2,
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
  if (!m) return c.kind === 'circle' ? `${c.members} человека · тихий круг` : 'Нет сообщений';
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
    ? `${c.members} человека · закрытый круг`
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

    const node = el('div', `msg ${m.dir}${first ? ' first' : ''}${last ? ' last' : ''}`);
    node.dataset.id = m.id;
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

  if (c.typing) {
    const t = el('div', 'typing-row', '<i></i><i></i><i></i>');
    thread.append(t);
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
  const msg = pushMessage(ui.chatId, { dir: 'out', text, type: 'text', replyTo: ui.replyTo || null });
  input.value = '';
  autoGrow();
  ui.replyTo = null;
  $('#replyBar').hidden = true;
  await save();

  // delivered / read simulation
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
  const dataUrl = await compressImage(file, 1000, 0.72);
  pushMessage(ui.chatId, { dir: 'out', text: dataUrl, type: 'image', replyTo: ui.replyTo || null });
  ui.replyTo = null;
  $('#replyBar').hidden = true;
  await save();
  const c = chatById(ui.chatId);
  if (c.persona && c.id !== 'saved') {
    setTimeout(() => scheduleIncoming(c.id, 'Красиво. Сохраню.'), 700);
  }
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

  $('#meName').addEventListener('change', (e) => { state.me.name = e.target.value.trim() || 'Вы'; $('.p-name').textContent = state.me.name; $('#railMe').textContent = initial(state.me.name); save(); renderRows(); });
  $('#meHandle').addEventListener('change', (e) => { state.me.handle = e.target.value.trim(); save(); });
  $('#meQuote').addEventListener('change', (e) => { state.me.quote = e.target.value.trim(); save(); });

  $('#pickAvatar').addEventListener('click', () => {
    const inp = el('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.addEventListener('change', async () => {
      if (!inp.files[0]) return;
      state.me.avatar = await compressImage(inp.files[0], 400, 0.8);
      save();
      renderProfilePanel();
      paintMe();
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
    if (!confirm('Удалить все чаты и настройки с этого устройства? Действие необратимо.')) return;
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
            <div class="circle-s">${c.members} человека · ${c.unread ? c.unread + ' новых' : 'тихо'}</div>
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
async function boot() {
  await ensureKey();
  state = await load();

  if (!state) {
    state = seed();
    prefs = state.prefs;
    await save();
  }
  if (!state.prefs) state.prefs = seed().prefs;
  applyAccent();

  // gate if no profile yet
  const gate = $('#gate');
  if (!state.me.name) {
    gate.hidden = false;
    $('#gateName').focus();
  }

  $('#gateGo').addEventListener('click', async () => {
    const name = $('#gateName').value.trim();
    if (!name) { $('#gateName').focus(); return toast('Как к вам обращаться?'); }
    let handle = $('#gateHandle').value.trim();
    if (!handle) handle = '@' + name.toLowerCase().replace(/\s+/g, '');
    if (!handle.startsWith('@')) handle = '@' + handle;
    state.me.name = name;
    state.me.handle = handle;
    await save();
    gate.hidden = true;
    paintMe();
    toast('Готово. Тишина включена.');
  });
  $('#gateHandle').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#gateGo').click(); });
  $('#gateName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#gateHandle').focus(); });

  $('#app').hidden = false;
  setTimeout(() => $('#splash').classList.add('hide'), 700);
  paintMe();
  renderRows();

  // composer
  const input = $('#input');
  input.addEventListener('input', autoGrow);
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
    add(c.pinned ? 'Открепить' : 'Закрепить', () => { c.pinned = !c.pinned; save(); renderRows(); });
    add(c.muted ? 'Включить звук' : 'Без звука', () => { c.muted = !c.muted; save(); renderRows(); toast(c.muted ? 'Чат без звука' : 'Звук включён'); });
    add('Очистить переписку', () => {
      if (!confirm('Удалить все сообщения в этом разговоре?')) return;
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
