/* End-to-end smoke test for the ByAzen server: two accounts talking. */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let WebSocket;
try { ({ WebSocket } = require('ws')); } catch { console.error('npm install first (needs ws)'); process.exit(1); }

const PORT = 8099, BASE = `http://127.0.0.1:${PORT}`;
process.env.NO_PROXY = '*';
rmSync('/tmp/byazen-test-data', { recursive: true, force: true });
const srv = spawn('node', ['server/server.js'], {
  cwd: '/home/user/2',
  env: { ...process.env, PORT: String(PORT), DATA_DIR: '/tmp/byazen-test-data' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
await new Promise(r => setTimeout(r, 1200));

const api = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: await res.json() };
};

let pass = 0, fail = 0;
const check = (label, cond, extra='') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} — ${label} ${cond ? '' : extra}`); };

const health = await api('/api/health');
check('health', health.status === 200 && health.data.ok);

const a = await api('/api/register', { method: 'POST', body: { nick: 'artem', password: 'qwerty', name: 'Артём' } });
const b = await api('/api/register', { method: 'POST', body: { nick: 'mila', password: 'qwerty', name: 'Мила' } });
check('register A', a.status === 200 && !!a.data.token);
check('register B', b.status === 200 && !!b.data.token);
check('duplicate nick rejected', (await api('/api/register', { method: 'POST', body: { nick: 'mila', password: 'xxxx' } })).status === 409);
check('bad login rejected', (await api('/api/login', { method: 'POST', body: { nick: 'mila', password: 'nope' } })).status === 401);
check('login works', (await api('/api/login', { method: 'POST', body: { nick: 'mila', password: 'qwerty' } })).status === 200);

const ta = a.data.token, tb = b.data.token;
check('unauth blocked', (await api('/api/chats')).status === 401);
check('user lookup', (await api('/api/users?q=mi', { token: ta })).data.users.some(u => u.nick === 'mila'));

const chat = await api('/api/chats', { method: 'POST', token: ta, body: { kind: 'dm', userId: b.data.user.id } });
check('dm created', chat.status === 200 && chat.data.chat.kind === 'dm');
const chatId = chat.data.chat.id;
const chat2 = await api('/api/chats', { method: 'POST', token: ta, body: { kind: 'dm', userId: b.data.user.id } });
check('dm is idempotent', chat2.data.chat.id === chatId);

// websockets
const wsA = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${ta}`);
const wsB = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${tb}`);
const inboxA = [], inboxB = [];
const openA = new Promise(r => wsA.on('open', r));
const openB = new Promise(r => wsB.on('open', r));
wsA.on('message', m => inboxA.push(JSON.parse(m.toString())));
wsB.on('message', m => inboxB.push(JSON.parse(m.toString())));
await Promise.all([openA, openB]);
await new Promise(r => setTimeout(r, 300));
check('hello handshake', inboxA.some(x => x.t === 'hello') && inboxB.some(x => x.t === 'hello'));

wsA.send(JSON.stringify({ t: 'send', chatId, text: 'Привет, проверка связи', type: 'text', tempId: 't1' }));
await new Promise(r => setTimeout(r, 500));
const ack = inboxA.find(x => x.t === 'ack');
check('sender got ack', !!ack && ack.message.text === 'Привет, проверка связи');
const delivered = inboxB.find(x => x.t === 'message');
check('peer received message in realtime', !!delivered && delivered.message.text === 'Привет, проверка связи');

wsB.send(JSON.stringify({ t: 'typing', chatId }));
await new Promise(r => setTimeout(r, 250));
check('typing relayed', inboxA.some(x => x.t === 'typing'));

wsB.send(JSON.stringify({ t: 'react', chatId, msgId: ack.message.id, emoji: '❤️' }));
await new Promise(r => setTimeout(r, 250));
check('reaction relayed', inboxA.some(x => x.t === 'reaction'));

wsA.send(JSON.stringify({ t: 'read', chatId }));
await new Promise(r => setTimeout(r, 250));
check('read receipt relayed', inboxB.some(x => x.t === 'read'));

const hist = await api(`/api/chats/${chatId}/messages`, { token: tb });
check('history for peer', hist.data.messages.length === 1 && hist.data.messages[0].dir === 'in');

const chatsB = await api('/api/chats', { token: tb });
check('chat listed for peer with unread 0 after read', chatsB.data.chats.length === 1);

// upload
const img = Buffer.from('89504e470d0a1a0a', 'hex');
const up = await fetch(`${BASE}/api/upload?kind=image`, { method: 'POST', headers: { Authorization: 'Bearer ' + ta }, body: img });
const upj = await up.json();
check('upload returns url', up.status === 200 && upj.url.startsWith('/u/'));
const got = await fetch(BASE + upj.url);
check('uploaded file served', got.status === 200);

// circle
const circle = await api('/api/chats', { method: 'POST', token: ta, body: { kind: 'circle', name: 'Кухня' } });
check('circle created', circle.status === 200 && circle.data.chat.kind === 'circle');
const cid = circle.data.chat.id;
const added = await api(`/api/chats/${cid}/members`, { method: 'POST', token: ta, body: { userId: b.data.user.id } });
check('circle member added', added.status === 200 && added.data.chat.memberCount === 2);
check('circle access for new member', (await api(`/api/chats/${cid}/messages`, { token: tb })).status === 200);
check('stranger cannot read', (await api(`/api/chats/${chatId}/messages`, { token: 'bad' })).status === 401);

// delete message
wsA.send(JSON.stringify({ t: 'delete', chatId, msgId: ack.message.id }));
await new Promise(r => setTimeout(r, 300));
check('delete relayed', inboxB.some(x => x.t === 'deleted'));

wsA.close(); wsB.close();
await new Promise(r => setTimeout(r, 400));
srv.kill('SIGTERM');
await new Promise(r => setTimeout(r, 600));

// persistence after restart
const srv2 = spawn('node', ['server/server.js'], {
  cwd: '/home/user/2',
  env: { ...process.env, PORT: String(PORT + 1), DATA_DIR: '/tmp/byazen-test-data' },
  stdio: 'ignore',
});
await new Promise(r => setTimeout(r, 1200));
const relogin = await fetch(`http://127.0.0.1:${PORT + 1}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nick: 'mila', password: 'qwerty' }) });
const rj = await relogin.json();
check('data persisted across restart', relogin.status === 200 && !!rj.token);
srv2.kill('SIGTERM');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
