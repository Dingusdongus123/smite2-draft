'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { JSDOM, VirtualConsole } = require('jsdom');
const { WebSocket } = require('ws');
const { createApp } = require('./server/server');
const E = require('./src/engine');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const roster = JSON.parse(fs.readFileSync(__dirname + '/src/gods.json', 'utf8'));
let checks = 0;
const failures = [];
function ok(condition, label) {
  assert.ok(condition, label);
  checks += 1;
  console.log('PASS', label);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function dom(extra = {}) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => failures.push(String(error && error.message || error)));
  const intervals = [];
  const d = new JSDOM(html, {
    url: extra.url || 'https://prototype.invalid/index.html',
    runScripts: 'dangerously',
    virtualConsole: vc,
    beforeParse(w) {
      w.confirm = () => true;
      w.CRYSTAL_ROOM_SERVER = extra.server || serverUrl;
      if (extra.budget) w.CRYSTAL_CONNECT_BUDGET_MS = extra.budget;
      if (extra.retry) w.CRYSTAL_RETRY_DELAY_MS = extra.retry;
      if (extra.attempt) w.CRYSTAL_ATTEMPT_MS = extra.attempt;
      if (extra.sound) w.localStorage.setItem('crystal-draft-sound', '1');
      if (extra.seat) w.sessionStorage.setItem('crystal-seat', extra.seat);
      w.setInterval = fn => { intervals.push(fn); return intervals.length; };
      w.clearInterval = () => {};
      w.fetch = globalThis.fetch.bind(globalThis);
      w.WebSocket = globalThis.WebSocket;
    }
  });
  d.intervals = intervals;
  return d;
}
function el(d, id) { return d.window.document.getElementById(id); }
function click(d, id) { el(d, id).click(); }
function set(d, id, value) {
  el(d, id).value = value;
  el(d, id).dispatchEvent(new d.window.Event('input', { bubbles: true }));
}
function get(d) { return d.window.CrystalDraft.getState(); }
function sounds(d) { return d.window.CrystalDraft.playedSounds(); }
function enableSound(d) {
  const box = el(d, 'soundEffects');
  if (!box.checked) box.click();
}
function choose(d) {
  const button = d.window.document.querySelector('.god:not(:disabled)');
  assert.ok(button, 'an available god');
  button.click();
  click(d, 'lockBtn');
}
async function waitFor(fn, ms, label) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return;
    await sleep(15);
  }
  throw new Error('timeout: ' + label);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('connect timeout')); }, 4000);
    ws.once('open', () => { clearTimeout(timer); resolve(ws); });
    ws.once('error', error => { clearTimeout(timer); reject(error); });
  });
}
function once(ws, pred, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('timeout waiting for socket message'));
    }, timeout);
    function onMsg(data) {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (pred(message)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(message);
      }
    }
    ws.on('message', onMsg);
  });
}
function track(ws) {
  const states = [];
  const notices = [];
  ws.on('message', data => {
    let message;
    try { message = JSON.parse(data.toString()); } catch { return; }
    if (message.type === 'state' && message.state) states.push(message.state);
    if (message.type === 'welcome' && message.state) states.push(message.state);
    if (message.type === 'notice') notices.push(message.message);
    if (message.type === 'rejected') notices.push(message.message);
  });
  return { states, notices, latest() { return states[states.length - 1]; } };
}
const config = { format: 'standard', pickSeconds: 40, banSeconds: 18, bankSeconds: 90, timeout: 'skip' };

async function listen(app) {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  return { port, url: `ws://127.0.0.1:${port}` };
}

let serverUrl = 'ws://127.0.0.1:9';
let app;

function unit() {
  let s = E.create({ format: 'extended', bankSeconds: 20 });
  s = E.apply(s, { type: 'start' }, roster, 100000);
  ok(E.current(s).side === 'Order', 'Order opens bans');
  assert.throws(() => E.apply(s, { type: 'commit', side: 'Chaos', god: roster[0].id }, roster, 101000));
  checks += 1;
  const deadline = s.deadline;
  s = E.apply(s, { type: 'commit', side: 'Order', god: roster[0].id }, roster, deadline + 5000);
  ok(s.bank.Order === 15, 'Overtime spends the acting team bank');
  assert.throws(() => E.apply(s, { type: 'commit', side: 'Chaos', god: roster[0].id }, roster, 120000));
  checks += 1;
  assert.throws(() => E.apply(s, { type: 'commit', side: 'Chaos', god: roster[1].id, rev: 0 }, roster, 120000));
  checks += 1;
  const before = s.actions.length;
  s = E.apply(s, { type: 'pause' }, roster, 120000);
  ok(s.phase === 'paused', 'Pause transition');
  assert.throws(() => E.apply(s, { type: 'commit', side: 'Chaos', god: roster[1].id }, roster, 120000));
  checks += 1;
  s = E.apply(s, { type: 'resume' }, roster, 140000);
  s = E.apply(s, { type: 'undo' }, roster, 140001);
  ok(s.actions.length === before - 1 && s.bank.Order === 20, 'Undo restores bans and bank');
  s = E.apply(s, { type: 'commit', side: 'Order', god: null, timeout: true }, roster, 140002);
  ok(s.actions[0].god === null, 'Timeout pass supported');
  ok(E.DRAFT_ORDERS.standard.length === 16 && E.DRAFT_ORDERS.extended.length === 20, 'Draft order lengths unchanged');
  let draft = E.create({ timeout: 'skip' });
  draft = E.apply(draft, { type: 'start' }, roster, 1);
  const aspectGod = roster.find(g => g.aspect);
  const fillers = roster.filter(g => g.id !== aspectGod.id);
  for (let i = 0; i < 6; i++) {
    const turn = E.current(draft);
    draft = E.apply(draft, { type: 'commit', side: turn.side, god: fillers[i].id, rev: draft.rev }, roster, 2);
  }
  const pickTurn = E.current(draft);
  draft = E.apply(draft, { type: 'commit', side: pickTurn.side, god: aspectGod.id, rev: draft.rev }, roster, 3);
  const later = E.current(draft);
  draft = E.apply(draft, { type: 'commit', side: later.side, god: fillers[6].id, rev: draft.rev }, roster, 4);
  draft = E.apply(draft, { type: 'aspect', side: pickTurn.side, god: aspectGod.id, on: true }, roster, 5);
  ok(draft.actions.find(a => a.type === 'pick' && a.god === aspectGod.id).aspect === true, 'An aspect can be turned on for a pick');
  const other = pickTurn.side === 'Order' ? 'Chaos' : 'Order';
  assert.throws(() => E.apply(draft, { type: 'aspect', side: other, god: aspectGod.id, on: true }, roster, 6));
  checks += 1;
  console.log('PASS', 'The other team cannot mark that pick');
  draft = E.apply(draft, { type: 'undo' }, roster, 7);
  ok(draft.actions.find(a => a.type === 'pick' && a.god === aspectGod.id).aspect === true, 'Undo keeps an aspect on a pick that remains');
  draft = E.apply(draft, { type: 'aspect', side: pickTurn.side, god: aspectGod.id, on: false }, roster, 8);
  ok(draft.actions.find(a => a.type === 'pick' && a.god === aspectGod.id).aspect === false, 'An aspect can be turned off');
  while (draft.phase === 'draft') {
    const turn = E.current(draft);
    const god = roster.find(g => !draft.actions.some(a => a.god === g.id)).id;
    draft = E.apply(draft, { type: 'commit', side: turn.side, god, rev: draft.rev }, roster, 9);
  }
  draft = E.apply(draft, { type: 'roles', side: 'Order', roles: [
    { role: 'Solo', confirmed: true }, { role: 'Jungle', confirmed: true }, { role: 'Mid', confirmed: false },
    { role: 'Carry', confirmed: true }, { role: 'Support', confirmed: true }
  ] }, roster, 10);
  const orderPicks = draft.actions.filter(a => a.side === 'Order' && a.type === 'pick');
  ok(orderPicks[0].role === 'Solo' && orderPicks[0].roleConfirmed === true && orderPicks[2].role === 'Mid' && orderPicks[2].roleConfirmed === false, 'A team can assign roles after the draft');
  assert.throws(() => E.apply(draft, { type: 'roles', side: 'Order', roles: [
    { role: 'Solo', confirmed: true }, { role: 'Solo', confirmed: true }, { role: 'Mid', confirmed: true },
    { role: 'Carry', confirmed: true }, { role: 'Support', confirmed: true }
  ] }, roster, 11));
  checks += 1;
  console.log('PASS', 'A role cannot be used twice on one team');
  const second = E.DRAFT_ORDERS.extended.slice(12, 16).map(turn => turn.type + turn.side[0]).join(',');
  ok(E.DRAFT_ORDERS.extended.filter(turn => turn.type === 'ban').length === 10 && second === 'banC,banO,banC,banO', 'Extended second phase is four bans, Chaos first');
  let lobby = E.create();
  lobby = E.apply(lobby, { type: 'clock', config: { pickSeconds: 15, banSeconds: 0, bankSeconds: 30, timeout: 'skip' } }, roster, 1);
  ok(lobby.phase === 'lobby' && lobby.config.pickSeconds === 15 && lobby.config.banSeconds === 0 && lobby.bank.Chaos === 30, 'The host can set the clock before the draft');
  let quiet = E.apply(lobby, { type: 'start' }, roster, 1000);
  ok(quiet.deadline === 0, 'A ban time of Off does not start a countdown');
  quiet = E.apply(quiet, { type: 'commit', side: 'Order', god: roster[0].id }, roster, 500000);
  ok(quiet.bank.Order === 30 && quiet.deadline === 0, 'Off does not spend the reserve');
  assert.throws(() => E.apply(quiet, { type: 'clock', config: { pickSeconds: 60 } }, roster, 2));
  checks += 1;
  console.log('PASS', 'The clock locks when the draft starts');
}

function local() {
  const d = dom();
  ok(JSON.stringify(E.DRAFT_ORDERS) === JSON.stringify(d.window.DraftEngine.DRAFT_ORDERS), 'Embedded engine matches src/engine.js');
  ok(d.window.CrystalDraft.roomServer === serverUrl, 'Client reads the room server override');
  ok(d.window.document.querySelectorAll('.god').length === 95, 'All 95 god cards render');
  ok(d.window.document.querySelectorAll('#marquee img').length === 190, 'Portrait loop contains two full rosters');
  ok(d.window.CrystalDraft.gods.every(g => g.image.startsWith('data:image/webp;base64,')), 'Portraits are embedded');
  set(d, 'search', 'Nox');
  ok(d.window.document.querySelectorAll('.god').length === 1, 'Search finds Nox');
  set(d, 'search', '');
  set(d, 'roleFilter', 'Support');
  ok([...d.window.document.querySelectorAll('.god')].every(node => roster.find(g => g.id === node.dataset.god).role === 'Support'), 'Role filter');
  set(d, 'roleFilter', 'class:Mage');
  ok(d.window.document.querySelectorAll('.god').length > 0, 'Class filter');
  set(d, 'roleFilter', '');
  set(d, 'pantheonFilter', 'Norse');
  ok([...d.window.document.querySelectorAll('.god')].every(node => roster.find(g => g.id === node.dataset.god).pantheon === 'Norse'), 'Pantheon filter');
  set(d, 'pantheonFilter', '');
  set(d, 'damageFilter', 'Physical');
  ok([...d.window.document.querySelectorAll('.god')].every(node => roster.find(g => g.id === node.dataset.god).damage === 'Physical'), 'Damage filter');
  set(d, 'damageFilter', '');
  set(d, 'displayName', '<img src=x onerror=alert(1)>');
  ok(!el(d, 'soundEffects').checked, 'Sound effects start unchecked');
  enableSound(d);
  ok(sounds(d).includes('confirm'), 'Enabling sound effects plays a confirmation chime');
  click(d, 'enterBtn');
  ok(get(d).phase === 'draft', 'Local start');
  ok(!el(d, 'orderTeam').querySelector('[onerror]'), 'Display names are escaped');
  ok(!sounds(d).includes('your-turn'), 'Same-screen play has no your-turn cue');
  choose(d);
  ok(get(d).step === 1, 'Lock first ban');
  ok(sounds(d).includes('ban'), 'Ban plays a distinct sound');
  const ban = d.window.document.querySelector('#orderTeam .ban.filled');
  ok(ban && ban.querySelector('.banname').textContent === 'Achilles', 'Ban slot shows the god name');
  ok(ban.title === 'Achilles' && ban.getAttribute('aria-label') === 'Banned: Achilles', 'Ban slot names the god on hover');
  ok(ban.querySelector('img').src.startsWith('data:image/webp'), 'Ban slot keeps a visible portrait');
  click(d, 'pauseBtn');
  ok(get(d).phase === 'paused', 'Pause button');
  click(d, 'resumeBtn');
  click(d, 'undoBtn');
  ok(get(d).step === 0, 'Local undo button');
  while (get(d).phase === 'draft') choose(d);
  let s = get(d);
  ok(s.actions.length === 16 && s.phase === 'summary', 'Full standard local draft completes');
  ok(new Set(s.actions.map(a => a.god)).size === 16, 'No duplicate picks or bans');
  ok(['Order', 'Chaos'].every(side => s.actions.filter(a => a.side === side && a.type === 'pick').length === 5 && s.actions.filter(a => a.side === side && a.type === 'ban').length === 3), 'Standard team counts');
  ok(!el(d, 'summaryModal').hidden && el(d, 'summaryTeams').querySelectorAll('.ban.filled .banname').length === 6, 'Summary ban slots are named');
  ok(el(d, 'summaryTeams').querySelectorAll('.role-chip').length === 10, 'Each team gets five role chips');
  ok(/suggested/.test(el(d, 'summaryTeams').textContent), 'Primary roles start as suggestions');
  el(d, 'summaryTeams').querySelector('.role-chip[data-side="Order"][data-role="Solo"]').click();
  el(d, 'summaryTeams').querySelector('[data-role-side="Order"][data-role-pick="0"]').click();
  const firstPick = get(d).actions.find(a => a.side === 'Order' && a.type === 'pick');
  ok(firstPick.role === 'Solo' && firstPick.roleConfirmed === true, 'Tapping a role then a pick confirms it');
  const aspectBtn = el(d, 'summaryTeams').querySelector('.aspect-btn');
  ok(aspectBtn && aspectBtn.getAttribute('title').includes('Aspect of'), 'A picked god with an aspect shows the yellow toggle');
  aspectBtn.click();
  const toggled = get(d).actions.find(a => a.type === 'pick' && a.god === aspectBtn.dataset.aspect);
  ok(toggled.aspect === true && el(d, 'summaryTeams').querySelector('[data-aspect="' + aspectBtn.dataset.aspect + '"]').classList.contains('on'), 'Clicking the toggle turns the aspect on');
  const decodedAspect = d.window.CrystalDraft.codec.decodeDraft(el(d, 'draftIdCode').textContent, roster.map(g => g.id));
  const aspectIndex = get(d).actions.findIndex(a => a.type === 'pick' && a.god === aspectBtn.dataset.aspect);
  ok(el(d, 'draftIdCode').textContent.startsWith('cd3.') && decodedAspect.aspects[aspectIndex] === true && decodedAspect.clock.pickSeconds === 40 && decodedAspect.clock.banSeconds === 18, 'The summary ID records the aspect and the clock');
  ok(sounds(d).includes('pick'), 'Pick lock-in plays a distinct sound');
  click(d, 'inspectBtn');
  ok(el(d, 'summaryModal').hidden, 'Inspect final board');
  click(d, 'restartBtn');
  ok(get(d).phase === 'lobby', 'Restart returns to the lobby');
  ok(el(d, 'previewImg').hidden && el(d, 'previewName').textContent === 'Discover your next pick', 'Lobby clears the stale god preview');
  ok(el(d, 'lockBtn').disabled && el(d, 'lockBtn').textContent === 'Lock in choice', 'Lobby resets the lock bar');
  click(d, 'tabHost');
  ok(el(d, 'previewImg').hidden && el(d, 'lockBtn').disabled && el(d, 'lockBtn').textContent === 'Lock in choice', 'Create room tab does not keep the previous draft');
  ok(!/html/i.test(el(d, 'modeHelp').textContent) && /join link/i.test(el(d, 'modeHelp').textContent), 'Create-room copy shares the site and a link');
  ok(el(d, 'enterBtn').textContent.includes('Create room'), 'Create room action is available again');
  click(d, 'tabLocal');
  d.window.document.querySelector('.presets[data-clock="pickSeconds"] [data-seconds="30"]').click();
  ok(el(d, 'pickSeconds').value === '30' && /"pickSeconds":30/.test(d.window.localStorage.getItem('crystal-draft-clock') || ''), 'A pick preset is saved for the next visit');
  set(d, 'pickSeconds', '40');
  set(d, 'format', 'extended');
  click(d, 'enterBtn');
  while (get(d).step < 12) choose(d);
  const phaseTurn = d.window.CrystalDraft.engine.current(get(d));
  ok(phaseTurn.type === 'ban' && phaseTurn.side === 'Chaos' && /13\/20/.test(el(d, 'phaseLabel').textContent), 'Extended reaches the second ban phase');
  ok(el(d, 'orderTeam').querySelectorAll('.ban').length === 5 && d.window.getComputedStyle(el(d, 'orderTeam').querySelector('.bans')).flexWrap === 'nowrap', 'Five ban slots stay on one row');
  while (get(d).phase === 'draft') choose(d);
  s = get(d);
  ok(s.actions.length === 20, 'Full extended draft completes');
  ok(['Order', 'Chaos'].every(side => s.actions.filter(a => a.side === side && a.type === 'ban').length === 5), 'Extended five bans each');
  d.window.close();
}

function timeouts() {
  for (const strategy of ['random', 'skip']) {
    const d = dom();
    let now = 100000;
    d.window.Date.now = () => now;
    set(d, 'banSeconds', '5');
    set(d, 'bankSeconds', '0');
    set(d, 'timeout', strategy);
    click(d, 'enterBtn');
    now += 5100;
    d.intervals[0]();
    const s = get(d);
    ok(s.step === 1 && s.actions[0].timeout && (strategy === 'skip' ? s.actions[0].god === null : !!s.actions[0].god), 'UI timeout ' + strategy + ' advances');
    d.window.close();
  }
}

function soundsAndMute() {
  const d = dom();
  ok(!el(d, 'soundEffects').checked && el(d, 'soundEffects').labels[0].textContent.includes('Sound effects'), 'Sound effects checkbox is in the top bar and starts off');
  let now = 1_000_000;
  d.window.Date.now = () => now;
  set(d, 'banSeconds', '30');
  set(d, 'pickSeconds', '30');
  click(d, 'enterBtn');
  const deadline = get(d).deadline;
  now = deadline - 5000;
  d.intervals[0]();
  ok(sounds(d).length === 0, 'Timer ticks stay silent while sound effects are off');
  enableSound(d);
  ok(el(d, 'soundEffects').checked && d.window.localStorage.getItem('crystal-draft-sound') === '1', 'Sound effects choice persists in localStorage');
  ok(sounds(d).includes('confirm'), 'Ticking sound effects plays a confirmation chime');
  now = deadline - 6500;
  d.intervals[0]();
  now = deadline - 5000;
  d.intervals[0]();
  now = deadline - 3500;
  d.intervals[0]();
  now = deadline - 200;
  d.intervals[0]();
  const heard = sounds(d);
  ok(heard.filter(s => s === 'tick').length === 2 && heard.includes('tick-final'), 'Last five seconds tick, and the final second is distinct');
  enableSound(d);
  el(d, 'soundEffects').click();
  ok(!el(d, 'soundEffects').checked && d.window.localStorage.getItem('crystal-draft-sound') === '0', 'Unticking sound effects is remembered');
  const before = sounds(d).length;
  now = deadline - 2200;
  d.intervals[0]();
  choose(d);
  ok(sounds(d).length === before, 'Sound effects off silences ticks and lock-in');
  d.window.close();

  const remembered = dom({ sound: true });
  ok(el(remembered, 'soundEffects').checked, 'Sound effects stay on for the next visit');
  remembered.window.close();
}

function joinLink() {
  const d = dom({ url: 'https://prototype.invalid/index.html?room=ABCDEFGH' });
  ok(el(d, 'tabJoin').classList.contains('active') && el(d, 'roomCode').value === 'ABCDEFGH', 'Join link fills the room code');
  ok(!/html file/i.test(d.window.document.body.textContent), 'Page does not ask the rival to carry the HTML file');
  d.window.close();
  const hashed = dom({ url: 'https://prototype.invalid/index.html#room=ABCDEFGH' });
  ok(el(hashed, 'roomCode').value === 'ABCDEFGH', 'Legacy hash room links still fill the code');
  hashed.window.close();
}

async function waking() {
  const d = dom({ server: 'ws://127.0.0.1:1', budget: 700, retry: 30, attempt: 40 });
  click(d, 'tabHost');
  click(d, 'enterBtn');
  let saw = false;
  const start = Date.now();
  while (Date.now() - start < 2500) {
    const label = el(d, 'enterBtn').textContent;
    if (label.includes('Waking the room server')) saw = true;
    if (label.includes('Retry')) break;
    await sleep(20);
  }
  ok(saw, 'A sleeping room server shows Waking the room server…');
  ok(/wake|did not respond/i.test(el(d, 'roomInfo').textContent), 'Failure explains that the server may still be waking');
  d.window.close();
}

async function onlineUi() {
  const h = dom();
  const g = dom();
  enableSound(h);
  enableSound(g);
  click(h, 'tabHost');
  set(h, 'displayName', 'Host captain');
  click(h, 'enterBtn');
  await waitFor(() => /Room [A-HJ-NP-Z2-9]{8}/.test(el(h, 'roomInfo').textContent), 4000, 'host room code');
  const code = el(h, 'roomInfo').textContent.match(/Room ([A-HJ-NP-Z2-9]{8})/)[1];
  ok(code.length === 8, 'Host creates a short room code');
  ok(el(h, 'copyLink').hidden === false, 'Join link can be copied while waiting');
  let copied = '';
  Object.defineProperty(h.window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
  click(h, 'copyLink');
  await waitFor(() => copied.includes('?room=' + code), 1000, 'copied join link');
  ok(new URL(copied).searchParams.get('room') === code, 'Join link carries the room code');
  click(g, 'tabJoin');
  set(g, 'displayName', '<img src=x onerror=alert(1)>');
  set(g, 'roomCode', code);
  click(g, 'enterBtn');
  await waitFor(() => !el(h, 'enterBtn').disabled && el(g, 'enterBtn').disabled, 4000, 'rival joined');
  ok(sounds(h).includes('join'), 'Host hears a chime when the rival joins');
  ok(!el(h, 'chaosTeam').querySelector('[onerror]'), 'Online names are escaped');
  h.window.document.querySelector('.presets[data-clock="pickSeconds"] [data-seconds="15"]').click();
  h.window.document.querySelector('.presets[data-clock="banSeconds"] [data-seconds="0"]').click();
  await waitFor(() => get(g).config.pickSeconds === 15 && get(g).config.banSeconds === 0 && /Pick 15s/.test(el(g, 'clockLive').textContent) && /Ban off/.test(el(g, 'clockLive').textContent), 4000, 'guest clock');
  ok(el(g, 'hostSettings').style.display === 'none', 'The guest sees the live clock without the host controls');
  click(h, 'enterBtn');
  await waitFor(() => get(g).phase === 'draft' && get(h).phase === 'draft', 4000, 'draft started');
  ok(el(h, 'pickSeconds').disabled && get(h).config.banSeconds === 0, 'The clock locks when the draft starts');
  ok(get(g).names.Chaos.includes('img') && get(h).names.Order === 'Host captain', 'Names synchronize from the server');
  const early = g.window.document.querySelector('.god:not(:disabled)');
  early.click();
  ok(el(g, 'lockBtn').disabled, 'Guest cannot lock a choice on the Order turn');
  ok(sounds(h).includes('your-turn') && !sounds(g).includes('your-turn'), 'Your-turn cue is only for the captain who is up');
  choose(h);
  await waitFor(() => get(g).step === 1 && get(h).step === 1, 4000, 'host ban sync');
  ok(sounds(g).includes('ban') && sounds(g).includes('your-turn'), 'Guest hears the ban and their turn');
  const guestCard = g.window.document.querySelector('.god:not(:disabled)');
  guestCard.click();
  ok(!el(g, 'lockBtn').disabled, 'Guest can lock on their turn');
  ok(g.window.document.querySelector('.god.selected')?.dataset.god === guestCard.dataset.god, 'Guest selection stays put while they choose');
  click(g, 'lockBtn');
  await waitFor(() => get(h).step === 2 && get(g).step === 2, 4000, 'guest ban sync');
  const room = app.rooms.get(code);
  const step = get(h).step;
  room.chaos.ws.terminate();
  await waitFor(() => get(h).phase === 'paused' || sounds(h).includes('disconnect'), 4000, 'host sees the drop');
  ok(sounds(h).includes('disconnect') && sounds(g).includes('disconnect'), 'Both captains get a disconnect sound');
  await waitFor(() => get(h).phase === 'draft' && get(g).phase === 'draft' && get(h).step === step && get(g).step === step, 4000, 'guest reconnect restores the draft');
  while (get(h).phase === 'draft') {
    const s = get(h);
    const side = E.current(s).side;
    const actor = side === 'Order' ? h : g;
    const before = s.step;
    choose(actor);
    await waitFor(() => get(h).step === before + 1 && get(g).step === before + 1, 4000, 'step ' + (before + 1));
  }
  ok(get(h).actions.length === 16 && get(g).phase === 'summary', 'Full two-browser draft completes');
  ok(JSON.stringify(get(h)) === JSON.stringify(get(g)), 'Host and guest finish on the same state');
  h.window.close();
  g.window.close();
}

async function serverProtocol() {
  const host = await connect(serverUrl);
  const hostBag = track(host);
  const createdWait = once(host, m => m.type === 'welcome');
  host.send(JSON.stringify({ type: 'create', name: 'Host captain', config }));
  const created = await createdWait;
  ok(/^[A-HJ-NP-Z2-9]{8}$/.test(created.code) && created.side === 'Order' && created.token, 'Server issues a room code and Order seat');
  const guest = await connect(serverUrl);
  const guestBag = track(guest);
  const rivalWait = once(host, m => m.type === 'rival' && m.name === 'Guest captain');
  const joinedWait = once(guest, m => m.type === 'welcome');
  guest.send(JSON.stringify({ type: 'join', code: created.code, name: 'Guest captain' }));
  const joined = await joinedWait;
  await rivalWait;
  ok(joined.side === 'Chaos' && joined.state.names.Chaos === 'Guest captain', 'Guest takes the Chaos seat');
  const stranger = await connect(serverUrl);
  const refused = once(stranger, m => m.type === 'rejected');
  stranger.send(JSON.stringify({ type: 'join', code: created.code, name: 'Third' }));
  ok(/two captains/i.test((await refused).message), 'A full room refuses a third captain');
  stranger.close();

  const started = once(guest, m => m.type === 'state' && m.state.phase === 'draft');
  host.send(JSON.stringify({ type: 'action', action: { type: 'start', config, name: 'Host captain', rev: 0 } }));
  let current = (await started).state;
  ok(current.step === 0 && E.current(current).side === 'Order', 'Host start opens the draft');

  const impersonate = once(guest, m => m.type === 'notice');
  guest.send(JSON.stringify({ type: 'action', action: { type: 'commit', side: 'Order', god: roster[0].id, rev: current.rev } }));
  ok(/own side/i.test((await impersonate).message), 'Server rejects acting for the other side');
  ok(app.rooms.get(created.code).state.step === 0, 'Rejected side impersonation does not change the draft');

  const early = once(guest, m => m.type === 'notice');
  guest.send(JSON.stringify({ type: 'action', action: { type: 'commit', side: 'Chaos', god: roster[1].id, rev: current.rev } }));
  ok(/not your turn/i.test((await early).message), 'Server rejects a commit on the other captain\'s turn');
  ok(app.rooms.get(created.code).state.rev === current.rev, 'Illegal turn does not advance the revision');

  let orderSocket = host;
  async function commit(sideWs, side, rev) {
    const god = roster.find(g => !current.actions.some(a => a.god === g.id)).id;
    const nextRev = rev + 1;
    const hostState = once(orderSocket, m => m.type === 'state' && m.state.rev === nextRev);
    const guestState = once(guest, m => m.type === 'state' && m.state.rev === nextRev);
    sideWs.send(JSON.stringify({ type: 'action', action: { type: 'commit', side, god, rev } }));
    const [left, right] = await Promise.all([hostState, guestState]);
    ok(JSON.stringify(left.state) === JSON.stringify(right.state), 'Both captains receive the same state at rev ' + nextRev);
    current = left.state;
  }

  await commit(orderSocket, 'Order', current.rev);
  ok(current.step === 1 && current.actions[0].side === 'Order', 'Order ban is authoritative');

  const guestPaused = once(guest, m => m.type === 'state' && m.state.phase === 'paused');
  host.terminate();
  const paused = await guestPaused;
  ok(paused.state.step === 1, 'A dropped host pauses the draft without losing actions');
  const host2 = await connect(serverUrl);
  orderSocket = host2;
  const welcomeBack = once(host2, m => m.type === 'welcome');
  const guestLive = once(guest, m => m.type === 'state' && m.state.phase === 'draft' && m.state.step === 1);
  host2.send(JSON.stringify({ type: 'reconnect', code: created.code, token: created.token }));
  const back = await welcomeBack;
  ok(back.role === 'reconnected' && back.side === 'Order' && back.state.phase === 'draft' && back.state.step === 1, 'Host reconnect restores the same draft');
  current = (await guestLive).state;
  const bad = await connect(serverUrl);
  const badWait = once(bad, m => m.type === 'rejected');
  bad.send(JSON.stringify({ type: 'reconnect', code: created.code, token: 'not-a-real-token' }));
  ok(/no longer available|expired/i.test((await badWait).message), 'A wrong seat token cannot reconnect');
  bad.close();

  const host2Bag = track(orderSocket);
  while (current.phase === 'draft') {
    const side = E.current(current).side;
    await commit(side === 'Order' ? orderSocket : guest, side, current.rev);
  }
  ok(current.phase === 'summary' && current.actions.length === 16, 'Server draft reaches the standard summary');
  ok(JSON.stringify(guestBag.latest()) === JSON.stringify(current), 'Guest ends on the server\'s final state');
  ok(JSON.stringify(host2Bag.latest()) === JSON.stringify(current), 'Reconnected host ends on the same final state');
  ok(new Set(current.actions.map(a => a.god)).size === 16, 'Server draft has no duplicate gods');
  const roleRev = current.rev + 1;
  const hostRoles = once(orderSocket, m => m.type === 'state' && m.state.rev === roleRev);
  const guestRoles = once(guest, m => m.type === 'state' && m.state.rev === roleRev);
  orderSocket.send(JSON.stringify({ type: 'action', action: { type: 'roles', side: 'Order', roles: [
    { role: 'Solo', confirmed: true }, { role: 'Jungle', confirmed: true }, { role: 'Mid', confirmed: true },
    { role: 'Carry', confirmed: true }, { role: 'Support', confirmed: true }
  ] } }));
  const [hostRoleState, guestRoleState] = await Promise.all([hostRoles, guestRoles]);
  ok(hostRoleState.state.actions.find(a => a.side === 'Order' && a.type === 'pick').role === 'Solo', 'The server stores the host role assignment');
  ok(JSON.stringify(hostRoleState.state) === JSON.stringify(guestRoleState.state), 'The guest sees the host roles live');
  const roleDenied = once(guest, m => m.type === 'notice');
  guest.send(JSON.stringify({ type: 'action', action: { type: 'roles', side: 'Order', roles: [
    { role: 'Support', confirmed: true }, { role: 'Carry', confirmed: true }, { role: 'Mid', confirmed: true },
    { role: 'Jungle', confirmed: true }, { role: 'Solo', confirmed: true }
  ] } }));
  ok(/own team/i.test((await roleDenied).message), 'The other captain cannot assign host roles');
  current = hostRoleState.state;
  const aspectPick = current.actions.find(a => a.type === 'pick' && a.side === 'Order' && roster.some(g => g.id === a.god && g.aspect));
  ok(aspectPick, 'The finished server draft has an Order pick with an aspect');
  const aspectRev = current.rev + 1;
  const hostAspect = once(orderSocket, m => m.type === 'state' && m.state.rev === aspectRev);
  const guestAspect = once(guest, m => m.type === 'state' && m.state.rev === aspectRev);
  orderSocket.send(JSON.stringify({ type: 'action', action: { type: 'aspect', side: 'Order', god: aspectPick.god, on: true } }));
  const [hostAspectState, guestAspectState] = await Promise.all([hostAspect, guestAspect]);
  ok(hostAspectState.state.actions.find(a => a.god === aspectPick.god && a.type === 'pick').aspect === true, 'The server stores the aspect on that pick');
  ok(JSON.stringify(hostAspectState.state) === JSON.stringify(guestAspectState.state), 'Both captains receive the aspect toggle');
  const stolen = once(guest, m => m.type === 'notice');
  guest.send(JSON.stringify({ type: 'action', action: { type: 'aspect', side: 'Order', god: aspectPick.god, on: false } }));
  ok(/own side/i.test((await stolen).message), 'The other captain cannot toggle that aspect');
  ok(app.rooms.get(created.code).state.actions.find(a => a.god === aspectPick.god && a.type === 'pick').aspect === true, 'A rejected aspect toggle leaves the pick unchanged');
  void hostBag;

  orderSocket.close();
  guest.close();
}

async function extendedRoom() {
  const host = await connect(serverUrl);
  const createdWait = once(host, m => m.type === 'welcome');
  host.send(JSON.stringify({ type: 'create', name: 'Order', config: { ...config, format: 'extended', pickSeconds: 20, banSeconds: 15, bankSeconds: 45 } }));
  const created = await createdWait;
  const guest = await connect(serverUrl);
  const joinedWait = once(guest, m => m.type === 'welcome');
  guest.send(JSON.stringify({ type: 'join', code: created.code, name: 'Chaos' }));
  await joinedWait;
  const guestClock = once(guest, m => m.type === 'state' && m.state.config.pickSeconds === 45 && m.state.config.banSeconds === 0);
  host.send(JSON.stringify({ type: 'action', action: { type: 'clock', config: { pickSeconds: 45, banSeconds: 0, bankSeconds: 45, timeout: 'skip' } } }));
  const clocked = await guestClock;
  ok(clocked.state.phase === 'lobby' && clocked.state.bank.Order === 45, 'The guest receives the host clock before the draft');
  const denied = once(guest, m => m.type === 'notice');
  guest.send(JSON.stringify({ type: 'action', action: { type: 'clock', config: { pickSeconds: 60 } } }));
  ok(/host can set the clock/i.test((await denied).message), 'A guest cannot change the clock');
  const started = once(guest, m => m.type === 'state' && m.state.phase === 'draft');
  host.send(JSON.stringify({ type: 'action', action: { type: 'start', config: { ...config, format: 'extended', pickSeconds: 45, banSeconds: 0, bankSeconds: 45, timeout: 'skip' }, name: 'Order', rev: clocked.state.rev } }));
  let current = (await started).state;
  ok(current.deadline === 0 && current.config.format === 'extended', 'The server starts an extended draft with ban Off');
  const locked = once(host, m => m.type === 'notice');
  host.send(JSON.stringify({ type: 'action', action: { type: 'clock', config: { pickSeconds: 60 } } }));
  ok(/locks/i.test((await locked).message), 'The server rejects a clock change after the start');
  for (let step = 0; step < 20; step++) {
    const turn = E.current(current);
    const sideWs = turn.side === 'Order' ? host : guest;
    const next = once(host, m => m.type === 'state' && m.state.rev === current.rev + 1);
    sideWs.send(JSON.stringify({ type: 'action', action: { type: 'commit', side: turn.side, god: roster.find(g => !current.actions.some(a => a.god === g.id)).id, rev: current.rev } }));
    current = (await next).state;
    if (step === 11) ok(E.current(current).type === 'ban' && E.current(current).side === 'Chaos', 'The server reaches the second ban phase on a Chaos ban');
  }
  ok(current.phase === 'summary' && ['Order', 'Chaos'].every(side => current.actions.filter(a => a.side === side && a.type === 'ban').length === 5), 'A full extended room draft gives five bans to each team');
  host.close();
  guest.close();
}

async function serverTimeoutAndIdle() {
  const roomApp = createApp({ idleMs: 350, tickMs: 40 });
  const { url } = await listen(roomApp);
  try {
    const host = await connect(url);
    const created = once(host, m => m.type === 'welcome');
    host.send(JSON.stringify({ type: 'create', name: 'Timeout host', config: { ...config, banSeconds: 5, bankSeconds: 0, timeout: 'skip' } }));
    const welcome = await created;
    const guest = await connect(url);
    const joined = once(guest, m => m.type === 'welcome');
    guest.send(JSON.stringify({ type: 'join', code: welcome.code, name: 'Timeout guest' }));
    await joined;
    const started = once(guest, m => m.type === 'state' && m.state.phase === 'draft');
    host.send(JSON.stringify({ type: 'action', action: { type: 'start', rev: 0 } }));
    await started;
    roomApp.rooms.get(welcome.code).state.deadline = Date.now() - 1000;
    const timed = await once(host, m => m.type === 'state' && m.state.step === 1);
    ok(timed.state.actions[0].timeout && timed.state.actions[0].god === null, 'Server applies a skip timeout itself');
    host.close();
    guest.close();
    await sleep(500);
    ok(!roomApp.rooms.has(welcome.code), 'Idle rooms are removed after both captains leave');
    const late = await connect(url);
    const expired = once(late, m => m.type === 'rejected');
    late.send(JSON.stringify({ type: 'reconnect', code: welcome.code, token: welcome.token }));
    ok(/expired/i.test((await expired).message), 'Reconnect after cleanup reports that the room expired');
    late.close();
  } finally {
    await roomApp.close();
  }
}

async function refreshSeat() {
  const h = dom();
  const g = dom();
  click(h, 'tabHost');
  set(h, 'displayName', 'Host captain');
  click(h, 'enterBtn');
  await waitFor(() => /Room [A-HJ-NP-Z2-9]{8}/.test(el(h, 'roomInfo').textContent), 4000, 'refresh host room');
  const code = el(h, 'roomInfo').textContent.match(/Room ([A-HJ-NP-Z2-9]{8})/)[1];
  click(g, 'tabJoin');
  set(g, 'displayName', 'Guest captain');
  set(g, 'roomCode', code);
  click(g, 'enterBtn');
  await waitFor(() => !el(h, 'enterBtn').disabled, 4000, 'refresh rival');
  click(h, 'enterBtn');
  await waitFor(() => get(h).phase === 'draft', 4000, 'refresh draft');
  choose(h);
  await waitFor(() => get(g).step === 1, 4000, 'refresh first ban');
  const seat = h.window.sessionStorage.getItem('crystal-seat');
  const step = get(h).step;
  h.window.close();
  const h2 = dom({ seat });
  await waitFor(() => get(h2).phase === 'draft' && get(h2).step === step && el(h2, 'sessionLabel').textContent.includes('Order'), 4000, 'refreshed host seat');
  ok(get(h2).actions.length === 1 && get(g).phase === 'draft', 'Refreshing the host tab rejoins the same draft');
  h2.window.close();
  g.window.close();
}

async function health() {
  const res = await fetch(serverUrl.replace(/^ws:/, 'http:') + '/health');
  const body = await res.json();
  ok(res.status === 200 && body.ok === true, 'GET /health reports ok');
}

(async () => {
  ok(html.includes('wss://smite2-draft-rooms.onrender.com'), 'Default room server URL is wss://smite2-draft-rooms.onrender.com');
  ok(!/peerjs/i.test(html) && !html.includes('__APP__') && !html.includes('__PEERJS__'), 'Built page has no PeerJS and no leftover tokens');
  ok(!/needs this HTML/i.test(html), 'Built page does not tell rivals to carry the HTML');
  app = createApp({ tickMs: 100, idleMs: 60_000 });
  const info = await listen(app);
  serverUrl = info.url;
  try {
    unit();
    local();
    timeouts();
    soundsAndMute();
    joinLink();
    await waking();
    await refreshSeat();
    await health();
    await onlineUi();
    await serverProtocol();
    await extendedRoom();
    await serverTimeoutAndIdle();
    ok(failures.length === 0, 'No script or DOM runtime errors');
    console.log(`\n${checks} checks passed.`);
  } finally {
    await app.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
