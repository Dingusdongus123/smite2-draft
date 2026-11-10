/* Self-contained draft IDs and plan codes. No server storage. */
(function (root) {
  'use strict';

  const ROLES = ['Solo', 'Jungle', 'Mid', 'Carry', 'Support'];
  const EPOCH = Date.UTC(2026, 0, 1);

  function b64encode(bytes) {
    let bin = '';
    const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function b64decode(text) {
    const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
    const bin = atob(String(text).replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function dayNumber(date) {
    const parsed = date ? Date.parse(date) : Date.now();
    const ms = Number.isFinite(parsed) ? parsed : Date.now();
    return Math.max(0, Math.min(65535, Math.floor((ms - EPOCH) / 86400000)));
  }
  function dateFromDay(day) {
    return new Date(EPOCH + day * 86400000).toISOString().slice(0, 10);
  }
  function utf8encode(text) {
    const bytes = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp < 0x80) bytes.push(cp);
      else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return Uint8Array.from(bytes);
  }
  function utf8decode(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i];
      if (b < 0x80) { out += String.fromCharCode(b); i += 1; }
      else if (b < 0xe0) { out += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; }
      else if (b < 0xf0) { out += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; }
      else {
        const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
        out += String.fromCodePoint(cp);
        i += 4;
      }
    }
    return out;
  }
  function nameBytes(name) {
    const utf = utf8encode(String(name || '').replace(/[\u0000-\u001f]/g, '').slice(0, 24));
    return utf.length > 80 ? utf.slice(0, 80) : utf;
  }
  function actionCount(format) {
    return format === 'extended' ? 20 : 16;
  }

  function encodeDraft(record, rosterIds) {
    const format = record.format === 'extended' ? 'extended' : 'standard';
    const need = actionCount(format);
    const gods = record.gods || [];
    if (gods.length !== need) throw new Error('A draft ID is only issued for a completed ' + format + ' draft.');
    const index = new Map(rosterIds.map((id, i) => [id, i]));
    const bytes = [1, format === 'extended' ? 1 : 0];
    const day = dayNumber(record.date);
    bytes.push((day >> 8) & 255, day & 255);
    for (const side of ['Order', 'Chaos']) {
      const utf = nameBytes(record.names && record.names[side]);
      bytes.push(utf.length);
      for (let i = 0; i < utf.length; i++) bytes.push(utf[i]);
    }
    for (const god of gods) {
      if (!god) bytes.push(255);
      else {
        if (!index.has(god)) throw new Error('That draft names a god outside this roster.');
        bytes.push(index.get(god));
      }
    }
    return 'cd1.' + b64encode(bytes);
  }

  function readName(bytes, offset) {
    const len = bytes[offset];
    if (len > 80 || offset + 1 + len > bytes.length) throw new Error('Draft ID is damaged.');
    const text = utf8decode(bytes.slice(offset + 1, offset + 1 + len));
    return { text: text || (offset === 4 ? 'Order' : 'Chaos'), next: offset + 1 + len };
  }

  function decodeDraft(code, rosterIds) {
    const raw = String(code || '').trim().replace(/^cd1\./, '');
    if (!raw || raw.length > 500) throw new Error('That draft ID could not be read.');
    let bytes;
    try { bytes = b64decode(raw); }
    catch { throw new Error('That draft ID could not be read.'); }
    if (bytes[0] !== 1 || bytes.length < 6) throw new Error('That draft ID could not be read.');
    const format = bytes[1] === 1 ? 'extended' : 'standard';
    const day = (bytes[2] << 8) | bytes[3];
    let cursor = 4;
    const orderName = readName(bytes, cursor);
    cursor = orderName.next;
    const chaosName = readName(bytes, cursor);
    cursor = chaosName.next;
    const need = actionCount(format);
    if (bytes.length !== cursor + need) throw new Error('That draft ID does not match a completed ' + format + ' draft.');
    const gods = [];
    for (let i = 0; i < need; i++) {
      const n = bytes[cursor + i];
      if (n === 255) gods.push(null);
      else if (n >= rosterIds.length) throw new Error('That draft ID is for a different roster.');
      else gods.push(rosterIds[n]);
    }
    return {
      format: format,
      date: dateFromDay(day),
      names: { Order: orderName.text, Chaos: chaosName.text },
      gods: gods
    };
  }

  function orderedActions(record, draftOrders) {
    const order = draftOrders[record.format];
    if (!order || order.length !== record.gods.length) throw new Error('Draft order does not match this ID.');
    return record.gods.map((god, i) => ({ step: i, side: order[i].side, type: order[i].type, god: god }));
  }

  function norm(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function parseGodList(text, roster) {
    const parts = String(text || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    const matched = [];
    const unknown = [];
    const byNorm = roster.map(g => ({ id: g.id, name: g.name, key: norm(g.name), idKey: norm(g.id) }));
    for (const part of parts) {
      const key = norm(part);
      if (!key) continue;
      let hit = byNorm.find(g => g.idKey === key || g.key === key);
      if (!hit && key.length >= 4) {
        const starts = byNorm.filter(g => g.key.startsWith(key) || g.idKey.startsWith(key));
        if (starts.length === 1) hit = starts[0];
      }
      if (!hit) unknown.push(part);
      else if (!matched.some(m => m.id === hit.id)) matched.push({ input: part, id: hit.id, name: hit.name });
    }
    return { matched: matched, unknown: unknown, ids: matched.map(m => m.id) };
  }

  function encodePlan(plan, rosterIds) {
    const index = new Map(rosterIds.map((id, i) => [id, i]));
    const bytes = [1];
    const title = nameBytes(plan.name || 'Plan');
    bytes.push(title.length);
    for (let i = 0; i < title.length; i++) bytes.push(title[i]);
    function writeIds(ids) {
      const list = (ids || []).filter(id => index.has(id)).slice(0, 95);
      bytes.push(list.length);
      list.forEach(id => bytes.push(index.get(id)));
      return list;
    }
    writeIds(plan.picks);
    writeIds(plan.bans);
    const comps = (plan.comps || []).slice(0, 12);
    bytes.push(comps.length);
    comps.forEach(comp => {
      const utf = nameBytes(comp.name || 'Comp');
      bytes.push(utf.length);
      for (let i = 0; i < utf.length; i++) bytes.push(utf[i]);
      const gods = comp.gods || [];
      for (let i = 0; i < 5; i++) {
        const id = gods[i];
        bytes.push(id && index.has(id) ? index.get(id) : 255);
      }
    });
    return 'cp1.' + b64encode(bytes);
  }

  function decodePlan(code, rosterIds) {
    const raw = String(code || '').trim().replace(/^cp1\./, '');
    if (!raw || raw.length > 2000) throw new Error('That plan code could not be read.');
    let bytes;
    try { bytes = b64decode(raw); }
    catch { throw new Error('That plan code could not be read.'); }
    if (bytes[0] !== 1) throw new Error('That plan code could not be read.');
    let cursor = 1;
    const title = readName(bytes, cursor);
    cursor = title.next;
    function readIds() {
      const count = bytes[cursor];
      cursor += 1;
      const ids = [];
      for (let i = 0; i < count; i++) {
        const n = bytes[cursor + i];
        if (n !== 255 && n < rosterIds.length) ids.push(rosterIds[n]);
      }
      cursor += count;
      return ids;
    }
    const picks = readIds();
    const bans = readIds();
    const compCount = bytes[cursor];
    cursor += 1;
    const comps = [];
    for (let c = 0; c < compCount; c++) {
      const compName = readName(bytes, cursor);
      cursor = compName.next;
      const gods = [];
      for (let i = 0; i < 5; i++) {
        const n = bytes[cursor + i];
        gods.push(n === 255 || n >= rosterIds.length ? '' : rosterIds[n]);
      }
      cursor += 5;
      comps.push({ name: compName.text, gods: gods });
    }
    return { name: title.text, picks: picks, bans: bans, comps: comps };
  }

  function advise(plan, usedIds, action, ourSide, roster) {
    const used = new Set(usedIds || []);
    const nameOf = id => {
      const god = (roster || []).find(g => g.id === id);
      return god ? god.name : id;
    };
    const picks = (plan.picks || []).map(id => ({ id: id, name: nameOf(id), out: used.has(id) }));
    const bans = (plan.bans || []).map(id => ({ id: id, name: nameOf(id), out: used.has(id) }));
    const nextPick = (plan.picks || []).find(id => id && !used.has(id)) || null;
    const nextBan = (plan.bans || []).find(id => id && !used.has(id)) || null;
    const comps = (plan.comps || []).map(comp => {
      const gods = (comp.gods || []).slice(0, 5);
      const brokenIds = gods.filter(id => id && used.has(id));
      return {
        name: comp.name || 'Comp',
        gods: gods.map((id, i) => ({ role: ROLES[i], id: id || '', name: id ? nameOf(id) : '—', out: !!(id && used.has(id)) })),
        possible: brokenIds.length === 0 && gods.filter(Boolean).length === 5,
        broken: brokenIds.length > 0
      };
    });
    let alert = null;
    if (action && action.god && action.side && action.side !== ourSide) {
      const onPicks = (plan.picks || []).includes(action.god);
      const onBans = (plan.bans || []).includes(action.god);
      if (onPicks || onBans) {
        const next = onPicks ? nextPick : nextBan;
        const verb = action.type === 'ban' ? 'banned' : 'took';
        const text = next
          ? action.side + ' ' + verb + ' ' + nameOf(action.god) + ' — your next priority is ' + nameOf(next)
          : action.side + ' ' + verb + ' ' + nameOf(action.god) + ' — nothing left on that list';
        alert = { text: text, god: action.god, next: next, taker: action.side, list: onPicks ? 'pick' : 'ban' };
      }
    }
    return { picks: picks, bans: bans, nextPick: nextPick, nextBan: nextBan, comps: comps, alert: alert };
  }

  const api = {
    ROLES: ROLES,
    encodeDraft: encodeDraft,
    decodeDraft: decodeDraft,
    orderedActions: orderedActions,
    parseGodList: parseGodList,
    encodePlan: encodePlan,
    decodePlan: decodePlan,
    advise: advise,
    extractReplayCode: function (text) {
      const raw = String(text || '').trim();
      if (!raw) return '';
      try {
        const url = new URL(raw);
        const query = url.searchParams.get('replay');
        if (query) return query;
      } catch { /* not a url */ }
      const match = raw.match(/[?&]replay=([^&\s]+)/);
      if (match) return decodeURIComponent(match[1]);
      return raw;
    }
  };
  if (typeof module !== 'undefined') module.exports = api;
  root.DraftCodec = api;
})(typeof window === 'undefined' ? globalThis : window);
