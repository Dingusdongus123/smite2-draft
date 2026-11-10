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
  const plain = Codec.encodeDraft(sample('standard'), ids);
  ok(plain.startsWith('cd1.') && Codec.decodeDraft(plain, ids).aspects.every(on => on === false), 'A draft with no aspects stays a cd1 ID');
  const marked = sample('standard');
  marked.aspects = marked.gods.map((god, i) => i === 6);
  const markedCode = Codec.encodeDraft(marked, ids);
  const markedBack = Codec.decodeDraft(markedCode, ids);
  ok(markedCode.startsWith('cd2.') && markedBack.aspects[6] === true && markedBack.aspects.filter(Boolean).length === 1 && markedBack.gods.join() === marked.gods.join(), 'A cd2 ID keeps which pick has an aspect');
  const withRoles = sample('standard');
  withRoles.aspects = withRoles.gods.map(() => false);
  withRoles.roles = withRoles.gods.map((god, i) => i === 6 ? { role: 'Mid', confirmed: false } : i === 7 ? { role: 'Solo', confirmed: true } : null);
  const roleCode = Codec.encodeDraft(withRoles, ids);
  const roleBack = Codec.decodeDraft(roleCode, ids);
  ok(roleCode.startsWith('cd2.') && roleBack.roles[6].role === 'Mid' && roleBack.roles[6].confirmed === false && roleBack.roles[7].role === 'Solo' && roleBack.roles[7].confirmed === true && roleBack.roles[0] == null, 'A cd2 ID can carry roles and still reads older codes');
  const timed = sample('extended');
  timed.aspects = timed.gods.map(() => false);
  timed.clock = { pickSeconds: 30, banSeconds: 0, bankSeconds: 45, timeout: 'skip' };
  const timedBack = Codec.decodeDraft(Codec.encodeDraft(timed, ids), ids);
  ok(Codec.encodeDraft(timed, ids).startsWith('cd3.') && timedBack.clock.pickSeconds === 30 && timedBack.clock.banSeconds === 0 && timedBack.clock.bankSeconds === 45 && timedBack.clock.timeout === 'skip' && timedBack.format === 'extended', 'A cd3 ID keeps the clock and an extended draft');
  ok(Codec.decodeDraft(roleCode, ids).clock == null, 'An older cd2 ID has no clock');
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
  ok(planCode.startsWith('cp1.'), 'A flat priority list still encodes as cp1');
  const planBack = Codec.decodePlan(planCode, ids);
  ok(planBack.name === 'Night comp' && planBack.picks.join() === plan.picks.join() && planBack.bans.join() === 'loki', 'A cp1 code round-trips the flat list');
  ok(planBack.comps[0].gods.join() === plan.comps[0].gods.join() && planBack.comps[1].name === 'Backup', 'A cp1 code round-trips target comps');
  const migrated = Codec.normalizePlan(planBack, roster);
  ok(migrated.roles.Carry.join() === 'nut' && migrated.roles.Mid.join() === 'ra,zeus' && migrated.bans.join() === 'loki', 'A cp1 list lands in each god\'s primary role');

  const modern = Codec.normalizePlan({
    name: 'Night comp',
    roles: { Carry: ['nut', 'neith'], Mid: ['ra', 'zeus'], Support: ['ymir'] },
    bans: ['loki'],
    comps: plan.comps
  }, roster);
  const modernCode = Codec.encodePlan(modern, ids);
  ok(modernCode.startsWith('cp2.'), 'Role plans encode as cp2');
  const modernBack = Codec.decodePlan(modernCode, ids);
  ok(modernBack.roles.Carry.join() === 'nut,neith' && modernBack.roles.Mid.join() === 'ra,zeus' && modernBack.bans.join() === 'loki', 'A cp2 code round-trips role priorities');
  ok(modernBack.comps[0].gods.join() === plan.comps[0].gods.join(), 'A cp2 code round-trips target comps');

  const taken = Codec.advise(plan, ['nut'], { side: 'Chaos', type: 'pick', god: 'nut' }, 'Order', roster);
  ok(taken.nextPick === 'ra' && taken.roles.find(role => role.role === 'Carry').list[0].out, 'Opponent taking Nut leaves Ra as the next planned god');
  ok(taken.alert.text === 'Chaos took Nut — nothing left for ADC', 'The alert names the role that ran out');
  ok(taken.needed.join() === 'Solo,Jungle,Mid,ADC,Support', 'Every role is still needed until our team picks from it');
  const shifted = Codec.advise(modern, ['nut'], { side: 'Chaos', type: 'pick', god: 'nut' }, 'Order', roster, []);
  ok(shifted.roles.find(role => role.role === 'Carry').next === 'neith', 'Carry re-ranks to Neith after Nut is taken');
  ok(shifted.alert.text === 'Chaos took Nut — ADC next is Neith', 'The alert names the new god for that role');
  const filled = Codec.advise(modern, ['ra'], null, 'Order', roster, ['ra']);
  ok(!filled.roles.find(role => role.role === 'Mid').needed && filled.needed.includes('ADC'), 'A role is filled once our team picks from its list');
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
        roles: {
          Solo: ['chaac', 'bellona'],
          Jungle: ['bastet', 'fenrir'],
          Mid: ['ra', 'zeus'],
          Carry: ['nut', 'neith', 'hou-yi', 'apollo', 'artemis', 'cernunnos'],
          Support: ['ymir', 'geb']
        },
        bans: ['loki'],
        comps: [{ name: 'Main', gods: ['chaac', 'bastet', 'ra', 'nut', 'ymir'] }]
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
  el(d, 'plansBtn').click();
  el(d, 'planTabs').querySelector('[data-plan-tab="Carry"]').click();
  ok(el(d, 'planCount').textContent === 'ADC 6/10', 'ADC shows six of ten');
  ok(el(d, 'planGrid').querySelectorAll('.god').length === 95, 'The plan grid lists every god');
  ok(el(d, 'planGrid').querySelector('[data-plan-add="ra"] .role-badge').textContent === 'Mid', 'A god planned for another role is flagged');
  const carryOrder = () => [...el(d, 'planPriority').querySelectorAll('.prio')].map(node => node.dataset.id);
  ok(carryOrder()[0] === 'nut' && carryOrder().length === 6, 'The Carry row shows the saved priority');
  el(d, 'planPriority').querySelector('[data-down]').click();
  ok(carryOrder()[0] === 'neith' && carryOrder()[1] === 'nut', 'Down moves the first Carry priority');
  el(d, 'planGrid').querySelector('[data-plan-add="nut"]').click();
  ok(!carryOrder().includes('nut') && el(d, 'planCount').textContent === 'ADC 5/10', 'Clicking a selected portrait removes it');
  el(d, 'planGrid').querySelector('[data-plan-add="nut"]').click();
  ok(carryOrder().includes('nut'), 'Clicking the portrait again adds it back');
  ['hachiman', 'cupid', 'chiron', 'danzaburou'].forEach(id => el(d, 'planGrid').querySelector('[data-plan-add="' + id + '"]').click());
  ok(el(d, 'planCount').textContent === 'ADC 10/10', 'ADC reaches the soft limit');
  el(d, 'planGrid').querySelector('[data-plan-add="izanami"]').click();
  ok(el(d, 'toast').textContent === 'ADC already has 10 gods.' && carryOrder().length === 10, 'An 11th god is refused');
  el(d, 'closePlans').click();
  el(d, 'soundEffects').click();
  el(d, 'displayName').value = 'Order captain';
  el(d, 'otherName').value = 'Chaos captain';
  el(d, 'enterBtn').click();
  el(d, 'assistPlan').value = 'plan-night';
  el(d, 'assistPlan').dispatchEvent(new d.window.Event('change'));
  el(d, 'assistSide').value = 'Order';
  el(d, 'assistSide').dispatchEvent(new d.window.Event('change'));
  ok(el(d, 'suggest-Carry').textContent.includes('Nut'), 'The assistant offers Nut for ADC');
  ok(el(d, 'assistBody').textContent.includes('Still needed') && el(d, 'assistBody').textContent.includes('ADC'), 'The assistant lists the roles still needed');
  const early = ['Achilles', 'Agni', 'Ah Puch', 'Amaterasu', 'Anhur', 'Anubis', 'Aphrodite'];
  early.forEach(name => lockNamed(d, name));
  lockNamed(d, 'Nut');
  ok(el(d, 'toast').textContent === 'Chaos took Nut — ADC next is Neith', 'Live draft alerts when the rival takes a planned god');
  ok(d.window.CrystalDraft.playedSounds().includes('alert'), 'The priority alert plays when sound effects are on');
  ok(el(d, 'suggest-Carry').textContent.includes('Neith'), 'ADC re-ranks to the next portrait');
  ok(el(d, 'roleCarry').querySelector('.out').textContent.includes('Nut'), 'Nut is struck out of the ADC priority');
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
