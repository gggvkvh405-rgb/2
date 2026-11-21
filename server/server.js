/* ============================================================
   ByAzen server — accounts, chats, media, realtime (WebSocket)
   Zero-config: `node server/server.js`
   Data: JSON file in ./data (users, chats, messages, uploads)
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
let WebSocketServer;
try { ({ WebSocketServer } = require('ws')); } catch { console.error('Install deps first: npm install (needs "ws")'); process.exit(1); }

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_UPLOAD = 12 * 1024 * 1024; // 12 MB

/* ---------------- tiny helpers ---------------- */
const now = () => Date.now();
const rid = (n = 12) => crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n);
const hashPass = (pass, salt) =>
  crypto.scryptSync(pass, salt, 32).toString('hex');

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendErr(res, code, message) {
  json(res, code, { error: message });
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('bad json');
  }
}

/* ---------------- database (JSON file) ---------------- */
let db = { users: {}, chats: {}, messages: {}, tokens: {}, version: 1 };
let dirty = false;

async function initDb() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    const raw = await fsp.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    db = Object.assign(db, parsed);
  } catch {
    await persist();
  }
  setInterval(persist, 4000).unref();
  process.on('SIGINT', async () => { await persist(); process.exit(0); });
  process.on('SIGTERM', async () => { await persist(); process.exit(0); });
}

async function persist() {
  if (!dirty) return;
  dirty = false;
  const tmp = DB_FILE + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(db));
    await fsp.rename(tmp, DB_FILE);
  } catch (e) {
    dirty = true;
    console.error('persist failed', e.message);
  }
}
const touch = () => { dirty = true; };

/* ---------------- users ---------------- */
const NICK_RE = /^[a-z0-9_]{2,20}$/i;

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, nick: u.nick, name: u.name || u.nick, avatar: u.avatar || null, online: online.has(u.id) };
}

function userByToken(token) {
  const id = db.tokens[token];
  return id ? db.users[id] : null;
}

function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  return token ? userByToken(token) : null;
}

async function handleRegister(req, res) {
  const { nick, password, name } = await readJson(req, 4096);
  const clean = String(nick || '').trim().replace(/^@/, '');
  if (!NICK_RE.test(clean)) return sendErr(res, 400, 'Ник: 2–20 символов, буквы, цифры и _');
  if (String(password || '').length < 4) return sendErr(res, 400, 'Пароль минимум 4 символа');

  const lower = clean.toLowerCase();
  const exists = Object.values(db.users).find((u) => u.nickLower === lower);
  if (exists) return sendErr(res, 409, 'Этот ник уже занят');

  const salt = rid(16);
  const user = {
    id: rid(10),
    nick: clean,
    nickLower: lower,
    name: String(name || clean).slice(0, 40),
    salt,
    pass: hashPass(String(password), salt),
    createdAt: now(),
    avatar: null,
  };
  db.users[user.id] = user;
  const token = rid(24);
  db.tokens[token] = user.id;
  touch();
  await persist();
  json(res, 200, { token, user: publicUser(user) });
}

async function handleLogin(req, res) {
  const { nick, password } = await readJson(req, 4096);
  const clean = String(nick || '').trim().replace(/^@/, '').toLowerCase();
  const user = Object.values(db.users).find((u) => u.nickLower === clean);
  if (!user) return sendErr(res, 401, 'Аккаунт не найден');
  if (hashPass(String(password || ''), user.salt) !== user.pass) return sendErr(res, 401, 'Неверный пароль');
  const token = rid(24);
  db.tokens[token] = user.id;
  touch();
  await persist();
  json(res, 200, { token, user: publicUser(user) });
}

/* ---------------- chats ---------------- */
function chatsOf(userId) {
  return Object.values(db.chats).filter((c) => c.members.includes(userId));
}

function chatView(chat, me) {
  const others = chat.members.filter((id) => id !== me.id).map((id) => publicUser(db.users[id])).filter(Boolean);
  const msgs = db.messages[chat.id] || [];
  const last = msgs[msgs.length - 1] || null;
  const myRead = (chat.reads && chat.reads[me.id]) || 0;
  const unread = msgs.filter((m) => m.fromId !== me.id && m.ts > myRead).length;
  const name = chat.kind === 'circle'
    ? chat.name
    : others.map((o) => o.name).join(', ') || 'Избранное';
  return {
    id: chat.id,
    kind: chat.kind,
    name,
    members: others,
    memberCount: chat.members.length,
    unread,
    lastMessage: last
      ? {
          id: last.id,
          fromId: last.fromId,
          type: last.type,
          text: last.type === 'text' ? last.text : last.type,
          ts: last.ts,
          deleted: !!last.deleted,
        }
      : null,
    createdAt: chat.createdAt,
    avatar: chat.kind === 'circle' ? null : others[0]?.avatar || null,
  };
}

async function handleChats(req, res, user) {
  const list = chatsOf(user.id)
    .map((c) => chatView(c, user))
    .sort((a, b) => (b.lastMessage?.ts || b.createdAt) - (a.lastMessage?.ts || a.createdAt));
  json(res, 200, { chats: list });
}

async function handleCreateChat(req, res, user) {
  const body = await readJson(req, 4096);
  if (body.kind === 'dm') {
    const peer = db.users[body.userId];
    if (!peer || peer.id === user.id) return sendErr(res, 400, 'Пользователь не найден');
    const found = Object.values(db.chats).find(
      (c) => c.kind === 'dm' && c.members.length === 2 && c.members.includes(user.id) && c.members.includes(peer.id)
    );
    if (found) return json(res, 200, { chat: chatView(found, user) });
    const chat = { id: rid(10), kind: 'dm', name: null, members: [user.id, peer.id], createdAt: now(), reads: {} };
    db.chats[chat.id] = chat;
    db.messages[chat.id] = [];
    touch();
    await persist();
    broadcastChatView(chat.id, (member) => ({ t: 'chat:new', chat: chatView(chat, member) }), user.id);
    broadcastToUsers([user.id], { t: 'chat:new', chat: chatView(chat, user) });
    return json(res, 200, { chat: chatView(chat, user) });
  }
  if (body.kind === 'circle') {
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return sendErr(res, 400, 'Название круга обязательно');
    const chat = {
      id: rid(10),
      kind: 'circle',
      name: name.startsWith('Круг') ? name : 'Круг «' + name + '»',
      members: [user.id],
      createdAt: now(),
      reads: {},
    };
    db.chats[chat.id] = chat;
    db.messages[chat.id] = [];
    touch();
    await persist();
    return json(res, 200, { chat: chatView(chat, user) });
  }
  sendErr(res, 400, 'Неизвестный тип чата');
}

async function handleMessages(req, res, user, chatId, query) {
  const chat = db.chats[chatId];
  if (!chat || !chat.members.includes(user.id)) return sendErr(res, 403, 'Нет доступа');
  const limit = Math.min(Number(query.get('limit') || 100), 300);
  const msgs = (db.messages[chatId] || []).slice(-limit);
  json(res, 200, { messages: msgs.map((m) => messageView(m, user)) });
}

function messageView(m, me) {
  return {
    id: m.id,
    chatId: m.chatId,
    fromId: m.fromId,
    fromName: db.users[m.fromId]?.name || db.users[m.fromId]?.nick || '—',
    type: m.type,
    text: m.deleted ? '' : m.text,
    dur: m.dur || 0,
    ts: m.ts,
    replyTo: m.replyTo || null,
    deleted: !!m.deleted,
    reactions: m.reactions || {},
    dir: m.fromId === me.id ? 'out' : 'in',
    status: 'sent',
  };
}

/* ---------------- uploads ---------------- */
async function handleUpload(req, res, user, query) {
  const kind = query.get('kind') === 'voice' ? 'voice' : 'image';
  const buf = await readBody(req, MAX_UPLOAD);
  if (!buf.length) return sendErr(res, 400, 'Пустой файл');
  const ext = kind === 'voice' ? 'webm' : 'jpg';
  const name = `${rid(16)}.${ext}`;
  await fsp.writeFile(path.join(UPLOAD_DIR, name), buf);
  json(res, 200, { url: `/u/${name}`, kind, size: buf.length, by: user.id });
}

/* ---------------- search ---------------- */
async function handleUsers(req, res, user, query) {
  const q = String(query.get('q') || '').trim().toLowerCase().replace(/^@/, '');
  const list = Object.values(db.users)
    .filter((u) => u.id !== user.id)
    .filter((u) => !q || u.nickLower.includes(q) || (u.name || '').toLowerCase().includes(q))
    .slice(0, 20)
    .map(publicUser);
  json(res, 200, { users: list });
}

/* ---------------- realtime ---------------- */
const online = new Map(); // userId -> Set(ws)
let wss = null;

function broadcastToUsers(userIds, payload) {
  const data = JSON.stringify(payload);
  for (const id of userIds) {
    const set = online.get(id);
    if (!set) continue;
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }
}

function broadcastChat(chatId, payload, exceptUserId) {
  const chat = db.chats[chatId];
  if (!chat) return;
  const data = JSON.stringify(payload);
  for (const id of chat.members) {
    if (id === exceptUserId) continue;
    const set = online.get(id);
    if (!set) continue;
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }
}

/* per-member payloads: direction and unread are personal */
function broadcastChatView(chatId, makePayload, exceptUserId) {
  const chat = db.chats[chatId];
  if (!chat) return;
  for (const id of chat.members) {
    if (id === exceptUserId) continue;
    const set = online.get(id);
    if (!set) continue;
    const member = db.users[id];
    if (!member) continue;
    const data = JSON.stringify(makePayload(member));
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }
}

function setupWs(server) {
  wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const user = token ? userByToken(token) : null;
    if (!user) {
      ws.send(JSON.stringify({ t: 'error', error: 'unauthorized' }));
      ws.close();
      return;
    }

    ws.userId = user.id;
    if (!online.has(user.id)) online.set(user.id, new Set());
    const set = online.get(user.id);
    const first = set.size === 0;
    set.add(ws);
    if (first) {
      for (const chat of chatsOf(user.id)) broadcastChat(chat.id, { t: 'presence', userId: user.id, online: true }, user.id);
    }
    ws.send(JSON.stringify({ t: 'hello', user: publicUser(user), online: [...online.keys()] }));

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      try {
        await onWsMessage(ws, user, msg);
      } catch (e) {
        ws.send(JSON.stringify({ t: 'error', error: e.message }));
      }
    });

    ws.on('close', () => {
      const s = online.get(user.id);
      if (s) {
        s.delete(ws);
        if (!s.size) {
          online.delete(user.id);
          for (const chat of chatsOf(user.id)) {
            broadcastChat(chat.id, { t: 'presence', userId: user.id, online: false }, user.id);
          }
        }
      }
    });

    ws.on('error', () => {});
  });
}

async function onWsMessage(ws, user, msg) {
  switch (msg.t) {
    case 'subscribe':
      // no-op: all chats are pushed to members automatically
      break;

    case 'send': {
      const chat = db.chats[msg.chatId];
      if (!chat || !chat.members.includes(user.id)) throw new Error('Нет доступа к чату');
      const type = ['text', 'image', 'voice'].includes(msg.type) ? msg.type : 'text';
      const text = String(msg.text || '').slice(0, 8000);
      if (type === 'text' && !text.trim()) throw new Error('Пустое сообщение');
      if (type !== 'text' && !text) throw new Error('Нет файла');

      const m = {
        id: rid(12),
        chatId: chat.id,
        fromId: user.id,
        type,
        text,
        dur: Number(msg.dur) || 0,
        ts: now(),
        replyTo: msg.replyTo || null,
        reactions: {},
        deleted: false,
      };
      (db.messages[chat.id] = db.messages[chat.id] || []).push(m);
      if (db.messages[chat.id].length > 5000) db.messages[chat.id] = db.messages[chat.id].slice(-4000);
      touch();

      ws.send(JSON.stringify({ t: 'ack', tempId: msg.tempId, message: messageView(m, user), chat: chatView(chat, user) }));
      broadcastChatView(chat.id, (member) => ({
        t: 'message',
        message: messageView(m, member),
        chat: chatView(chat, member),
      }), user.id);
      // other devices of the same sender
      const set = online.get(user.id);
      if (set) {
        const payload = JSON.stringify({ t: 'message', message: messageView(m, user), chat: chatView(chat, user), self: true });
        for (const other of set) if (other !== ws && other.readyState === 1) other.send(payload);
      }
      break;
    }

    case 'typing': {
      const chat = db.chats[msg.chatId];
      if (!chat || !chat.members.includes(user.id)) return;
      broadcastChat(chat.id, { t: 'typing', chatId: chat.id, userId: user.id, name: user.name }, user.id);
      break;
    }

    case 'read': {
      const chat = db.chats[msg.chatId];
      if (!chat || !chat.members.includes(user.id)) return;
      chat.reads = chat.reads || {};
      chat.reads[user.id] = now();
      touch();
      broadcastChat(chat.id, { t: 'read', chatId: chat.id, userId: user.id, ts: now() }, user.id);
      break;
    }

    case 'react': {
      const chat = db.chats[msg.chatId];
      if (!chat || !chat.members.includes(user.id)) return;
      const m = (db.messages[chat.id] || []).find((x) => x.id === msg.msgId);
      if (!m) return;
      const emo = String(msg.emoji || '').slice(0, 8);
      m.reactions = m.reactions || {};
      m.reactions[emo] = m.reactions[emo] || [];
      const i = m.reactions[emo].indexOf(user.id);
      if (i >= 0) m.reactions[emo].splice(i, 1);
      else m.reactions[emo].push(user.id);
      if (!m.reactions[emo].length) delete m.reactions[emo];
      touch();
      broadcastChat(chat.id, { t: 'reaction', chatId: chat.id, msgId: m.id, reactions: m.reactions });
      break;
    }

    case 'delete': {
      const chat = db.chats[msg.chatId];
      if (!chat || !chat.members.includes(user.id)) return;
      const m = (db.messages[chat.id] || []).find((x) => x.id === msg.msgId);
      if (!m) return;
      if (m.fromId !== user.id) throw new Error('Можно удалять только свои сообщения');
      m.deleted = true;
      m.text = '';
      m.type = 'text';
      m.reactions = {};
      touch();
      broadcastChat(chat.id, { t: 'deleted', chatId: chat.id, msgId: m.id });
      break;
    }

    case 'profile': {
      if (msg.name) user.name = String(msg.name).slice(0, 40);
      if (msg.avatar !== undefined) user.avatar = msg.avatar;
      touch();
      await persist();
      for (const chat of chatsOf(user.id)) {
        broadcastChat(chat.id, { t: 'profile', userId: user.id, name: user.name, avatar: user.avatar }, user.id);
      }
      ws.send(JSON.stringify({ t: 'me', user: publicUser(user) }));
      break;
    }

    default:
      break;
  }
}

/* ---------------- static files ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webm': 'audio/webm',
  '.mp4': 'audio/mp4',
};

async function serveStatic(req, res, pathname) {
  let rel = pathname;
  if (rel === '/') rel = '/index.html';
  let base = ROOT;

  if (rel.startsWith('/u/')) {
    base = UPLOAD_DIR;
    rel = '/' + rel.slice(3);
  }

  const file = path.join(base, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(base)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error('not file');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
      'Permissions-Policy': 'microphone=(self), camera=(self)',
      'Service-Worker-Allowed': '/',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

/* ---------------- http server ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  try {
    if (pathname === '/api/health') return json(res, 200, { ok: true, version: 1, users: Object.keys(db.users).length });

    if (pathname === '/api/register' && req.method === 'POST') return await handleRegister(req, res);
    if (pathname === '/api/login' && req.method === 'POST') return await handleLogin(req, res);

    if (pathname.startsWith('/api/')) {
      const user = authUser(req);
      if (!user) return sendErr(res, 401, 'Нужен вход');

      if (pathname === '/api/me') return json(res, 200, { user: publicUser(user) });
      if (pathname === '/api/users') return await handleUsers(req, res, user, url.searchParams);
      if (pathname === '/api/chats' && req.method === 'GET') return await handleChats(req, res, user);
      if (pathname === '/api/chats' && req.method === 'POST') return await handleCreateChat(req, res, user);
      if (pathname === '/api/upload' && req.method === 'POST') return await handleUpload(req, res, user, url.searchParams);

      const mMsgs = pathname.match(/^\/api\/chats\/([\w-]+)\/messages$/);
      if (mMsgs && req.method === 'GET') return await handleMessages(req, res, user, mMsgs[1], url.searchParams);

      const mRead = pathname.match(/^\/api\/chats\/([\w-]+)\/read$/);
      if (mRead && req.method === 'POST') {
        const chat = db.chats[mRead[1]];
        if (!chat || !chat.members.includes(user.id)) return sendErr(res, 403, 'Нет доступа');
        chat.reads = chat.reads || {};
        chat.reads[user.id] = now();
        touch();
        return json(res, 200, { ok: true });
      }

      const mMembers = pathname.match(/^\/api\/chats\/([\w-]+)\/members$/);
      if (mMembers && req.method === 'POST') {
        const chat = db.chats[mMembers[1]];
        if (!chat || !chat.members.includes(user.id)) return sendErr(res, 403, 'Нет доступа');
        const body = await readJson(req, 4096);
        const peer = db.users[body.userId];
        if (!peer) return sendErr(res, 400, 'Пользователь не найден');
        if (!chat.members.includes(peer.id)) {
          if (chat.members.length >= 20) return sendErr(res, 400, 'В круге максимум 20 человек');
          chat.members.push(peer.id);
          touch();
          await persist();
          broadcastChatView(chat.id, (member) => ({ t: 'chat:update', chat: chatView(chat, member) }));
        }
        return json(res, 200, { chat: chatView(chat, user) });
      }

      return sendErr(res, 404, 'Не найдено');
    }

    return await serveStatic(req, res, pathname);
  } catch (e) {
    if (!res.headersSent) sendErr(res, 500, e.message || 'Ошибка сервера');
    else res.end();
  }
});

setupWs(server);

initDb().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`ByAzen server → http://localhost:${PORT}`);
    console.log(`  app:    /app/index.html`);
    console.log(`  ws:     /ws?token=…`);
    console.log(`  data:   ${DATA_DIR}`);
  });
});
