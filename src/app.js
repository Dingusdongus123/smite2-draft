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
let previousDraftId = '';
let armedRole = null;
let showRoleStats = false;
const roleSeeded = { Order: false, Chaos: false };
let replayRecord = null;
let replayStep = 0;
let replayTimer = null;
let assistPlanId = '';
let assistSide = 'Order';
let currentDraftId = '';
const HISTORY_KEY = 'crystal-draft-history';
const PLANS_KEY = 'crystal-draft-plans';
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
  else if (kind === 'alert') bell([{ freq: 988, dur: 0.1, type: 'triangle', gain: 0.05 }, { freq: 740, dur: 0.16, type: 'sine', gain: 0.04 }], 0.04);
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
    noteAssist(action);
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
function canToggleAspect(side) {
  if (mode === 'replay' || !['draft', 'paused', 'summary'].includes(state.phase)) return false;
  if (mode === 'local') return true;
  return localSide() === side;
}
function slotHTML(a, i, side) {
  if (a?.god) {
    const g = byId[a.god];
    const aspect = g.aspect;
    const button = aspect
      ? `<button type="button" class="aspect-btn ${a.aspect ? 'on' : ''}" data-aspect="${esc(g.id)}" data-side="${side}" title="${esc(aspect.name + ' — ' + aspect.description)}" aria-pressed="${a.aspect ? 'true' : 'false'}" aria-label="${esc((a.aspect ? 'Aspect on: ' : 'Toggle ') + aspect.name)}" ${canToggleAspect(side) ? '' : 'disabled'}></button>`
      : '';
    const showRole = state.phase === 'summary' || mode === 'replay';
    const tag = showRole ? `<span class="role-tag ${a.role ? (a.roleConfirmed ? 'set' : 'hint') : ''}">${a.role ? esc(roleLabel(a.role) + (a.roleConfirmed ? '' : ' · suggested')) : (canAssign(side) ? 'Choose role' : '')}</span>` : '';
    return `<div class="slot" data-role-pick="${i}" data-role-side="${side}"><div class="face ${a.aspect ? 'aspected' : ''}">${picture(g)}${button}</div><div class="slottext"><strong>${esc(g.name)}</strong><small>${esc(g.role)} · ${esc(g.damage)}</small></div>${tag}</div>`;
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
  panel.innerHTML = `<div class="teamhead"><div><h2>${side.toUpperCase()}</h2><div class="captain">${esc(state.names[side])}${mode !== 'local' && mode !== 'replay' && localSide() === side ? ' · YOU' : ''}</div></div><div class="sigil"><i></i></div></div>${roleRow(side)}${Array.from({ length: 5 }, (_, i) => slotHTML(picks[i], i, side)).join('')}<div class="banlabel"><span>THE EXILED</span><span>${state.actions.filter(a => a.side === side && a.type === 'ban').length}/${banCount}</span></div><div class="bans">${bansHTML(side)}</div><div class="teamfoot"><span>${side === 'Order' ? 'FIRST PICK' : 'COUNTER PICK'}</span><span id="bank${side}">${Math.ceil(state.bank[side])}s BANK</span></div>`;
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
    const aspectNote = g.aspect ? ' · ' + g.aspect.name : '';
    return `<button class="god ${selected === g.id ? 'selected' : ''}" data-god="${g.id}" ${used.has(g.id) ? 'disabled' : ''} title="${esc(g.name + ' — ' + g.title + ' · ' + g.role + ' · ' + g.pantheon + ' · ' + g.damage + aspectNote)}" aria-label="${esc(g.name + (action ? ' ' + action.type + ' by ' + action.side : '') + aspectNote)}" aria-pressed="${selected === g.id}">${picture(g, 'loading="lazy"')}<span>${esc(g.name)}</span>${action ? `<span class="status">${action.type.toUpperCase()}</span>` : ''}</button>`;
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
    $('previewMeta').textContent = `${g.title} · ${g.pantheon} · ${g.role} · ${g.damage} · ${g.class} (approx.)${g.aspect ? ' · ' + g.aspect.name + ': ' + g.aspect.description : ''}`;
  } else {
    $('previewImg').removeAttribute('src');
    $('previewName').textContent = 'Discover your next pick';
    $('previewMeta').textContent = 'Hover to preview. Select a god, then lock in.';
  }
}
function renderSummary() {
  if (state.phase !== 'summary' || mode === 'replay') { if (mode !== 'replay') $('summaryModal').hidden = true; return; }
  $('summaryTeams').innerHTML = ['Order', 'Chaos'].map(side => `<div class="summary-team"><h3>${side.toUpperCase()} · ${esc(state.names[side])}</h3>${roleRow(side)}${state.actions.filter(a => a.side === side && a.type === 'pick').map((a, i) => slotHTML(a, i, side)).join('')}<div class="banlabel">BANS</div><div class="bans">${bansHTML(side)}</div></div>`).join('');
  $('restartBtn').disabled = mode === 'guest';
  $('restartBtn').textContent = mode === 'guest' ? 'Waiting for host' : 'Draft again →';
  if (seenSummary !== state.rev) {
    try {
      currentDraftId = DraftCodec.encodeDraft({
        format: state.config.format,
        names: state.names,
        date: new Date().toISOString(),
        gods: state.actions.map(a => a.god || null),
        aspects: state.actions.map(a => !!(a.type === 'pick' && a.aspect)),
        roles: state.actions.map(a => a.type === 'pick' ? { role: a.role || '', confirmed: !!a.roleConfirmed } : null)
      }, gods.map(g => g.id));
      rememberHistory({ id: currentDraftId, format: state.config.format, names: state.names, date: new Date().toISOString().slice(0, 10) }, previousDraftId);
      previousDraftId = currentDraftId;
    } catch (error) { currentDraftId = ''; toast(error.message); }
    $('summaryModal').hidden = false;
    seenSummary = state.rev;
    $('inspectBtn').focus();
  }
  $('draftIdCode').textContent = currentDraftId;
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
function canAssign(side) {
  if (mode === 'replay' || state.phase !== 'summary') return false;
  if (mode === 'local') return true;
  return connected && localSide() === side;
}
function roleRow(side) {
  if (state.phase !== 'summary' && mode !== 'replay') return '';
  const can = canAssign(side);
  const used = new Set(state.actions.filter(a => a.type === 'pick' && a.side === side && a.role).map(a => a.role));
  const chips = DraftCodec.ROLES.map(role => `<button type="button" class="role-chip ${used.has(role) ? 'used' : ''} ${armedRole && armedRole.side === side && armedRole.role === role ? 'armed' : ''}" draggable="${can ? 'true' : 'false'}" data-role="${role}" data-side="${side}" ${can ? '' : 'disabled'}>${roleIcon(role)}${esc(roleLabel(role))}</button>`).join('');
  return `<div class="role-row" data-side="${side}">${chips}</div>`;
}
function guessRoles(side) {
  const picks = state.actions.filter(a => a.type === 'pick' && a.side === side);
  const savedPlan = loadPlans().find(item => item.id === assistPlanId);
  const plan = savedPlan ? adoptPlan(savedPlan) : null;
  const usePlan = plan && side === assistedSide();
  const taken = new Set();
  const roles = picks.map(() => ({ role: '', confirmed: false }));
  if (usePlan) {
    picks.forEach((pick, index) => {
      if (!pick.god) return;
      let best = null;
      DraftCodec.ROLES.forEach(role => {
        const list = plan.roles && plan.roles[role] || [];
        const rank = list.indexOf(pick.god);
        if (rank < 0 || taken.has(role)) return;
        if (!best || rank < best.rank) best = { role, rank };
      });
      if (best) { roles[index] = { role: best.role, confirmed: false }; taken.add(best.role); }
    });
  }
  picks.forEach((pick, index) => {
    if (roles[index].role || !pick.god) return;
    const primary = byId[pick.god] && byId[pick.god].role;
    if (primary && DraftCodec.ROLES.includes(primary) && !taken.has(primary)) {
      roles[index] = { role: primary, confirmed: false };
      taken.add(primary);
    }
  });
  return roles;
}
function writeRoles(side, roles) {
  const action = { type: 'roles', side, roles };
  if (mode === 'local') {
    state = E.apply(state, action, gods);
    return true;
  }
  if (connected) send({ type: 'action', action });
  return false;
}
function maybeSeedRoles() {
  if (state.phase !== 'summary' || mode === 'replay') return false;
  let changed = false;
  ['Order', 'Chaos'].forEach(side => {
    if (!canAssign(side) || roleSeeded[side]) return;
    const picks = state.actions.filter(a => a.type === 'pick' && a.side === side);
    if (!picks.length || picks.some(pick => pick.role)) { roleSeeded[side] = true; return; }
    roleSeeded[side] = true;
    changed = writeRoles(side, guessRoles(side)) || changed;
  });
  return changed;
}
function dropRole(side, index, role) {
  if (!canAssign(side) || !DraftCodec.ROLES.includes(role)) return;
  const picks = state.actions.filter(a => a.type === 'pick' && a.side === side);
  if (!picks[index]) return;
  const roles = picks.map(pick => ({ role: pick.role || '', confirmed: !!pick.roleConfirmed }));
  if (roles[index].role === role) {
    roles[index].confirmed = true;
  } else {
    const from = roles.findIndex((entry, i) => entry.role === role && i !== index);
    const previous = roles[index].role;
    roles[index] = { role, confirmed: true };
    if (from >= 0) roles[from] = previous ? { role: previous, confirmed: true } : { role: '', confirmed: false };
  }
  if (writeRoles(side, roles)) render();
}
function render() {
  if (!mounted()) return;
  if (state.phase === 'lobby') { roleSeeded.Order = false; roleSeeded.Chaos = false; }
  if (maybeSeedRoles()) return render();
  const turn = E.current(state);
  const lobby = state.phase === 'lobby';
  $('lobby').style.display = lobby ? 'grid' : 'none';
  $('draftHeader').style.display = lobby ? 'none' : 'flex';
  $('sessionLabel').textContent = mode === 'replay' ? 'Replay' : mode === 'local' ? 'Same-screen practice' : `Online draft · You are ${localSide()}`;
  $('roomBadge').textContent = room ? `ROOM ${room}` : 'LOCAL';
  const showCopy = !!room && mode !== 'local';
  const connecting = netPhase === 'waking' || netPhase === 'opening';
  $('copyLink').hidden = !showCopy;
  $('copyLinkDraft').hidden = !showCopy;
  $('cancelRoom').hidden = !(lobby && (showCopy || (connecting && mode !== 'local')));
  $('reconnectBtn').hidden = mode === 'local' || mode === 'replay' || connected || lobby;
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
  renderReplay();
  renderAssist();
  tick(false);
}
function tick(allowTimeout = true) {
  if (!mounted()) return;
  if (mode === 'replay') { $('clock').textContent = String(replayStep).padStart(2, '0'); return; }
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
    noteAssist(last);
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
  stopReplayTimer();
  replayRecord = null;
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
  previousDraftId = '';
  armedRole = null;
  roleSeeded.Order = false;
  roleSeeded.Chaos = false;
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
    for (const type of ['pick', 'ban']) lines.push(`${type.toUpperCase()}S: ` + state.actions.filter(a => a.side === side && a.type === type).map(a => {
      if (!a.god) return '[timeout pass]';
      let name = byId[a.god].name;
      if (a.aspect && byId[a.god].aspect) name += ' (' + byId[a.god].aspect.name + ')';
      if (type === 'pick' && a.role) name += ' [' + roleLabel(a.role) + (a.roleConfirmed ? '' : ', suggested') + ']';
      return name;
    }).join(', '));
    lines.push('JSON: ' + JSON.stringify({
      format: state.config.format,
      names: state.names,
      picks: state.actions.filter(a => a.type === 'pick').map(a => ({ side: a.side, god: a.god, role: a.role || '', suggested: !!(a.role && !a.roleConfirmed) }))
    }));
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
function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
function rememberHistory(entry, replaceId) {
  const list = loadHistory().filter(item => item.id !== entry.id && item.id !== replaceId);
  list.unshift(entry);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 40))); } catch { /* ignore */ }
}
function loadPlans() { try { const list = JSON.parse(localStorage.getItem(PLANS_KEY) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } }
function savePlans(list) { try { localStorage.setItem(PLANS_KEY, JSON.stringify(list)); } catch { /* ignore */ } }
function assistedSide() { return mode === 'host' ? 'Order' : mode === 'guest' ? 'Chaos' : assistSide; }
function noteAssist(action) {
  const plan = loadPlans().find(item => item.id === assistPlanId);
  if (!plan || !action) return;
  const ourPicks = state.actions.filter(a => a.side === assistedSide() && a.type === 'pick' && a.god).map(a => a.god);
  const advice = DraftCodec.advise(plan, [...E.used(state)], action, assistedSide(), gods, ourPicks);
  if (!advice.alert) return;
  toast(advice.alert.text);
  play('alert');
  if (document.hidden) flashTitle('Priority shifted · Crystal Draft');
}
function replayState(record, step) {
  let next = E.create({ format: record.format, timeout: 'skip' });
  next.names = { Order: record.names.Order, Chaos: record.names.Chaos };
  const origin = Date.parse(record.date) || Date.UTC(2026, 0, 1);
  next = E.apply(next, { type: 'start' }, gods, origin);
  const count = Math.max(0, Math.min(step, record.gods.length));
  for (let i = 0; i < count; i++) {
    const turn = E.current(next);
    const god = record.gods[i];
    next = E.apply(next, { type: 'commit', side: turn.side, god: god, timeout: god == null, rev: next.rev }, gods, next.deadline || origin);
    if (record.aspects && record.aspects[i] && turn.type === 'pick' && god) {
      next = E.apply(next, { type: 'aspect', side: turn.side, god: god, on: true }, gods, next.deadline || origin);
    }
    const assigned = record.roles && record.roles[i];
    if (assigned && assigned.role && turn.type === 'pick') {
      const placed = next.actions[next.actions.length - 1];
      placed.role = assigned.role;
      placed.roleConfirmed = !!assigned.confirmed;
    }
  }
  return next;
}
function toggleAspect(side, godId) {
  if (!canToggleAspect(side)) { toast('Only that team can change this aspect.'); return; }
  const pick = state.actions.find(a => a.type === 'pick' && a.side === side && a.god === godId);
  if (!pick || !byId[godId]?.aspect) return;
  const action = { type: 'aspect', side: side, god: godId, on: !pick.aspect };
  if (mode === 'local') {
    try { state = E.apply(state, action, gods); }
    catch (error) { toast(error.message); return; }
    render();
    return;
  }
  if (!connected) return toast('Reconnect before changing an aspect.');
  send({ type: 'action', action: action });
}
function stopReplayTimer() { if (replayTimer) { clearInterval(replayTimer); replayTimer = null; } }
function showReplayFrame(step, withSound) {
  if (!replayRecord) return;
  const previous = state.actions.length;
  replayStep = Math.max(0, Math.min(step, replayRecord.gods.length));
  state = replayState(replayRecord, replayStep);
  if (withSound && state.actions.length === previous + 1) play(state.actions.at(-1).type === 'ban' ? 'ban' : 'pick');
  render();
}
function startReplay(code) {
  let record;
  try { record = DraftCodec.decodeDraft(DraftCodec.extractReplayCode(code), gods.map(g => g.id)); }
  catch (error) { toast(error.message); return; }
  stopReplayTimer();
  replayRecord = record;
  mode = 'replay';
  room = '';
  connected = false;
  mySide = null;
  selected = null;
  preview = null;
  $('summaryModal').hidden = true;
  $('historyModal').hidden = true;
  showReplayFrame(0, false);
  toast('Replay ready. ' + record.names.Order + ' vs ' + record.names.Chaos + '.');
}
function renderReplay() {
  $('replayBar').hidden = mode !== 'replay';
  if (mode !== 'replay' || !replayRecord) return;
  $('replayScrub').max = String(replayRecord.gods.length);
  $('replayScrub').value = String(replayStep);
  $('replayStep').textContent = replayStep + ' / ' + replayRecord.gods.length;
  $('replayPlay').textContent = replayTimer ? 'Pause' : 'Play';
}
function renderHistory() {
  const list = loadHistory();
  $('historyList').innerHTML = list.length ? list.map(item => `<div class="history-row"><div><strong>${esc(item.names.Order)} vs ${esc(item.names.Chaos)}</strong><div class="muted">${esc(item.format)} · ${esc(item.date)}</div><div class="muted">${esc(historyRoles(item.id))}</div><code>${esc(item.id)}</code></div><div class="plan-tools"><button type="button" data-copy-draft="${esc(item.id)}">Copy</button><button type="button" data-watch="${esc(item.id)}">Replay</button><button type="button" data-forget="${esc(item.id)}">Delete</button></div></div>`).join('') : '<p class="muted">Finished drafts are listed here with their IDs.</p>';
  renderRoleStats();
}
function historyRoles(id) {
  try {
    const record = DraftCodec.decodeDraft(id, gods.map(g => g.id));
    const steps = DraftCodec.orderedActions(record, E.DRAFT_ORDERS);
    return ['Order', 'Chaos'].map(side => side + ' ' + steps.filter(step => step.side === side && step.type === 'pick').map(step => {
      const name = step.god ? (byId[step.god] ? byId[step.god].name : step.god) : 'Pass';
      return step.role ? name + ' ' + roleLabel(step.role) + (step.roleConfirmed ? '' : ' ?') : name;
    }).join(', ')).join(' · ');
  } catch { return ''; }
}
function roleTallies() {
  const tally = {};
  DraftCodec.ROLES.forEach(role => { tally[role] = {}; });
  loadHistory().forEach(item => {
    let record;
    try { record = DraftCodec.decodeDraft(item.id, gods.map(g => g.id)); }
    catch { return; }
    DraftCodec.orderedActions(record, E.DRAFT_ORDERS).forEach(step => {
      if (step.type !== 'pick' || !step.god || !step.role || !tally[step.role]) return;
      const row = tally[step.role][step.god] || { total: 0, Order: 0, Chaos: 0 };
      row.total += 1;
      row[step.side] += 1;
      tally[step.role][step.god] = row;
    });
  });
  return tally;
}
function renderRoleStats() {
  const box = $('roleStats');
  if (!box) return;
  box.hidden = !showRoleStats;
  if (!showRoleStats) return;
  const tally = roleTallies();
  const plans = loadPlans();
  const body = DraftCodec.ROLES.map(role => {
    const rows = Object.entries(tally[role]).sort((a, b) => b[1].total - a[1].total);
    const lines = rows.length ? rows.map(([id, row]) => `<p>${esc(byId[id] ? byId[id].name : id)} · ${row.total} <span class="muted">Order ${row.Order} · Chaos ${row.Chaos}</span></p>`).join('') : '<p class="muted">No assigned picks yet.</p>';
    return `<h3>${esc(roleLabel(role))}</h3>${lines}`;
  }).join('');
  box.innerHTML = body + `<div class="plan-tools"><label class="muted">Plan <select id="statsPlan">${plans.map(plan => `<option value="${esc(plan.id)}">${esc(plan.name)}</option>`).join('')}<option value="">New plan from stats</option></select></label><button type="button" id="statsMerge">Merge into plan</button></div>`;
}
function mergeStatsIntoPlan() {
  const tally = roleTallies();
  const selected = $('statsPlan') ? $('statsPlan').value : '';
  const existing = selected ? loadPlans().find(plan => plan.id === selected) : null;
  const plan = existing ? adoptPlan(existing) : blankPlan();
  if (!existing) plan.name = 'Role stats';
  DraftCodec.ROLES.forEach(role => {
    const ranked = Object.entries(tally[role]).sort((a, b) => b[1].total - a[1].total).map(([id]) => id);
    const have = plan.roles[role] || [];
    ranked.forEach(id => { if (!have.includes(id) && have.length < DraftCodec.PLAN_LIMIT) have.push(id); });
    plan.roles[role] = have;
  });
  const list = loadPlans().filter(item => item.id !== plan.id);
  list.unshift(plan);
  savePlans(list);
  editingPlan = plan;
  toast(existing ? 'Role stats merged into ' + plan.name + '.' : 'Saved a plan from role stats.');
  renderRoleStats();
}
function copyText(text, okMessage) {
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast(okMessage), () => toast(text));
  else toast(text);
}
function previewGod(id) {
  if (!byId[id] || E.used(state).has(id) || state.phase !== 'draft') return;
  unlockAudio();
  selected = id;
  showPreview(id);
  renderGrid();
  const turn = E.current(state);
  $('lockBtn').disabled = !canAct();
  $('lockBtn').textContent = `${turn?.type === 'ban' ? 'Ban' : 'Pick'} ${byId[id].name}`;
}
let editingPlan = null;
let planTab = 'Solo';
let compTarget = null;
const PLAN_TABS = ['Solo', 'Jungle', 'Mid', 'Support', 'Carry', 'Bans'];
function roleLabel(role) { return DraftCodec.ROLE_LABELS[role] || (role === 'Bans' ? 'Bans' : role); }
function roleIcon(tab) {
  const paths = {
    Solo: 'M8 1.5v9M5.5 4.5h5M6.2 13.5h3.6',
    Jungle: 'M3 13C6 11 8 7 13 2 9 4 6 8 3 13z',
    Mid: 'M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.8 3.8l2 2M10.2 10.2l2 2M12.2 3.8l-2 2M5.8 10.2l-2 2',
    Support: 'M8 1.5l5 2v4.2c0 3.2-2.1 5.4-5 6.6-2.9-1.2-5-3.4-5-6.6V3.5z',
    Carry: 'M3 12.5C6.5 11 9.5 8 12.5 4M3.5 13.5c2.2-2.6 5-4.6 9-5.4M3 12.5l1.8 1.8',
    Bans: 'M3.5 3.5l9 9M12.5 3.5l-9 9'
  };
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${paths[tab] || ''}"/></svg>`;
}
function blankPlan() {
  return DraftCodec.normalizePlan({ id: 'plan-' + Math.random().toString(36).slice(2, 10), name: 'New plan', roles: {}, bans: [], comps: [] }, gods);
}
function adoptPlan(plan) {
  const next = DraftCodec.normalizePlan(plan, gods);
  if (!next.id) next.id = blankPlan().id;
  return next;
}
function rememberPlanName() {
  if (!editingPlan || !$('planName')) return;
  editingPlan.name = $('planName').value.trim().slice(0, 32) || 'Plan';
}
function currentPlanList() {
  return planTab === 'Bans' ? editingPlan.bans : editingPlan.roles[planTab];
}
function renderPlanEditor() {
  const plans = loadPlans();
  $('planList').innerHTML = plans.map(plan => `<option value="${esc(plan.id)}">${esc(plan.name)}</option>`).join('') || '<option value="">No saved plans</option>';
  if (!editingPlan && plans[0]) editingPlan = adoptPlan(plans[0]);
  if (!editingPlan) editingPlan = blankPlan();
  if (plans.some(plan => plan.id === editingPlan.id)) $('planList').value = editingPlan.id;
  $('planName').value = editingPlan.name || '';
  $('planTabs').innerHTML = PLAN_TABS.map(tab => `<button type="button" data-plan-tab="${tab}" class="${tab === planTab ? 'active' : ''}" aria-pressed="${tab === planTab}">${roleIcon(tab)}${roleLabel(tab)}</button>`).join('');
  const list = currentPlanList();
  $('planCount').textContent = `${roleLabel(planTab)} ${list.length}/${DraftCodec.PLAN_LIMIT}`;
  $('planPriority').innerHTML = list.length ? list.map((id, index) => {
    const god = byId[id];
    if (!god) return '';
    return `<div class="prio" draggable="true" data-index="${index}" data-id="${esc(id)}">${picture(god)}<span class="rank">${index + 1}</span><button type="button" class="x" data-remove="${index}" aria-label="Remove ${esc(god.name)}">×</button><span class="nudge"><button type="button" data-up="${index}" aria-label="Move ${esc(god.name)} up">↑</button><button type="button" data-down="${index}" aria-label="Move ${esc(god.name)} down">↓</button></span></div>`;
  }).join('') : '<p class="muted">Click portraits to build this list. Drag a portrait, or use the arrows, to reorder it.</p>';
  $('planOverview').innerHTML = DraftCodec.ROLES.map(role => {
    const faces = (editingPlan.roles[role] || []).map(id => byId[id] ? picture(byId[id]) : '').join('');
    return `<div class="ov"><b>${roleLabel(role)}</b><div class="faces">${faces || '<span class="muted">—</span>'}</div></div>`;
  }).join('');
  const term = $('planGodSearch').value.trim().toLowerCase();
  const klass = $('planClass').value;
  const shown = gods.filter(g => (!term || g.name.toLowerCase().includes(term)) && (!klass || g.class === klass));
  $('planGrid').innerHTML = shown.map(g => {
    const on = list.includes(g.id);
    const elsewhere = planTab === 'Bans'
      ? DraftCodec.ROLES.filter(role => editingPlan.roles[role].includes(g.id))
      : DraftCodec.ROLES.filter(role => role !== planTab && editingPlan.roles[role].includes(g.id));
    const badge = elsewhere.length ? `<span class="role-badge">${esc(elsewhere.map(roleLabel).join(' '))}</span>` : '';
    return `<button type="button" class="god ${on ? 'on' : ''}" data-plan-add="${g.id}" aria-pressed="${on}" aria-label="${esc(g.name)}">${picture(g, 'loading="lazy"')}<span>${esc(g.name)}</span>${badge}</button>`;
  }).join('') || '<div class="empty-grid">No gods match these filters.</div>';
  $('planComps').innerHTML = (editingPlan.comps || []).map((comp, index) => {
    const slots = ['Solo', 'Jungle', 'Mid', 'Support', 'Carry'].map(role => {
      const roleIndex = DraftCodec.ROLES.indexOf(role);
      const id = comp.gods[roleIndex];
      const armed = compTarget && compTarget.index === index && compTarget.roleIndex === roleIndex;
      const god = id && byId[id];
      return `<button type="button" class="comp-slot ${armed ? 'armed' : ''}" data-comp-slot="${index}:${roleIndex}" aria-label="${roleLabel(role)} for ${esc(comp.name || 'comp')}">${god ? picture(god) : roleLabel(role)}</button>`;
    }).join('');
    return `<div class="comp-row" data-comp="${index}"><input class="comp-name" value="${esc(comp.name || 'Comp')}" aria-label="Comp name" maxlength="32">${slots}<button type="button" data-comp-remove="${index}">Remove</button></div>`;
  }).join('');
  $('planHint').textContent = compTarget
    ? `Choosing ${roleLabel(DraftCodec.ROLES[compTarget.roleIndex])} for ${editingPlan.comps[compTarget.index]?.name || 'this comp'}. Click a portrait.`
    : 'One portrait per role. Click a slot, then a portrait.';
}
function movePlanItem(from, to) {
  const list = currentPlanList();
  if (to < 0 || to >= list.length || from === to) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  renderPlanEditor();
}
function togglePlanGod(id) {
  rememberPlanName();
  if (compTarget) {
    const comp = editingPlan.comps[compTarget.index];
    if (comp) comp.gods[compTarget.roleIndex] = comp.gods[compTarget.roleIndex] === id ? '' : id;
    compTarget = null;
    renderPlanEditor();
    return;
  }
  const list = currentPlanList();
  const at = list.indexOf(id);
  if (at >= 0) list.splice(at, 1);
  else if (list.length >= DraftCodec.PLAN_LIMIT) {
    toast(roleLabel(planTab) + ' already has ' + DraftCodec.PLAN_LIMIT + ' gods.');
    return;
  } else list.push(id);
  renderPlanEditor();
}
function renderAssist() {
  const show = mode !== 'replay' && ['draft', 'paused', 'summary'].includes(state.phase);
  $('assist').hidden = !show;
  if (!show) return;
  const plans = loadPlans();
  $('assistPlan').innerHTML = '<option value="">No plan attached</option>' + plans.map(plan => `<option value="${esc(plan.id)}">${esc(plan.name)}</option>`).join('');
  if (plans.some(plan => plan.id === assistPlanId)) $('assistPlan').value = assistPlanId;
  else assistPlanId = $('assistPlan').value || '';
  $('assistSide').hidden = mode !== 'local';
  if (mode === 'local') $('assistSide').value = assistSide;
  const plan = plans.find(item => item.id === assistPlanId);
  if (!plan) {
    $('assistBody').innerHTML = '<p class="muted">Attach a plan to see the next god for each role. It stays on this screen and is not sent to your rival.</p>';
    return;
  }
  const ourPicks = state.actions.filter(a => a.side === assistedSide() && a.type === 'pick' && a.god).map(a => a.god);
  const advice = DraftCodec.advise(plan, [...E.used(state)], null, assistedSide(), gods, ourPicks);
  const face = item => {
    const god = byId[item.id];
    if (!god) return '';
    return `<button type="button" class="${item.out ? 'out' : ''}" data-suggest="${esc(item.id)}" ${item.out ? 'disabled' : ''} aria-label="${esc(god.name)}">${picture(god)}<span class="sr">${esc(god.name)}</span></button>`;
  };
  const roles = advice.roles.map(role => `<div class="assist-role" id="role${role.role}"><b>${esc(role.label)}</b>${role.next ? `<button type="button" id="suggest-${role.role}" data-suggest="${esc(role.next)}">Next: ${esc(byId[role.next].name)}</button>` : '<span class="muted">No priority left</span>'}<div class="faces">${role.list.map(face).join('')}</div></div>`).join('');
  const banFaces = advice.bans.map(face).join('');
  const comps = advice.comps.map(comp => `<div class="comp ${comp.broken ? 'broken' : comp.possible ? 'possible' : ''}"><strong>${esc(comp.name)}</strong> · ${comp.broken ? 'Broken' : comp.possible ? 'Still possible' : 'Incomplete'}<div>${comp.gods.map(g => `${esc(g.label)} ${g.out ? '<s>' + esc(g.name) + '</s>' : esc(g.name)}`).join(' · ')}</div></div>`).join('');
  $('assistBody').innerHTML = `<div class="row"><button type="button" id="suggestBan" data-suggest="${esc(advice.nextBan || '')}" ${advice.nextBan ? '' : 'disabled'}>Next ban: ${advice.nextBan ? esc(byId[advice.nextBan].name) : '—'}</button></div><p class="needed">Still needed: ${advice.needed.length ? esc(advice.needed.join(' · ')) : 'every planned role has a pick'}</p><div class="assist-roles">${roles}<div class="assist-role" id="roleBans"><b>Bans</b><div class="faces">${banFaces || '<span class="muted">None</span>'}</div></div></div>${comps}`;
}

$('historyBtn').onclick = () => { renderHistory(); $('historyModal').hidden = false; };
$('closeHistory').onclick = () => { $('historyModal').hidden = true; };
$('roleStatsBtn').onclick = () => { showRoleStats = !showRoleStats; renderHistory(); };
document.addEventListener('click', event => {
  if (event.target.closest('.aspect-btn')) return;
  const chip = event.target.closest('.role-chip');
  if (chip && !chip.disabled) {
    const next = { side: chip.dataset.side, role: chip.dataset.role };
    armedRole = armedRole && armedRole.side === next.side && armedRole.role === next.role ? null : next;
    render();
    return;
  }
  const pick = event.target.closest('[data-role-pick]');
  if (!pick || !armedRole || armedRole.side !== pick.dataset.roleSide) return;
  const side = pick.dataset.roleSide;
  const role = armedRole.role;
  armedRole = null;
  dropRole(side, Number(pick.dataset.rolePick), role);
});
document.addEventListener('dragstart', event => {
  const chip = event.target.closest('.role-chip');
  if (!chip || chip.disabled || !event.dataTransfer) return;
  event.dataTransfer.setData('text/plain', chip.dataset.side + ':' + chip.dataset.role);
  event.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', event => {
  if (event.target.closest('[data-role-pick]')) event.preventDefault();
});
document.addEventListener('drop', event => {
  const pick = event.target.closest('[data-role-pick]');
  if (!pick || !event.dataTransfer) return;
  const parts = event.dataTransfer.getData('text/plain').split(':');
  if (parts[0] !== pick.dataset.roleSide) return;
  event.preventDefault();
  dropRole(parts[0], Number(pick.dataset.rolePick), parts[1]);
});
document.addEventListener('click', event => {
  if (event.target && event.target.id === 'statsMerge') mergeStatsIntoPlan();
});
$('historyList').onclick = event => {
  const copy = event.target.closest('[data-copy-draft]');
  const watch = event.target.closest('[data-watch]');
  const forget = event.target.closest('[data-forget]');
  if (copy) copyText(copy.dataset.copyDraft, 'Draft ID copied.');
  if (watch) startReplay(watch.dataset.watch);
  if (forget) {
    const list = loadHistory().filter(item => item.id !== forget.dataset.forget);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* ignore */ }
    renderHistory();
  }
};
$('loadReplayBtn').onclick = () => startReplay($('replayPaste').value);
$('plansBtn').onclick = () => { renderPlanEditor(); $('plansModal').hidden = false; };
$('closePlans').onclick = () => { $('plansModal').hidden = true; compTarget = null; };
$('planList').onchange = () => { editingPlan = adoptPlan(loadPlans().find(plan => plan.id === $('planList').value) || blankPlan()); compTarget = null; renderPlanEditor(); };
$('planNew').onclick = () => { editingPlan = blankPlan(); compTarget = null; planTab = 'Solo'; renderPlanEditor(); };
$('planSave').onclick = () => {
  rememberPlanName();
  const plan = adoptPlan(editingPlan);
  const list = loadPlans().filter(item => item.id !== plan.id);
  list.unshift(plan);
  savePlans(list);
  editingPlan = plan;
  renderPlanEditor();
  toast('Plan saved on this browser.');
};
$('planDelete').onclick = () => {
  if (!editingPlan) return;
  savePlans(loadPlans().filter(plan => plan.id !== editingPlan.id));
  editingPlan = null;
  compTarget = null;
  renderPlanEditor();
};
$('planCopy').onclick = () => {
  rememberPlanName();
  copyText(DraftCodec.encodePlan(adoptPlan(editingPlan), gods.map(g => g.id)), 'Plan code copied.');
};
$('planCodeLoad').onclick = () => {
  try {
    editingPlan = adoptPlan(DraftCodec.decodePlan($('planCodePaste').value, gods.map(g => g.id)));
    compTarget = null;
    renderPlanEditor();
    toast('Plan code loaded. Save it to keep it in the list.');
  } catch (error) { toast(error.message); }
};
$('planExport').onclick = () => {
  const blob = new Blob([JSON.stringify({ crystalPlans: 2, plans: loadPlans().map(plan => adoptPlan(plan)) }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'crystal-draft-plans.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('planImportBtn').onclick = () => $('planImportFile').click();
$('planImportFile').onchange = () => {
  const file = $('planImportFile').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const plans = Array.isArray(data.plans) ? data.plans : Array.isArray(data) ? data : [];
      savePlans(plans.filter(plan => plan && plan.name && (plan.roles || plan.picks || plan.bans || plan.comps)).map(plan => adoptPlan(plan)));
      editingPlan = null;
      renderPlanEditor();
      toast('Plans imported.');
    } catch { toast('That file is not a plan list.'); }
  };
  reader.readAsText(file);
};
$('planGodSearch').addEventListener('input', () => { rememberPlanName(); renderPlanEditor(); });
$('planClass').addEventListener('change', () => { rememberPlanName(); renderPlanEditor(); });
[...new Set(gods.map(g => g.class).filter(Boolean))].sort().forEach(name => {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = name;
  $('planClass').appendChild(option);
});
$('planTabs').onclick = event => {
  const tab = event.target.closest('[data-plan-tab]');
  if (!tab) return;
  rememberPlanName();
  planTab = tab.dataset.planTab;
  compTarget = null;
  renderPlanEditor();
};
$('planGrid').onclick = event => {
  const button = event.target.closest('[data-plan-add]');
  if (!button) return;
  togglePlanGod(button.dataset.planAdd);
};
$('planPriority').onclick = event => {
  const remove = event.target.closest('[data-remove]');
  const up = event.target.closest('[data-up]');
  const down = event.target.closest('[data-down]');
  if (!remove && !up && !down) return;
  rememberPlanName();
  const index = Number((remove || up || down).dataset.remove || (up || down).dataset.up || down.dataset.down);
  if (remove) currentPlanList().splice(index, 1);
  if (up) movePlanItem(index, index - 1);
  if (down) movePlanItem(index, index + 1);
  if (remove) renderPlanEditor();
};
let planDragIndex = null;
$('planPriority').addEventListener('dragstart', event => {
  const card = event.target.closest('[data-index]');
  if (!card) return;
  planDragIndex = Number(card.dataset.index);
  event.dataTransfer?.setData('text/plain', String(planDragIndex));
});
$('planPriority').addEventListener('dragover', event => { if (planDragIndex != null) event.preventDefault(); });
$('planPriority').addEventListener('drop', event => {
  const card = event.target.closest('[data-index]');
  if (planDragIndex == null || !card) return;
  event.preventDefault();
  rememberPlanName();
  movePlanItem(planDragIndex, Number(card.dataset.index));
  planDragIndex = null;
});
$('planAddComp').onclick = () => {
  rememberPlanName();
  editingPlan.comps.push({ name: 'Comp ' + (editingPlan.comps.length + 1), gods: ['', '', '', '', ''] });
  renderPlanEditor();
};
$('planComps').addEventListener('input', event => {
  const row = event.target.closest('[data-comp]');
  if (!row || !event.target.classList.contains('comp-name')) return;
  editingPlan.comps[Number(row.dataset.comp)].name = event.target.value.slice(0, 32);
});
$('planComps').onclick = event => {
  const remove = event.target.closest('[data-comp-remove]');
  const slot = event.target.closest('[data-comp-slot]');
  if (remove) {
    rememberPlanName();
    editingPlan.comps.splice(Number(remove.dataset.compRemove), 1);
    compTarget = null;
    renderPlanEditor();
    return;
  }
  if (!slot) return;
  const [index, roleIndex] = slot.dataset.compSlot.split(':').map(Number);
  compTarget = compTarget && compTarget.index === index && compTarget.roleIndex === roleIndex ? null : { index, roleIndex };
  renderPlanEditor();
};
$('assistPlan').onchange = () => { assistPlanId = $('assistPlan').value; renderAssist(); };
$('assistSide').onchange = () => { assistSide = $('assistSide').value; renderAssist(); };
$('assist').onclick = event => {
  const button = event.target.closest('[data-suggest]');
  if (!button || !button.dataset.suggest) return;
  previewGod(button.dataset.suggest);
};
$('replayBack').onclick = () => { stopReplayTimer(); showReplayFrame(replayStep - 1, false); };
$('replayFwd').onclick = () => { stopReplayTimer(); showReplayFrame(replayStep + 1, true); };
$('replayScrub').oninput = () => { stopReplayTimer(); showReplayFrame(Number($('replayScrub').value), false); };
$('replayPlay').onclick = () => {
  if (replayTimer) { stopReplayTimer(); renderReplay(); return; }
  if (replayStep >= replayRecord.gods.length) showReplayFrame(0, false);
  const speed = Number($('replaySpeed').value) || 1;
  replayTimer = setInterval(() => {
    if (replayStep >= replayRecord.gods.length) { stopReplayTimer(); renderReplay(); return; }
    showReplayFrame(replayStep + 1, true);
  }, Math.round(900 / speed));
  renderReplay();
};
$('replayExit').onclick = () => { stopReplayTimer(); replayRecord = null; mode = 'local'; state = E.create(); selected = null; preview = null; setTab('local'); render(); };
$('copyDraftId').onclick = () => { if (currentDraftId) copyText(location.origin && location.protocol !== 'file:' ? location.href.split('?')[0].split('#')[0] + '?replay=' + encodeURIComponent(currentDraftId) : currentDraftId, 'Replay link copied.'); };
$('replayThis').onclick = () => { if (currentDraftId) startReplay(currentDraftId); };
document.addEventListener('keydown', event => { if (event.key === 'Escape') { $('historyModal').hidden = true; $('plansModal').hidden = true; } });
document.addEventListener('click', event => {
  const button = event.target.closest('[data-aspect]');
  if (!button || button.disabled) return;
  event.preventDefault();
  toggleAspect(button.dataset.side, button.dataset.aspect);
});

function boot() {
  const replayQuery = new URLSearchParams(location.search).get('replay');
  if (replayQuery) { startReplay(replayQuery); prewarm(); return; }
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
  roomServer: ROOM_SERVER,
  codec: DraftCodec
};
})();
