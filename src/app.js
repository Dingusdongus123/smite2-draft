'use strict';
(() => {
const E = DraftEngine;
const gods = JSON.parse(document.getElementById('roster-data').textContent);
const byId = Object.fromEntries(gods.map(g => [g.id, g]));
function mounted() {
  try { return typeof document !== 'undefined' && !!document.getElementById('lobby'); }
  catch { return false; }
}
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Room server origin. Health is the same host over HTTP(S) at /health.
// Tests may set window.CRYSTAL_ROOM_SERVER before this script runs.
const DEFAULT_ROOM_SERVER = 'wss://smite2-draft-rooms.onrender.com';
const ROOM_SERVER = String(window.CRYSTAL_ROOM_SERVER || DEFAULT_ROOM_SERVER).replace(/\/$/, '');
const CONNECT_BUDGET = Number(window.CRYSTAL_CONNECT_BUDGET_MS) || 75000;
const RETRY_DELAY = Number(window.CRYSTAL_RETRY_DELAY_MS) || 900;
const ATTEMPT_MS = Number(window.CRYSTAL_ATTEMPT_MS) || 0;

const audio = { ctx: null, enabled: false, unlocked: false, lastTick: null, played: [] };
try { audio.enabled = localStorage.getItem('crystal-draft-sound') === '1'; } catch { /* private mode */ }

let state = E.create();
let mode = 'local';
let tab = 'local';
let selected = null;
let preview = null;
let mySide = null;
let room = '';
let token = '';
let connected = false;
let socket = null;
let connectGen = 0;
let session = 0;
let suppressDrop = false;
let netPhase = 'idle';
let failNote = '';
let presence = { Order: false, Chaos: false };
let clockOffset = 0;
let turnKey = '';
let seenSummary = -1;
let toastTimer = 0;
let titleTimer = null;
const BASE_TITLE = 'Crystal Draft · SMITE 2';

function toast(text) {
  if (!mounted()) return;
  $('toast').textContent = text;
  $('toast').style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').style.display = 'none'; }, 4500);
}

function getName(id, fallback) { return $(id).value.trim().slice(0, 24) || fallback; }
function localSide() { return mode === 'host' ? 'Order' : mode === 'guest' ? 'Chaos' : E.current(state)?.side; }
function canAct() { return state.phase === 'draft' && (mode === 'local' || (connected && E.current(state)?.side === localSide())); }
function readConfig() {
  const num = (id, min, max) => Math.max(min, Math.min(max, Number($(id).value) || 0));
  return { format: $('format').value, pickSeconds: num('pickSeconds', 5, 300), banSeconds: num('banSeconds', 5, 300), bankSeconds: num('bankSeconds', 0, 600), timeout: $('timeout').value };
}
function healthUrl() { return ROOM_SERVER.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:') + '/health'; }
function resetFilters() { for (const id of ['search', 'roleFilter', 'pantheonFilter', 'damageFilter']) $(id).value = ''; }

function syncSound() {
  $('soundEffects').checked = audio.enabled;
}
function setSoundEnabled(enabled) {
  audio.enabled = enabled;
  $('soundEffects').checked = enabled;
  try { localStorage.setItem('crystal-draft-sound', enabled ? '1' : '0'); } catch { /* ignore */ }
  if (enabled) {
    unlockAudio();
    play('confirm');
  }
}
function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!audio.unlocked) {
    audio.unlocked = true;
    if (AC) {
      try {
        audio.ctx = new AC();
        if (audio.ctx.state === 'suspended') audio.ctx.resume();
      } catch { audio.ctx = null; }
    }
  } else if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
}
function bell(partials, when) {
  if (!audio.ctx) return;
  const ctx = audio.ctx;
  const t0 = ctx.currentTime + (when || 0);
  for (const part of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 480;
    osc.type = part.type || 'sine';
    osc.frequency.setValueAtTime(part.freq, t0);
    if (part.to) osc.frequency.exponentialRampToValueAtTime(Math.max(40, part.to), t0 + part.dur);
    const peak = part.gain ?? 0.05;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + (part.attack || 0.006));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + part.dur);
    osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + part.dur + 0.03);
  }
}
function play(kind) {
  if (!audio.enabled || !audio.unlocked) return;
  audio.played.push(kind);
  if (kind === 'confirm') bell([{ freq: 1568, dur: 0.08, type: 'sine', gain: 0.05 }, { freq: 2093, dur: 0.12, type: 'triangle', gain: 0.032 }]);
  else if (kind === 'tick') bell([{ freq: 2480, dur: 0.045, type: 'triangle', gain: 0.035 }, { freq: 3720, dur: 0.035, type: 'sine', gain: 0.02 }]);
  else if (kind === 'tick-final') bell([{ freq: 1860, dur: 0.09, type: 'triangle', gain: 0.05 }, { freq: 2790, dur: 0.07, type: 'sine', gain: 0.028 }]);
  else if (kind === 'ban') bell([{ freq: 740, to: 520, dur: 0.2, type: 'triangle', gain: 0.05 }, { freq: 1480, dur: 0.14, type: 'sine', gain: 0.03 }, { freq: 1110, dur: 0.16, type: 'sine', gain: 0.022 }]);
  else if (kind === 'pick') bell([{ freq: 880, dur: 0.16, type: 'sine', gain: 0.045 }, { freq: 1320, dur: 0.16, type: 'triangle', gain: 0.035 }, { freq: 1760, dur: 0.18, type: 'sine', gain: 0.028 }]);
  else if (kind === 'your-turn') bell([{ freq: 988, dur: 0.12, type: 'sine', gain: 0.045 }, { freq: 1480, dur: 0.16, type: 'triangle', gain: 0.04 }], 0.05);
  else if (kind === 'join') bell([{ freq: 1046, dur: 0.12, type: 'sine', gain: 0.04 }, { freq: 1318, dur: 0.13, type: 'sine', gain: 0.035 }, { freq: 1568, dur: 0.18, type: 'triangle', gain: 0.03 }]);
  else if (kind === 'disconnect') bell([{ freq: 660, to: 340, dur: 0.22, type: 'triangle', gain: 0.045 }, { freq: 440, to: 220, dur: 0.26, type: 'sine', gain: 0.03 }], 0.02);
}
function stopFlash() {
  if (titleTimer) { clearInterval(titleTimer); titleTimer = null; }
  document.title = BASE_TITLE;
}
function flashTitle(message) {
  if (typeof document.hidden === 'boolean' && !document.hidden) return;
  stopFlash();
  let on = false;
  titleTimer = setInterval(() => { on = !on; document.title = on ? message : BASE_TITLE; }, 900);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) stopFlash(); });
document.addEventListener('pointerdown', () => { if (audio.enabled) unlockAudio(); });
document.addEventListener('keydown', () => { if (audio.enabled) unlockAudio(); });

function saveSeat() {
  try { sessionStorage.setItem('crystal-seat', JSON.stringify({ code: room, token, side: mySide, name: getName('displayName', state.names?.[mySide] || '') })); } catch { /* ignore */ }
}
function loadSeat() { try { return JSON.parse(sessionStorage.getItem('crystal-seat') || 'null'); } catch { return null; } }
function clearSeat() { try { sessionStorage.removeItem('crystal-seat'); } catch { /* ignore */ } }
function codeFromLocation() {
  let query = '';
  try { query = new URLSearchParams(location.search).get('room') || ''; } catch { /* ignore */ }
  const hash = (location.hash.match(/^#room=([A-HJ-NP-Z2-9]{8})$/i) || [])[1] || '';
  const raw = (query || hash).toUpperCase();
  return /^[A-HJ-NP-Z2-9]{8}$/.test(raw) ? raw : '';
}

function send(data) {
  if (socket && socket.readyState === 1) {
    try { socket.send(JSON.stringify(data)); } catch { toast('Connection interrupted. Reconnect to continue.'); }
  }
}
function closeSocket() {
  connectGen += 1;
  suppressDrop = true;
  const current = socket;
  socket = null;
  if (!current) return;
  current.onopen = null;
  current.onmessage = null;
  current.onerror = null;
  current.onclose = null;
  try { current.close(); } catch { /* ignore */ }
}
function openSocket() {
  const gen = ++connectGen;
  const started = Date.now();
  let attempt = 0;
  return new Promise(resolve => {
    let settled = false;
    const finish = ws => {
      if (settled) return;
      settled = true;
      if (gen !== connectGen && ws) { try { ws.close(); } catch { /* ignore */ } }
      resolve(gen === connectGen ? (ws || null) : null);
    };
    const giveUp = () => { if (gen !== connectGen) return finish(null); netPhase = 'idle'; render(); finish(null); };
    const schedule = () => {
      if (gen !== connectGen) return finish(null);
      if (Date.now() - started > CONNECT_BUDGET) return giveUp();
      netPhase = 'waking';
      render();
      setTimeout(attemptConnect, RETRY_DELAY);
    };
    const attemptConnect = () => {
      if (gen !== connectGen) return finish(null);
      if (Date.now() - started > CONNECT_BUDGET || attempt >= 12) return giveUp();
      attempt += 1;
      netPhase = attempt > 1 ? 'waking' : 'opening';
      render();
      let ws;
      let attemptDone = false;
      const slow = setTimeout(() => { if (!attemptDone && gen === connectGen) { netPhase = 'waking'; render(); } }, 1200);
      const timer = setTimeout(() => {
        if (attemptDone) return;
        attemptDone = true;
        clearTimeout(slow);
        try { ws.close(); } catch { /* ignore */ }
        schedule();
      }, ATTEMPT_MS || (attempt === 1 ? 7000 : 8000));
      try { ws = new WebSocket(ROOM_SERVER); }
      catch { attemptDone = true; clearTimeout(slow); clearTimeout(timer); schedule(); return; }
      ws.onerror = () => {};
      ws.onopen = () => {
        if (attemptDone) { try { ws.close(); } catch { /* ignore */ } return; }
        attemptDone = true;
        clearTimeout(slow);
        clearTimeout(timer);
        if (gen !== connectGen) { try { ws.close(); } catch { /* ignore */ } return finish(null); }
        netPhase = 'ready';
        finish(ws);
      };
      ws.onclose = () => {
        if (attemptDone) return;
        attemptDone = true;
        clearTimeout(slow);
        clearTimeout(timer);
        schedule();
      };
    };
    attemptConnect();
  });
}
function attachSocket(ws) {
  socket = ws;
  suppressDrop = false;
  ws.onmessage = ev => {
    let message;
    try { message = JSON.parse(ev.data); } catch { return; }
    onMessage(message);
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    connected = false;
    if (suppressDrop) { suppressDrop = false; return; }
    handleDrop();
  };
}
function failJoin(message) {
  mode = 'local';
  room = '';
  connected = false;
  mySide = null;
  netPhase = 'idle';
  failNote = message;
  toast(message);
  render();
}
async function createRoom() {
  if (netPhase === 'opening' || netPhase === 'waking') return;
  unlockAudio();
  failNote = '';
  mode = 'host';
  const stamp = session;
  closeSocket();
  const ws = await openSocket();
  if (stamp !== session) { if (ws) try { ws.close(); } catch { /* ignore */ } return; }
  if (!ws) return failJoin('The room server did not respond. It can take a minute to wake — try again.');
  attachSocket(ws);
  send({ type: 'create', name: getName('displayName', 'Order captain'), config: readConfig() });
}
async function joinRoom() {
  if (netPhase === 'opening' || netPhase === 'waking') return;
  unlockAudio();
  const code = $('roomCode').value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return toast('Enter the 8-character room code.');
  failNote = '';
  mode = 'guest';
  room = code;
  const stamp = session;
  closeSocket();
  const ws = await openSocket();
  if (stamp !== session) { if (ws) try { ws.close(); } catch { /* ignore */ } return; }
  if (!ws) return failJoin('The room server did not respond. It can take a minute to wake — try again.');
  attachSocket(ws);
  const seat = loadSeat();
  const name = getName('displayName', 'Chaos captain');
  if (seat && seat.code === code && seat.token) send({ type: 'reconnect', code, token: seat.token, name });
  else send({ type: 'join', code, name });
}
async function manualReconnect() {
  const seat = loadSeat();
  if (!seat?.code || !seat?.token) {
    if (tab === 'guest' || mode === 'guest') return joinRoom();
    return toast('No saved seat for this room.');
  }
  if (netPhase === 'opening' || netPhase === 'waking') return;
  unlockAudio();
  failNote = '';
  closeSocket();
  netPhase = 'opening';
  render();
  const stamp = session;
  const ws = await openSocket();
  if (!ws || stamp !== session) { if (ws) try { ws.close(); } catch { /* ignore */ } return; }
  attachSocket(ws);
  room = seat.code;
  mode = seat.side === 'Order' ? 'host' : 'guest';
  mySide = seat.side;
  send({ type: 'reconnect', code: seat.code, token: seat.token, name: getName('displayName', seat.name || '') });
}
function handleDrop() {
  connected = false;
  turnKey = '';
  netPhase = 'opening';
  play('disconnect');
  toast('Connection lost. Reconnecting…');
  if (state.phase === 'draft') {
    const now = Date.now() + clockOffset;
    state.remaining = Math.max(0, (state.deadline || now) - now);
    state.phase = 'paused';
  }
  render();
  const seat = loadSeat();
  if (!seat?.token || !seat.code) { netPhase = 'idle'; render(); return; }
  const stamp = session;
  openSocket().then(ws => {
    if (!ws || stamp !== session) {
      if (ws) try { ws.close(); } catch { /* ignore */ }
      if (stamp === session) {
        failNote = 'Reconnection failed. If the server slept, the room is gone — create a new one.';
        toast('Could not reconnect. The room may have expired while the server slept.');
        netPhase = 'idle';
        render();
      }
      return;
    }
    attachSocket(ws);
    room = seat.code;
    mode = seat.side === 'Order' ? 'host' : 'guest';
    mySide = seat.side;
    send({ type: 'reconnect', code: seat.code, token: seat.token });
  });
}
function cueTurn() {
  if (mode === 'local' || !connected || state.phase !== 'draft') { turnKey = ''; return; }
  const turn = E.current(state);
  if (!turn || turn.side !== localSide()) { turnKey = ''; return; }
  const key = state.step + ':' + turn.side;
  if (key === turnKey) return;
  turnKey = key;
  play('your-turn');
  if (document.hidden) flashTitle('Your turn · Crystal Draft');
}
function applyState(next, sentAt, reason) {
  if (!next || next.version !== 1 || !E.DRAFT_ORDERS[next.config?.format]) return;
  const prevPhase = state.phase;
  const prevLen = state.actions.length;
  if (typeof sentAt === 'number') clockOffset = sentAt - Date.now();
  state = next;
  const enteredLobby = state.phase === 'lobby' && prevPhase !== 'lobby';
  if (enteredLobby) {
    selected = null;
    preview = null;
    turnKey = '';
    audio.lastTick = null;
    resetFilters();
  } else if (selected && E.used(state).has(selected)) selected = null;
  if (reason === 'disconnect') {
    play('disconnect');
    toast(state.phase === 'lobby' ? 'Your rival disconnected.' : 'Your rival disconnected. The draft is held.');
  }
  if ((reason === 'action' || reason === 'timeout') && state.actions.length > prevLen) {
    const action = state.actions[state.actions.length - 1];
    play(action.type === 'ban' ? 'ban' : 'pick');
  }
  cueTurn();
  render();
}
function onMessage(m) {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'welcome') {
    room = m.code;
    token = m.token;
    mySide = m.side;
    mode = m.side === 'Order' ? 'host' : 'guest';
    connected = true;
    netPhase = 'ready';
    failNote = '';
    if (m.presence) presence = m.presence;
    saveSeat();
    applyState(m.state, m.sentAt, m.role);
    if (m.role === 'joined') toast('Joined room ' + room + '.');
    if (m.role === 'reconnected') toast('Reconnected to room ' + room + '.');
    return;
  }
  if (m.type === 'rival') {
    if (m.left) {
      if (m.side) presence[m.side] = false;
      toast('Your rival left the room.');
      play('disconnect');
      render();
      return;
    }
    if (m.side) presence[m.side] = true;
    const verb = m.reconnected ? 'reconnected' : 'joined';
    toast(m.name + ' ' + verb + ' the room.');
    play('join');
    flashTitle(m.name + ' ' + verb + ' · Crystal Draft');
    render();
    return;
  }
  if (m.type === 'state') {
    if (m.presence) presence = m.presence;
    applyState(m.state, m.sentAt, m.reason);
    return;
  }
  if (m.type === 'notice' && m.message) { toast(m.message); return; }
  if (m.type === 'rejected') {
    toast(m.message || 'Request refused.');
    connected = false;
    netPhase = 'idle';
    failNote = m.message || 'Request refused.';
    if (mode === 'host' && state.phase === 'lobby' && !state.actions.length && m.role !== 'keep') {
      /* Stay on the create tab so the code can be corrected or retried. */
    }
    render();
    return;
  }
  if (m.type === 'pong' && typeof m.sentAt === 'number') { clockOffset = m.sentAt - Date.now(); return; }
  if (m.type === 'closed') {
    suppressDrop = true;
    toast(m.message || 'The room has closed.');
    play('disconnect');
    closeSocket();
    resetLocal();
  }
}

function picture(g, extra = '') { return `<img src="${g.image}" alt="${esc(g.name)}" ${extra}>`; }
function slotHTML(a, i, side) {
  if (a?.god) {
    const g = byId[a.god];
    return `<div class="slot">${picture(g)}<div class="slottext"><strong>${esc(g.name)}</strong><small>${esc(g.role)} · ${esc(g.damage)}</small></div></div>`;
  }
  const upcoming = E.current(state)?.type === 'pick' && E.current(state)?.side === side && i === state.actions.filter(x => x.side === side && x.type === 'pick').length && state.phase === 'draft';
  return `<div class="slot empty ${upcoming ? 'upcoming' : ''}"><b>${String(i + 1).padStart(2, '0')}</b>${a ? 'PASSED ON TIMEOUT' : 'Awaiting selection'}</div>`;
}
function bansHTML(side) {
  const bans = state.actions.filter(a => a.side === side && a.type === 'ban');
  const count = state.config.format === 'extended' ? 5 : 3;
  return Array.from({ length: count }, (_, i) => {
    const action = bans[i];
    if (action?.god) {
      const g = byId[action.god];
      return `<div class="ban filled" title="${esc(g.name)}" aria-label="Banned: ${esc(g.name)}"><div class="thumb">${picture(g)}</div><span class="banname">${esc(g.name)}</span></div>`;
    }
    if (action) return `<div class="ban" title="Passed"><div class="thumb">—</div><span class="banname">Pass</span></div>`;
    return `<div class="ban" title="Ban ${i + 1}"><div class="thumb">×</div></div>`;
  }).join('');
}
function renderTeam(side) {
  const picks = state.actions.filter(a => a.side === side && a.type === 'pick');
  const panel = $(side.toLowerCase() + 'Team');
  const banCount = state.config.format === 'extended' ? 5 : 3;
  panel.classList.toggle('active', E.current(state)?.side === side && state.phase === 'draft');
  panel.innerHTML = `<div class="teamhead"><div><h2>${side.toUpperCase()}</h2><div class="captain">${esc(state.names[side])}${mode !== 'local' && localSide() === side ? ' · YOU' : ''}</div></div><div class="sigil"><i></i></div></div>${Array.from({ length: 5 }, (_, i) => slotHTML(picks[i], i, side)).join('')}<div class="banlabel"><span>THE EXILED</span><span>${state.actions.filter(a => a.side === side && a.type === 'ban').length}/${banCount}</span></div><div class="bans">${bansHTML(side)}</div><div class="teamfoot"><span>${side === 'Order' ? 'FIRST PICK' : 'COUNTER PICK'}</span><span id="bank${side}">${Math.ceil(state.bank[side])}s BANK</span></div>`;
}
function filteredGods() {
  const term = $('search').value.toLowerCase().trim();
  const role = $('roleFilter').value;
  const pantheon = $('pantheonFilter').value;
  const damage = $('damageFilter').value;
  return gods.filter(g => (!term || (g.name + ' ' + g.title).toLowerCase().includes(term)) && (!role || (role.startsWith('class:') ? g.class === role.slice(6) : g.role === role)) && (!pantheon || g.pantheon === pantheon) && (!damage || g.damage === damage));
}
function renderGrid() {
  const used = E.used(state);
  const filtered = filteredGods();
  $('godCount').textContent = `${gods.length - used.size} available · ${filtered.length} shown`;
  $('godGrid').innerHTML = filtered.length ? filtered.map(g => {
    const action = state.actions.find(a => a.god === g.id);
    return `<button class="god ${selected === g.id ? 'selected' : ''}" data-god="${g.id}" ${used.has(g.id) ? 'disabled' : ''} title="${esc(g.name + ' — ' + g.title + ' · ' + g.role + ' · ' + g.pantheon + ' · ' + g.damage)}" aria-label="${esc(g.name + (action ? ' ' + action.type + ' by ' + action.side : ''))}" aria-pressed="${selected === g.id}">${picture(g, 'loading="lazy"')}<span>${esc(g.name)}</span>${action ? `<span class="status">${action.type.toUpperCase()}</span>` : ''}</button>`;
  }).join('') : '<div class="empty-grid">No gods match these filters. Try another search.</div>';
}
function showPreview(id) {
  preview = id;
  const g = byId[id];
  $('previewImg').hidden = !g;
  if (g) {
    $('previewImg').src = g.image;
    $('previewImg').alt = g.name;
    $('previewName').textContent = g.name;
    $('previewMeta').textContent = `${g.title} · ${g.pantheon} · ${g.role} · ${g.damage} · ${g.class} (approx.)`;
  } else {
    $('previewImg').removeAttribute('src');
    $('previewName').textContent = 'Discover your next pick';
    $('previewMeta').textContent = 'Hover to preview. Select a god, then lock in.';
  }
}
function renderSummary() {
  if (state.phase !== 'summary') { $('summaryModal').hidden = true; return; }
  $('summaryTeams').innerHTML = ['Order', 'Chaos'].map(side => `<div class="summary-team"><h3>${side.toUpperCase()} · ${esc(state.names[side])}</h3>${state.actions.filter(a => a.side === side && a.type === 'pick').map((a, i) => slotHTML(a, i, side)).join('')}<div class="banlabel">BANS</div><div class="bans">${bansHTML(side)}</div></div>`).join('');
  $('restartBtn').disabled = mode === 'guest';
  $('restartBtn').textContent = mode === 'guest' ? 'Waiting for host' : 'Draft again →';
  if (seenSummary !== state.rev) { $('summaryModal').hidden = false; seenSummary = state.rev; $('inspectBtn').focus(); }
}
function renderEnter() {
  if (state.phase !== 'lobby') return;
  if (netPhase === 'waking') {
    $('enterBtn').textContent = 'Waking the room server…';
    $('enterBtn').disabled = true;
    return;
  }
  if (netPhase === 'opening') {
    $('enterBtn').textContent = (mode === 'guest' || tab === 'guest') ? 'Connecting…' : 'Opening room…';
    $('enterBtn').disabled = true;
    return;
  }
  if (mode === 'host' && room) {
    if (!connected) {
      $('enterBtn').textContent = 'Reconnect →';
      $('enterBtn').disabled = false;
      return;
    }
    if (presence.Chaos) {
      $('enterBtn').textContent = 'Start online draft →';
      $('enterBtn').disabled = false;
    } else {
      $('enterBtn').textContent = 'Waiting for rival…';
      $('enterBtn').disabled = true;
    }
    return;
  }
  if (mode === 'guest') {
    const seat = loadSeat();
    const canReconnect = !!(seat && seat.code === room && seat.token);
    $('enterBtn').textContent = connected ? 'Connected · waiting for host' : (canReconnect ? 'Reconnect →' : 'Retry join →');
    $('enterBtn').disabled = connected;
    return;
  }
  if (failNote && (tab === 'host' || tab === 'guest')) {
    $('enterBtn').disabled = false;
    $('enterBtn').textContent = tab === 'guest' ? 'Retry join →' : 'Retry create room →';
  }
}
function renderRoomLine() {
  if (netPhase === 'waking') {
    $('roomInfo').textContent = 'Waking the room server… Free hosts can take up to a minute. Retrying.';
    return;
  }
  if (netPhase === 'opening') {
    $('roomInfo').textContent = mode === 'guest' ? 'Connecting to the room server…' : 'Opening a room…';
    return;
  }
  if (failNote && !connected && state.phase === 'lobby') {
    $('roomInfo').textContent = failNote;
    return;
  }
  if (mode === 'host' && room && state.phase === 'lobby') {
    $('roomInfo').textContent = connected ? `Room ${room} · share the code or the join link.` : `Room ${room} · disconnected. Use Reconnect.`;
    $('modeHelp').textContent = 'Your rival opens this site and joins with the code or the link.';
    return;
  }
  if (mode === 'guest' && room && state.phase === 'lobby') {
    $('roomInfo').textContent = connected ? `Room ${room} · you are Chaos. Waiting for Order to start.` : `Room ${room} · disconnected. Use Reconnect.`;
    $('modeHelp').textContent = connected ? 'You are Chaos. Order starts the draft.' : 'Disconnected. Reconnect to take your seat back.';
    return;
  }
  if (!room && state.phase === 'lobby' && !failNote) $('roomInfo').textContent = '';
}
function render() {
  if (!mounted()) return;
  const turn = E.current(state);
  const lobby = state.phase === 'lobby';
  $('lobby').style.display = lobby ? 'grid' : 'none';
  $('draftHeader').style.display = lobby ? 'none' : 'flex';
  $('sessionLabel').textContent = mode === 'local' ? 'Same-screen practice' : `Online draft · You are ${localSide()}`;
  $('roomBadge').textContent = room ? `ROOM ${room}` : 'LOCAL';
  const showCopy = !!room && mode !== 'local';
  const connecting = netPhase === 'waking' || netPhase === 'opening';
  $('copyLink').hidden = !showCopy;
  $('copyLinkDraft').hidden = !showCopy;
  $('cancelRoom').hidden = !(lobby && (showCopy || (connecting && mode !== 'local')));
  $('reconnectBtn').hidden = mode === 'local' || connected || lobby;
  $('phaseLabel').textContent = lobby ? 'Draft room · standby' : state.phase === 'summary' ? 'Draft complete' : state.phase === 'paused' ? 'Draft paused' : `${state.config.format === 'extended' ? 'Extended' : 'Standard'} · action ${state.step + 1}/${E.DRAFT_ORDERS[state.config.format].length}`;
  $('turnLabel').textContent = lobby ? 'Your strategy starts here.' : state.phase === 'summary' ? 'Both teams are locked in.' : state.phase === 'paused' ? 'The chamber is holding.' : `${turn.side.toUpperCase()} · ${turn.type === 'ban' ? 'BAN A GOD' : 'PICK A GOD'}`;
  $('progress').style.width = state.step / E.DRAFT_ORDERS[state.config.format].length * 100 + '%';
  renderTeam('Order');
  renderTeam('Chaos');
  renderGrid();
  showPreview(selected || preview);
  $('lockBtn').disabled = !selected || !canAct();
  $('lockBtn').textContent = selected && state.phase === 'draft' ? `${turn?.type === 'ban' ? 'Ban' : 'Pick'} ${byId[selected].name}` : 'Lock in choice';
  $('undoBtn').disabled = mode !== 'local' || !state.history.length;
  $('pauseBtn').disabled = state.phase !== 'draft' || (mode !== 'local' && mode !== 'host');
  $('pauseBtn').style.display = state.phase === 'paused' ? 'none' : '';
  $('resumeBtn').style.display = state.phase === 'paused' ? '' : 'none';
  const online = mode === 'host' || mode === 'guest';
  $('resumeBtn').disabled = state.phase !== 'paused' || (online ? (!connected || mode !== 'host' || !presence.Chaos) : false);
  let status = '● Same-screen practice';
  if (netPhase === 'waking') status = '○ Waking the room server…';
  else if (online) status = connected ? `● Connected · ${localSide()}` : '○ Waiting for connection · timer held';
  $('connectionStatus').textContent = status;
  $('connectionStatus').classList.toggle('waking', netPhase === 'waking');
  renderEnter();
  renderRoomLine();
  renderSummary();
  tick(false);
}
function tick(allowTimeout = true) {
  if (!mounted()) return;
  const turn = E.current(state);
  if (!turn || !['draft', 'paused'].includes(state.phase)) {
    $('clock').textContent = '—';
    audio.lastTick = null;
    return;
  }
  const now = Date.now() + clockOffset;
  const remaining = state.phase === 'paused' ? state.remaining / 1000 : (state.deadline - now) / 1000;
  const bank = state.bank[turn.side];
  const bankRemaining = Math.max(0, bank + Math.min(0, remaining));
  $('clock').textContent = remaining > 0 ? String(Math.ceil(remaining)).padStart(2, '0') : String(Math.ceil(bankRemaining)).padStart(2, '0');
  $('clock').classList.toggle('urgent', remaining <= 0 && bankRemaining <= 10);
  const bankEl = $('bank' + turn.side);
  if (bankEl) bankEl.textContent = Math.ceil(bankRemaining) + 's BANK' + (remaining <= 0 ? ' · ACTIVE' : '');
  if (state.phase === 'draft') {
    const shown = remaining > 0 ? Math.ceil(remaining) : (bankRemaining > 0 ? Math.ceil(bankRemaining) : 0);
    if (shown >= 1 && shown <= 5) {
      if (audio.lastTick !== shown) {
        audio.lastTick = shown;
        play(shown === 1 ? 'tick-final' : 'tick');
      }
    } else audio.lastTick = null;
  } else audio.lastTick = null;
  if (allowTimeout && mode === 'local' && state.phase === 'draft' && remaining + bank <= 0) {
    const available = gods.filter(g => !E.used(state).has(g.id));
    const god = state.config.timeout === 'skip' ? null : available[Math.floor(Math.random() * available.length)]?.id ?? null;
    transition({ type: 'commit', god, side: turn.side, timeout: true });
  }
}
function transition(action) {
  const prevPhase = state.phase;
  const prevLen = state.actions.length;
  try { state = E.apply(state, action, gods); }
  catch (error) { toast(error.message); return false; }
  const enteredLobby = state.phase === 'lobby' && prevPhase !== 'lobby';
  if (enteredLobby) {
    selected = null;
    preview = null;
    turnKey = '';
    audio.lastTick = null;
    resetFilters();
  } else selected = null;
  if (state.actions.length > prevLen) {
    const last = state.actions[state.actions.length - 1];
    play(last.type === 'ban' ? 'ban' : 'pick');
  }
  render();
  return true;
}
function request(action) {
  if (mode === 'local') return transition(action);
  if (!connected) return toast('Reconnect before making a choice.');
  send({ type: 'action', action: { ...action, rev: state.rev } });
}
function lock() { if (!selected || !canAct()) return; request({ type: 'commit', god: selected, side: localSide() }); }
function startOnline() {
  unlockAudio();
  send({ type: 'action', action: { type: 'start', config: readConfig(), name: getName('displayName', 'Order captain'), rev: state.rev } });
}
function startLocal() {
  unlockAudio();
  state = E.create(readConfig());
  state.names = { Order: getName('displayName', 'Order captain'), Chaos: getName('otherName', 'Chaos captain') };
  mode = 'local';
  mySide = null;
  transition({ type: 'start' });
}
function setTab(next) {
  if (mode !== 'local' || room) { toast('Leave the current room before changing mode.'); return; }
  tab = next;
  failNote = '';
  for (const [name, id] of [['local', 'tabLocal'], ['host', 'tabHost'], ['guest', 'tabJoin']]) {
    $(id).classList.toggle('active', next === name);
    $(id).setAttribute('aria-selected', String(next === name));
  }
  $('otherField').style.display = next === 'local' ? '' : 'none';
  $('joinControls').style.display = next === 'guest' ? 'block' : 'none';
  $('hostSettings').style.display = next === 'guest' ? 'none' : '';
  $('nameLabel').textContent = next === 'local' ? 'Order captain' : 'Your display name';
  $('enterBtn').textContent = next === 'local' ? 'Begin local draft →' : next === 'host' ? 'Create room →' : 'Join room →';
  $('enterBtn').disabled = false;
  $('modeHelp').textContent = next === 'local'
    ? 'Two captains, one screen. No account or connection required.'
    : next === 'host'
      ? 'You are Order. Share the room code or join link with your rival.'
      : 'You are Chaos. Enter the room code, or open the join link on this site.';
  if (!room) $('roomInfo').textContent = '';
}
function resetLocal() {
  session += 1;
  clearSeat();
  mode = 'local';
  mySide = null;
  room = '';
  token = '';
  connected = false;
  netPhase = 'idle';
  failNote = '';
  presence = { Order: false, Chaos: false };
  selected = null;
  preview = null;
  clockOffset = 0;
  turnKey = '';
  audio.lastTick = null;
  state = E.create();
  seenSummary = -1;
  resetFilters();
  setTab('local');
  render();
}
function leave() {
  if ((room || connected || state.actions.length) && !confirm('Leave this draft? Leaving an online room gives up your seat.')) return;
  unlockAudio();
  if (socket && socket.readyState === 1) {
    suppressDrop = true;
    send({ type: 'leave' });
  }
  closeSocket();
  resetLocal();
}
function share() {
  if (!room) return;
  unlockAudio();
  let text = room;
  let copied = 'Room code copied.';
  if (location.protocol !== 'file:') {
    try {
      const url = new URL(location.href);
      url.hash = '';
      url.searchParams.set('room', room);
      text = url.toString();
      copied = 'Join link copied.';
    } catch { text = room; }
  }
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast(copied), () => toast(text));
  else toast(text);
}
function exportSummary() {
  const lines = ['CRYSTAL DRAFT — SMITE 2', `Format: ${state.config.format}`, ''];
  for (const side of ['Order', 'Chaos']) {
    lines.push(`${side} — ${state.names[side]}`);
    for (const type of ['pick', 'ban']) lines.push(`${type.toUpperCase()}S: ` + state.actions.filter(a => a.side === side && a.type === type).map(a => a.god ? byId[a.god].name : '[timeout pass]').join(', '));
    lines.push('');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'smite2-crystal-draft.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('enterBtn').onclick = () => {
  unlockAudio();
  if (mode === 'host') {
    if (connected && room && state.phase === 'lobby') return startOnline();
    if (room && !connected) return manualReconnect();
    return createRoom();
  }
  if (mode === 'guest') {
    if (connected) return;
    const seat = loadSeat();
    if (room && seat?.code === room && seat?.token) return manualReconnect();
    return joinRoom();
  }
  if (tab === 'host') return createRoom();
  if (tab === 'guest') return joinRoom();
  startLocal();
};
$('tabLocal').onclick = () => setTab('local');
$('tabHost').onclick = () => setTab('host');
$('tabJoin').onclick = () => setTab('guest');
$('lockBtn').onclick = lock;
$('godGrid').onclick = e => {
  const button = e.target.closest('[data-god]');
  if (!button || button.disabled) return;
  unlockAudio();
  selected = button.dataset.god;
  showPreview(selected);
  renderGrid();
  const turn = E.current(state);
  $('lockBtn').disabled = !canAct();
  $('lockBtn').textContent = state.phase === 'draft' ? `${turn?.type === 'ban' ? 'Ban' : 'Pick'} ${byId[selected].name}` : 'Lock in choice';
};
$('godGrid').onpointerover = e => { const button = e.target.closest('[data-god]'); if (button) showPreview(button.dataset.god); };
$('godGrid').onfocusin = e => { const button = e.target.closest('[data-god]'); if (button) showPreview(button.dataset.god); };
$('godGrid').onpointerleave = () => showPreview(selected || preview);
for (const id of ['search', 'roleFilter', 'pantheonFilter', 'damageFilter']) $(id).addEventListener('input', renderGrid);
$('undoBtn').onclick = () => { if (mode === 'local') request({ type: 'undo' }); };
$('pauseBtn').onclick = () => { if (mode === 'local' || mode === 'host') request({ type: 'pause' }); };
$('resumeBtn').onclick = () => { if (mode === 'local' || (mode === 'host' && connected)) request({ type: 'resume' }); };
$('restartBtn').onclick = () => { if (mode !== 'guest' && confirm('Return to the lobby for a new draft?')) { seenSummary = -1; request({ type: 'restart' }); } };
$('inspectBtn').onclick = () => { $('summaryModal').hidden = true; };
$('exportBtn').onclick = exportSummary;
$('leaveBtn').onclick = leave;
$('cancelRoom').onclick = leave;
$('copyLink').onclick = share;
$('copyLinkDraft').onclick = share;
$('reconnectBtn').onclick = () => { manualReconnect(); };
$('soundEffects').addEventListener('change', () => setSoundEnabled($('soundEffects').checked));
$('researchBtn').onclick = () => { $('researchModal').hidden = false; $('closeResearch').focus(); };
$('closeResearch').onclick = () => { $('researchModal').hidden = true; $('researchBtn').focus(); };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('researchModal').hidden = true; $('summaryModal').hidden = true; }
  if (e.key === 'Enter' && e.target === $('search') && selected) lock();
});
document.addEventListener('click', () => { if (audio.enabled) unlockAudio(); });

const roles = [...new Set(gods.map(g => g.role))].sort();
const classes = [...new Set(gods.map(g => g.class))].sort();
$('roleFilter').innerHTML = '<option value="">All roles / classes</option><optgroup label="SMITE 2 roles">' + roles.map(v => `<option>${esc(v)}</option>`).join('') + '</optgroup><optgroup label="Approximate classes">' + classes.map(v => `<option value="class:${esc(v)}">${esc(v)}</option>`).join('') + '</optgroup>';
$('pantheonFilter').innerHTML += [...new Set(gods.map(g => g.pantheon))].sort().map(v => `<option>${esc(v)}</option>`).join('');
const band = '<div class="marquee-group">' + gods.map(g => picture(g)).join('') + '</div>';
$('marquee').innerHTML = band + band;
syncSound();

function prewarm() {
  if (typeof fetch !== 'function') return;
  const slow = setTimeout(() => {
    if (mounted() && state.phase === 'lobby' && !connected && netPhase === 'idle' && !room) $('roomInfo').textContent = 'Waking the room server…';
  }, 1500);
  fetch(healthUrl(), { cache: 'no-store' }).catch(() => {}).finally(() => {
    clearTimeout(slow);
    if (mounted() && state.phase === 'lobby' && !connected && netPhase === 'idle' && !room && $('roomInfo').textContent.startsWith('Waking')) $('roomInfo').textContent = '';
  });
}
let heartbeats = 0;
function heartbeat() {
  heartbeats += 1;
  if (socket && socket.readyState === 1) send({ type: 'ping' });
  if (heartbeats % 9 === 0 && connected && typeof fetch === 'function') fetch(healthUrl(), { cache: 'no-store' }).catch(() => {});
}
function boot() {
  const code = codeFromLocation();
  const seat = loadSeat();
  if (seat?.token && seat.code && (!code || code === seat.code)) {
    setTab(seat.side === 'Order' ? 'host' : 'guest');
    if (seat.name) $('displayName').value = seat.name;
    if (seat.side !== 'Order') $('roomCode').value = seat.code;
    mode = seat.side === 'Order' ? 'host' : 'guest';
    mySide = seat.side;
    room = seat.code;
    netPhase = 'opening';
    render();
    const stamp = session;
    openSocket().then(ws => {
      if (!ws || stamp !== session) { if (ws) try { ws.close(); } catch { /* ignore */ } return; }
      attachSocket(ws);
      send({ type: 'reconnect', code: seat.code, token: seat.token, name: getName('displayName', seat.name || '') });
    });
  } else if (code) {
    setTab('guest');
    $('roomCode').value = code;
    render();
  } else render();
  prewarm();
}

setInterval(() => tick(true), 200);
setInterval(heartbeat, 20000);
boot();

window.CrystalDraft = {
  getState: () => JSON.parse(JSON.stringify(state)),
  gods,
  engine: E,
  playedSounds: () => audio.played.slice(),
  roomServer: ROOM_SERVER
};
})();
