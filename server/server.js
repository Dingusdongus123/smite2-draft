'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const Engine = require(path.join(__dirname, '..', 'src', 'engine.js'));

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const defaultRoster = require(path.join(__dirname, '..', 'src', 'gods.json'));

function clipName(value, fallback) {
  const cleaned = String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
  return cleaned || fallback;
}

function sanitizeConfig(input = {}) {
  const num = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };
  return {
    format: input.format === 'extended' ? 'extended' : 'standard',
    pickSeconds: num(input.pickSeconds, 5, 300, 40),
    banSeconds: num(input.banSeconds, 5, 300, 18),
    bankSeconds: num(input.bankSeconds, 0, 600, 90),
    timeout: input.timeout === 'skip' ? 'skip' : 'random'
  };
}

function randomCode() {
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

function randomToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function normalizeCode(value) {
  const code = String(value ?? '').toUpperCase();
  return /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? code : null;
}

function createApp(options = {}) {
  const roster = options.roster || defaultRoster;
  const idleMs = options.idleMs ?? 10 * 60 * 1000;
  const tickMs = options.tickMs ?? 250;
  const maxRooms = options.maxRooms ?? 400;
  const rooms = new Map();
  const sockets = new WeakMap();
  const createBuckets = new Map();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('cache-control', 'no-store');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Crystal Draft room server. Connect with a WebSocket. Health: /health\n');
  });

  const wss = new WebSocketServer({ server });

  function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
  }

  function rateOk(ip) {
    const now = Date.now();
    let bucket = createBuckets.get(ip);
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + 60_000 };
      createBuckets.set(ip, bucket);
    }
    bucket.count += 1;
    return bucket.count <= 40;
  }

  function send(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(message)); } catch { /* closing socket */ }
    }
  }

  function slotOf(room, side) {
    return side === 'Order' ? room.order : room.chaos;
  }

  function isOpen(slot) {
    return !!(slot?.ws && slot.ws.readyState === WebSocket.OPEN);
  }

  function bothOpen(room) {
    return isOpen(room.order) && isOpen(room.chaos);
  }

  function anyOpen(room) {
    return isOpen(room.order) || isOpen(room.chaos);
  }

  function presence(room) {
    return { Order: isOpen(room.order), Chaos: isOpen(room.chaos) };
  }

  function broadcast(room, reason) {
    const message = {
      type: 'state',
      state: room.state,
      sentAt: Date.now(),
      reason: reason || 'state',
      presence: presence(room)
    };
    for (const slot of [room.order, room.chaos]) send(slot?.ws, message);
  }

  function maybeResume(room) {
    if (!room.resumeOnReconnect || room.state.phase !== 'paused' || !bothOpen(room)) return;
    try {
      room.resumeOnReconnect = false;
      room.state = Engine.apply(room.state, { type: 'resume' }, roster, Date.now());
    } catch { /* leave the draft paused if resume is illegal */ }
  }

  function bind(ws, room, side) {
    const slot = slotOf(room, side);
    if (slot.ws && slot.ws !== ws) {
      const previous = slot.ws;
      previous._replaced = true;
      sockets.delete(previous);
      try { previous.close(); } catch { /* already gone */ }
    }
    slot.ws = ws;
    sockets.set(ws, { code: room.code, side });
    room.lastActivity = Date.now();
  }

  function finishSeat(ws, room, side, role) {
    bind(ws, room, side);
    maybeResume(room);
    const slot = slotOf(room, side);
    send(ws, {
      type: 'welcome',
      role,
      code: room.code,
      side,
      token: slot.token,
      state: room.state,
      sentAt: Date.now(),
      presence: presence(room)
    });
    const other = side === 'Order' ? room.chaos : room.order;
    if (other?.ws && other.ws !== ws && other.ws.readyState === WebSocket.OPEN) {
      send(other.ws, {
        type: 'rival',
        name: slot.name,
        side,
        reconnected: role === 'reconnected'
      });
    }
    const reason = role === 'created' ? 'created' : role === 'reconnected' ? 'reconnect' : 'join';
    broadcast(room, reason);
  }

  function handleCreate(ws, msg) {
    if (sockets.has(ws)) return;
    if (rooms.size >= maxRooms) {
      send(ws, { type: 'rejected', message: 'The room server is full. Try again shortly.' });
      return;
    }
    if (!rateOk(ws._ip || 'unknown')) {
      send(ws, { type: 'rejected', message: 'Too many rooms from this network. Wait a moment.' });
      return;
    }
    const config = sanitizeConfig(msg.config);
    const name = clipName(msg.name, 'Order captain');
    let code = randomCode();
    while (rooms.has(code)) code = randomCode();
    const state = Engine.create(config);
    state.names.Order = name;
    const room = {
      code,
      state,
      closed: false,
      lastActivity: Date.now(),
      resumeOnReconnect: false,
      order: { token: randomToken(), name, ws: null },
      chaos: null
    };
    rooms.set(code, room);
    finishSeat(ws, room, 'Order', 'created');
  }

  function handleJoin(ws, msg) {
    if (sockets.has(ws)) {
      send(ws, { type: 'rejected', message: 'Already connected to a room.' });
      return;
    }
    const code = normalizeCode(msg.code);
    const room = code && rooms.get(code);
    if (!room || room.closed) {
      send(ws, { type: 'rejected', message: 'No room with that code. It may have expired.' });
      return;
    }
    const name = clipName(msg.name, 'Chaos captain');
    if (room.chaos?.ws && room.chaos.ws.readyState === WebSocket.OPEN) {
      send(ws, { type: 'rejected', message: 'This room already has two captains.' });
      return;
    }
    if (room.chaos?.token) {
      if (msg.token && msg.token === room.chaos.token) {
        room.chaos.name = name;
        room.state.names.Chaos = name;
        finishSeat(ws, room, 'Chaos', 'reconnected');
        return;
      }
      send(ws, { type: 'rejected', message: 'This seat is reserved. Reconnect if you dropped, or ask for a new room.' });
      return;
    }
    room.chaos = { token: randomToken(), name, ws: null };
    room.state.names.Chaos = name;
    finishSeat(ws, room, 'Chaos', 'joined');
  }

  function handleReconnect(ws, msg) {
    if (sockets.has(ws)) {
      send(ws, { type: 'rejected', message: 'Already connected to a room.' });
      return;
    }
    const code = normalizeCode(msg.code);
    const room = code && rooms.get(code);
    if (!room || room.closed) {
      send(ws, { type: 'rejected', message: 'That room has expired. The server may have slept. Create a new one.' });
      return;
    }
    const token = String(msg.token || '');
    let side = null;
    if (room.order?.token === token) side = 'Order';
    else if (room.chaos?.token === token) side = 'Chaos';
    if (!side) {
      send(ws, { type: 'rejected', message: 'This seat is no longer available.' });
      return;
    }
    const slot = slotOf(room, side);
    if (msg.name) {
      slot.name = clipName(msg.name, slot.name);
      room.state.names[side] = slot.name;
    }
    finishSeat(ws, room, side, 'reconnected');
  }

  function handleAction(ws, msg) {
    const meta = sockets.get(ws);
    if (!meta) return;
    const room = rooms.get(meta.code);
    if (!room || room.closed) {
      send(ws, { type: 'rejected', message: 'That room has expired.' });
      return;
    }
    const action = msg.action;
    if (!action || typeof action.type !== 'string') return;
    room.lastActivity = Date.now();

    if (action.type === 'commit') {
      if (action.timeout) {
        send(ws, { type: 'notice', message: 'Only the room server can apply a timeout.' });
        return;
      }
      if (action.side !== meta.side) {
        send(ws, { type: 'notice', message: 'You can only act for your own side.' });
        return;
      }
      if (action.rev !== room.state.rev) {
        send(ws, { type: 'notice', message: 'The turn changed; please select again.' });
        return;
      }
    } else if (action.type === 'start' || action.type === 'pause' || action.type === 'resume' || action.type === 'restart') {
      if (meta.side !== 'Order') {
        send(ws, { type: 'notice', message: 'Only the Order host can do that.' });
        return;
      }
    } else if (action.type === 'undo') {
      send(ws, { type: 'notice', message: 'Undo is only available in same-screen practice.' });
      return;
    } else if (action.type === 'aspect') {
      if (action.side !== meta.side) {
        send(ws, { type: 'notice', message: 'You can only act for your own side.' });
        return;
      }
    } else if (action.type === 'roles') {
      if (action.side !== meta.side) {
        send(ws, { type: 'notice', message: 'You can only assign roles for your own team.' });
        return;
      }
    } else {
      send(ws, { type: 'notice', message: 'Unknown action.' });
      return;
    }

    if (action.type === 'start') {
      if (room.state.phase !== 'lobby') {
        send(ws, { type: 'notice', message: 'Draft already started.' });
        return;
      }
      if (!isOpen(room.chaos)) {
        send(ws, { type: 'notice', message: 'Wait for your rival to join.' });
        return;
      }
      const config = sanitizeConfig(action.config || room.state.config);
      const orderName = clipName(action.name || room.state.names.Order, 'Order captain');
      const chaosName = room.state.names.Chaos;
      const fresh = Engine.create(config);
      fresh.names.Order = orderName;
      fresh.names.Chaos = chaosName;
      room.order.name = orderName;
      room.state = fresh;
      try {
        room.state = Engine.apply(room.state, { type: 'start' }, roster, Date.now());
      } catch (error) {
        send(ws, { type: 'notice', message: error.message });
        return;
      }
      broadcast(room, 'start');
      return;
    }

    if (action.type === 'resume' && !bothOpen(room)) {
      send(ws, { type: 'notice', message: 'Wait until both captains are connected.' });
      return;
    }

    try {
      room.state = Engine.apply(room.state, action, roster, Date.now());
    } catch (error) {
      send(ws, { type: 'notice', message: error.message });
      return;
    }
    if (action.type === 'pause') room.resumeOnReconnect = false;
    if (action.type === 'restart') room.resumeOnReconnect = false;
    broadcast(room, action.type === 'commit' ? 'action' : action.type);
  }

  function handleLeave(ws) {
    const meta = sockets.get(ws);
    if (!meta) {
      try { ws.close(); } catch { /* noop */ }
      return;
    }
    const room = rooms.get(meta.code);
    sockets.delete(ws);
    ws._replaced = true;
    if (!room || room.closed) {
      try { ws.close(); } catch { /* noop */ }
      return;
    }
    if (meta.side === 'Order') {
      room.closed = true;
      rooms.delete(room.code);
      for (const slot of [room.order, room.chaos]) {
        if (slot?.ws && slot.ws !== ws && slot.ws.readyState === WebSocket.OPEN) {
          send(slot.ws, { type: 'closed', message: 'The host left the room.' });
          slot.ws._replaced = true;
          try { slot.ws.close(); } catch { /* noop */ }
        }
      }
      try { ws.close(); } catch { /* noop */ }
      return;
    }
    const slot = room.chaos;
    if (slot?.ws === ws) room.chaos = null;
    room.resumeOnReconnect = false;
    if (room.state.phase !== 'lobby') {
      const config = room.state.config;
      const orderName = room.state.names.Order;
      room.state = Engine.create(config);
      room.state.names.Order = orderName;
      room.state.names.Chaos = 'Chaos captain';
    } else if (room.state.names) {
      room.state.names.Chaos = 'Chaos captain';
    }
    try { ws.close(); } catch { /* noop */ }
    if (isOpen(room.order)) {
      send(room.order.ws, { type: 'notice', message: 'Your rival left. The room is open for a new captain.' });
      send(room.order.ws, { type: 'rival', name: '', side: 'Chaos', left: true });
    }
    broadcast(room, 'leave');
  }

  function onSocketClose(ws) {
    if (ws._replaced) return;
    const meta = sockets.get(ws);
    if (!meta) return;
    sockets.delete(ws);
    const room = rooms.get(meta.code);
    if (!room || room.closed) return;
    const slot = slotOf(room, meta.side);
    if (!slot || slot.ws !== ws) return;
    slot.ws = null;
    room.lastActivity = Date.now();
    if (room.state.phase === 'draft') {
      try {
        room.resumeOnReconnect = true;
        room.state = Engine.apply(room.state, { type: 'pause' }, roster, Date.now());
      } catch { /* already paused or finished */ }
    }
    broadcast(room, 'disconnect');
  }

  function onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    const meta = sockets.get(ws);
    if (meta) {
      const room = rooms.get(meta.code);
      if (room) room.lastActivity = Date.now();
    }
    if (msg.type === 'ping') {
      send(ws, { type: 'pong', sentAt: Date.now() });
      return;
    }
    if (msg.type === 'create') return handleCreate(ws, msg);
    if (msg.type === 'join') return handleJoin(ws, msg);
    if (msg.type === 'reconnect') return handleReconnect(ws, msg);
    if (msg.type === 'action') return handleAction(ws, msg);
    if (msg.type === 'leave') return handleLeave(ws);
    send(ws, { type: 'notice', message: 'Unknown message.' });
  }

  wss.on('connection', (ws, req) => {
    ws._ip = clientIp(req);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary || data.length > 16384) {
        try { ws.close(1009, 'Message too large'); } catch { /* noop */ }
        return;
      }
      const now = Date.now();
      if (!ws._msgReset || now > ws._msgReset) {
        ws._msgReset = now + 10_000;
        ws._msgs = 0;
      }
      ws._msgs += 1;
      if (ws._msgs > 80) {
        try { ws.close(1008, 'Slow down'); } catch { /* noop */ }
        return;
      }
      try { onMessage(ws, data); }
      catch (error) {
        send(ws, { type: 'notice', message: 'The room server hit an error handling that.' });
        console.error('room message error', error && error.message);
      }
    });
    ws.on('close', () => onSocketClose(ws));
    ws.on('error', () => onSocketClose(ws));
  });

  const tickTimer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.state.phase !== 'draft' || !bothOpen(room)) continue;
      const turn = Engine.current(room.state);
      if (!turn) continue;
      const bank = room.state.bank[turn.side] || 0;
      if (now < room.state.deadline + bank * 1000) continue;
      const used = Engine.used(room.state);
      let god = null;
      if (room.state.config.timeout !== 'skip') {
        const available = roster.filter(godInfo => !used.has(godInfo.id));
        if (available.length) god = available[Math.floor(Math.random() * available.length)].id;
      }
      try {
        room.state = Engine.apply(room.state, {
          type: 'commit',
          side: turn.side,
          god,
          timeout: true,
          rev: room.state.rev
        }, roster, now);
        room.lastActivity = now;
        broadcast(room, 'timeout');
      } catch {
        room.state.deadline = now + 5000;
      }
    }
    for (const [code, room] of rooms) {
      if (!anyOpen(room) && now - room.lastActivity > idleMs) rooms.delete(code);
    }
  }, tickMs);

  const pulseTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* closing */ }
    }
  }, 30_000);

  function close() {
    clearInterval(tickTimer);
    clearInterval(pulseTimer);
    for (const ws of wss.clients) {
      try { ws.terminate(); } catch { /* noop */ }
    }
    wss.close();
    return new Promise(resolve => server.close(() => resolve()));
  }

  return { server, rooms, close };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  const app = createApp();
  app.server.listen(port, '0.0.0.0', () => {
    console.log(`Crystal Draft rooms listening on :${port}`);
  });
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createApp };
