'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const Codec = require('./src/draft-codec');
const Engine = require('./src/engine');

const roster = JSON.parse(fs.readFileSync(__dirname + '/src/gods.json', 'utf8'));
const ids = roster.map(g => g.id);
let checks = 0;
function ok(condition, label) {
  assert.ok(condition, label);
  checks += 1;
  console.log('PASS', label);
}

function sample(format) {
  const count = format === 'extended' ? 20 : 16;
  const gods = [];
  for (let i = 0; i < count; i++) gods.push(i === 3 ? null : ids[i]);
  return {
    format: format,
    date: '2026-11-10',
    names: { Order: 'Renée', Chaos: 'Chaos captain' },
    gods: gods
  };
}

function unit() {
  for (const format of ['standard', 'extended']) {
    const record = sample(format);
    const code = Codec.encodeDraft(record, ids);
    const back = Codec.decodeDraft(code, ids);
    ok(back.format === format && back.date === '2026-11-10', format + ' draft ID keeps format and date');
    ok(back.names.Order === 'Renée' && back.names.Chaos === 'Chaos captain', format + ' draft ID keeps names');
    ok(JSON.stringify(back.gods) === JSON.stringify(record.gods), format + ' draft ID round-trips the action list');
    const steps = Codec.orderedActions(back, Engine.DRAFT_ORDERS);
    ok(steps[0].side === 'Order' && steps[0].type === 'ban' && steps[1].side === 'Chaos', format + ' replay order follows the preset');
    ok(steps.filter(step => step.god === null).length === 1 && steps[3].god === null, format + ' timeout pass stays in position');
  }
  const link = 'https://smite2-draft.onrender.com/?replay=' + encodeURIComponent(Codec.encodeDraft(sample('standard'), ids));
  ok(Codec.decodeDraft(Codec.extractReplayCode(link), ids).names.Order === 'Renée', 'A replay link resolves to the same draft');
  assert.throws(() => Codec.encodeDraft({ format: 'standard', names: { Order: 'A', Chaos: 'B' }, gods: ['nut'] }, ids));
  checks += 1;
  console.log('PASS', 'Partial drafts do not get an ID');

  const parsed = Codec.parseGodList('Nut, Ra\nprincess bari; the-morrigan\nnot-a-god', roster);
  ok(parsed.ids.join() === 'nut,ra,princess-bari,the-morrigan', 'Name lists match names, ids, and punctuation');
  ok(parsed.unknown.join() === 'not-a-god', 'Unknown names are reported');
  const plan = {
    name: 'Night comp',
    picks: ['nut', 'ra', 'zeus'],
    bans: ['loki'],
    comps: [{ name: 'Main', gods: ['nut', 'ra', 'zeus', 'neith', 'ymir'] }, { name: 'Backup', gods: ['agni', 'scylla', 'poseidon', 'hou-yi', 'geb'] }]
  };
  const planCode = Codec.encodePlan(plan, ids);
  const planBack = Codec.decodePlan(planCode, ids);
  ok(planBack.name === 'Night comp' && planBack.picks.join() === plan.picks.join() && planBack.bans.join() === 'loki', 'Plan code round-trips priorities');
  ok(planBack.comps[0].gods.join() === plan.comps[0].gods.join() && planBack.comps[1].name === 'Backup', 'Plan code round-trips target comps');

  const taken = Codec.advise(plan, ['nut'], { side: 'Chaos', type: 'pick', god: 'nut' }, 'Order', roster);
  ok(taken.nextPick === 'ra' && taken.picks[0].out && !taken.picks[1].out, 'Opponent taking Nut makes Ra the next pick');
  ok(taken.alert.text === 'Chaos took Nut — your next priority is Ra', 'The alert names who took the god and the new priority');
  ok(taken.comps[0].broken && !taken.comps[0].possible && taken.comps[1].possible, 'A comp breaks when one of its gods is gone and the other stays possible');
  const banned = Codec.advise(plan, ['loki'], { side: 'Chaos', type: 'ban', god: 'loki' }, 'Order', roster);
  ok(banned.nextBan === null && /nothing left/.test(banned.alert.text), 'A banned priority with no remainder says the list is empty');
}

function dom() {
  const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  const vc = new VirtualConsole();
  const failures = [];
  vc.on('jsdomError', error => failures.push(String(error)));
  const intervals = [];
  const d = new JSDOM(html, {
    url: 'https://prototype.invalid/index.html',
    runScripts: 'dangerously',
    virtualConsole: vc,
    beforeParse(window) {
      window.confirm = () => true;
      window.CRYSTAL_ROOM_SERVER = 'ws://127.0.0.1:9';
      window.setInterval = fn => { intervals.push(fn); return intervals.length; };
      window.clearInterval = () => {};
      window.localStorage.setItem('crystal-draft-plans', JSON.stringify([{
        id: 'plan-night',
        name: 'Night comp',
        picks: ['nut', 'ra', 'zeus'],
        bans: ['loki'],
        comps: [{ name: 'Main', gods: ['nut', 'ra', 'zeus', 'neith', 'ymir'] }]
      }]));
    }
  });
  d.failures = failures;
  return d;
}
function el(d, id) { return d.window.document.getElementById(id); }
function lockNamed(d, name) {
  const button = [...d.window.document.querySelectorAll('.god')].find(node => !node.disabled && node.querySelector('span')?.textContent === name);
  assert.ok(button, name);
  button.click();
  el(d, 'lockBtn').click();
}

function ui() {
  const d = dom();
  el(d, 'soundEffects').click();
  el(d, 'displayName').value = 'Order captain';
  el(d, 'otherName').value = 'Chaos captain';
  el(d, 'enterBtn').click();
  el(d, 'assistPlan').value = 'plan-night';
  el(d, 'assistPlan').dispatchEvent(new d.window.Event('change'));
  el(d, 'assistSide').value = 'Order';
  el(d, 'assistSide').dispatchEvent(new d.window.Event('change'));
  ok(el(d, 'suggestPick').textContent.includes('Nut'), 'The assistant offers the first planned pick');
  const early = ['Achilles', 'Agni', 'Ah Puch', 'Amaterasu', 'Anhur', 'Anubis', 'Aphrodite'];
  early.forEach(name => lockNamed(d, name));
  lockNamed(d, 'Nut');
  ok(el(d, 'toast').textContent === 'Chaos took Nut — your next priority is Ra', 'Live draft alerts when the rival takes a planned god');
  ok(d.window.CrystalDraft.playedSounds().includes('alert'), 'The priority alert plays when sound effects are on');
  ok(el(d, 'suggestPick').textContent.includes('Ra'), 'The next pick updates immediately');
  ok(el(d, 'pickPriority').querySelector('.out').textContent === 'Nut', 'Nut is struck out of the priority list');
  ok(el(d, 'assistBody').textContent.includes('Broken'), 'The target comp is marked broken');
  while (d.window.CrystalDraft.getState().phase === 'draft') {
    const button = d.window.document.querySelector('.god:not(:disabled)');
    button.click();
    el(d, 'lockBtn').click();
  }
  const code = el(d, 'draftIdCode').textContent;
  const decoded = d.window.CrystalDraft.codec.decodeDraft(code, ids);
  const played = d.window.CrystalDraft.getState().actions.map(action => action.god);
  ok(JSON.stringify(decoded.gods) === JSON.stringify(played), 'The summary ID replays the same pick and ban order');
  const history = JSON.parse(d.window.localStorage.getItem('crystal-draft-history'));
  ok(history[0].id === code && history[0].names.Order === 'Order captain', 'The draft is stored in local history');
  el(d, 'replayThis').click();
  ok(el(d, 'replayBar').hidden === false && d.window.CrystalDraft.getState().step === 0, 'Replay opens at the start of the draft');
  el(d, 'replayFwd').click();
  ok(d.window.CrystalDraft.getState().actions[0].god === played[0] && d.window.CrystalDraft.getState().actions[0].side === 'Order', 'Stepping forward lands the first ban');
  el(d, 'replayBack').click();
  ok(d.window.CrystalDraft.getState().step === 0, 'Stepping back removes that ban');
  el(d, 'historyBtn').click();
  el(d, 'historyList').querySelector('[data-forget]').click();
  ok(JSON.parse(d.window.localStorage.getItem('crystal-draft-history')).length === 0, 'A history entry can be deleted');
  ok(d.failures.length === 0, 'No script errors on the draft page');
  d.window.close();
}

unit();
ui();
console.log(`\n${checks} draft-id checks passed.`);
