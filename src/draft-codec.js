/* Self-contained draft IDs and plan codes. No server storage. */
(function (root) {
  'use strict';

  const ROLES = ['Solo', 'Jungle', 'Mid', 'Carry', 'Support'];
  const ROLE_LABELS = { Solo: 'Solo', Jungle: 'Jungle', Mid: 'Mid', Carry: 'ADC', Support: 'Support' };
  const PLAN_LIMIT = 10;
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
    const version = Array.isArray(record.aspects) ? 2 : 1;
    if (version === 2 && record.aspects.length !== need) throw new Error('A draft ID is only issued for a completed ' + format + ' draft.');
    const bytes = [version, format === 'extended' ? 1 : 0];
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
    if (version === 2) {
      record.aspects.forEach(function (on, i) { bytes.push(on && gods[i] ? 1 : 0); });
    }
    return (version === 2 ? 'cd2.' : 'cd1.') + b64encode(bytes);
  }

  function readName(bytes, offset) {
    const len = bytes[offset];
    if (len > 80 || offset + 1 + len > bytes.length) throw new Error('Draft ID is damaged.');
    const text = utf8decode(bytes.slice(offset + 1, offset + 1 + len));
    return { text: text || (offset === 4 ? 'Order' : 'Chaos'), next: offset + 1 + len };
  }

  function decodeDraft(code, rosterIds) {
    const text = String(code || '').trim();
    const version = text.indexOf('cd2.') === 0 ? 2 : 1;
    const raw = text.replace(/^cd[12]\./, '');
    if (!raw || raw.length > 800) throw new Error('That draft ID could not be read.');
    let bytes;
    try { bytes = b64decode(raw); }
    catch { throw new Error('That draft ID could not be read.'); }
    if (bytes[0] !== version || bytes.length < 6) throw new Error('That draft ID could not be read.');
    const format = bytes[1] === 1 ? 'extended' : 'standard';
    const day = (bytes[2] << 8) | bytes[3];
    let cursor = 4;
    const orderName = readName(bytes, cursor);
    cursor = orderName.next;
    const chaosName = readName(bytes, cursor);
    cursor = chaosName.next;
    const need = actionCount(format);
    const tail = version === 2 ? need * 2 : need;
    if (bytes.length !== cursor + tail) throw new Error('That draft ID does not match a completed ' + format + ' draft.');
    const gods = [];
    const aspects = [];
    for (let i = 0; i < need; i++) {
      const n = bytes[cursor + i];
      if (n === 255) gods.push(null);
      else if (n >= rosterIds.length) throw new Error('That draft ID is for a different roster.');
      else gods.push(rosterIds[n]);
      aspects.push(version === 2 && bytes[cursor + need + i] === 1 && n !== 255);
    }
    return {
      format: format,
      date: dateFromDay(day),
      names: { Order: orderName.text, Chaos: chaosName.text },
      gods: gods,
      aspects: aspects
    };
  }

  function orderedActions(record, draftOrders) {
    const order = draftOrders[record.format];
    if (!order || order.length !== record.gods.length) throw new Error('Draft order does not match this ID.');
    return record.gods.map((god, i) => ({ step: i, side: order[i].side, type: order[i].type, god: god, aspect: !!(record.aspects && record.aspects[i] && order[i].type === 'pick') }));
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

  function emptyRoles() {
    const roles = {};
    ROLES.forEach(function (role) { roles[role] = []; });
    return roles;
  }
  function uniqueIds(list) {
    const out = [];
    (list || []).forEach(function (id) {
      if (id && out.indexOf(id) === -1) out.push(id);
    });
    return out;
  }
  function normalizePlan(plan, roster) {
    const source = plan || {};
    const roles = emptyRoles();
    const byId = new Map((roster || []).map(function (god) { return [god.id, god]; }));
    if (source.roles) {
      ROLES.forEach(function (role) { roles[role] = uniqueIds(source.roles[role]); });
    } else {
      uniqueIds(source.picks).forEach(function (id) {
        const god = byId.get(id);
        if (god && roles[god.role]) roles[god.role].push(id);
      });
    }
    const comps = (source.comps || []).map(function (comp) {
      const gods = comp.gods || [];
      return {
        name: comp.name || 'Comp',
        gods: ROLES.map(function (_, i) { return gods[i] || ''; })
      };
    });
    return {
      id: source.id,
      name: source.name || 'Plan',
      roles: roles,
      bans: uniqueIds(source.bans),
      comps: comps,
      picks: ROLES.reduce(function (all, role) { return all.concat(roles[role]); }, [])
    };
  }
  function writePlanBytes(plan, rosterIds, version) {
    const index = new Map(rosterIds.map(function (id, i) { return [id, i]; }));
    const bytes = [version];
    const title = nameBytes(plan.name || 'Plan');
    bytes.push(title.length);
    for (let i = 0; i < title.length; i++) bytes.push(title[i]);
    function writeIds(ids) {
      const list = (ids || []).filter(function (id) { return index.has(id); }).slice(0, 95);
      bytes.push(list.length);
      list.forEach(function (id) { bytes.push(index.get(id)); });
    }
    if (version === 2) ROLES.forEach(function (role) { writeIds(plan.roles && plan.roles[role]); });
    else writeIds(plan.picks);
    writeIds(plan.bans);
    const comps = (plan.comps || []).slice(0, 12);
    bytes.push(comps.length);
    comps.forEach(function (comp) {
      const utf = nameBytes(comp.name || 'Comp');
      bytes.push(utf.length);
      for (let i = 0; i < utf.length; i++) bytes.push(utf[i]);
      const gods = comp.gods || [];
      for (let i = 0; i < 5; i++) {
        const id = gods[i];
        bytes.push(id && index.has(id) ? index.get(id) : 255);
      }
    });
    return bytes;
  }
  function encodePlan(plan, rosterIds) {
    const version = plan && plan.roles ? 2 : 1;
    return (version === 2 ? 'cp2.' : 'cp1.') + b64encode(writePlanBytes(plan || {}, rosterIds, version));
  }
  function decodePlan(code, rosterIds) {
    const text = String(code || '').trim();
    const version = text.indexOf('cp2.') === 0 ? 2 : 1;
    const raw = text.replace(/^cp[12]\./, '');
    if (!raw || raw.length > 4000) throw new Error('That plan code could not be read.');
    let bytes;
    try { bytes = b64decode(raw); }
    catch { throw new Error('That plan code could not be read.'); }
    if (bytes[0] !== version) throw new Error('That plan code could not be read.');
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
    const roles = emptyRoles();
    let picks = [];
    if (version === 2) ROLES.forEach(function (role) { roles[role] = readIds(); });
    else picks = readIds();
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
    if (version === 2) {
      return normalizePlan({ name: title.text, roles: roles, bans: bans, comps: comps }, []);
    }
    return { name: title.text, picks: picks, bans: bans, comps: comps };
  }

  function advise(plan, usedIds, action, ourSide, roster, ourPickIds) {
    const normalized = normalizePlan(plan, roster);
    const used = new Set(usedIds || []);
    const ours = new Set(ourPickIds || []);
    const nameOf = function (id) {
      const god = (roster || []).find(function (g) { return g.id === id; });
      return god ? god.name : id;
    };
    const labelOf = function (role) { return ROLE_LABELS[role] || role; };
    const roles = ROLES.map(function (role) {
      const ids = normalized.roles[role];
      const list = ids.map(function (id) { return { id: id, name: nameOf(id), out: used.has(id) }; });
      const next = ids.find(function (id) { return id && !used.has(id); }) || null;
      const filled = ids.some(function (id) { return ours.has(id); });
      return { role: role, label: labelOf(role), list: list, next: next, filled: filled, needed: !filled };
    });
    const bans = normalized.bans.map(function (id) { return { id: id, name: nameOf(id), out: used.has(id) }; });
    const nextBan = normalized.bans.find(function (id) { return id && !used.has(id); }) || null;
    const nextRole = roles.find(function (role) { return role.next; });
    const nextPick = nextRole ? nextRole.next : null;
    const comps = normalized.comps.map(function (comp) {
      const gods = (comp.gods || []).slice(0, 5);
      const brokenIds = gods.filter(function (id) { return id && used.has(id); });
      return {
        name: comp.name || 'Comp',
        gods: gods.map(function (id, i) { return { role: ROLES[i], label: labelOf(ROLES[i]), id: id || '', name: id ? nameOf(id) : '—', out: !!(id && used.has(id)) }; }),
        possible: brokenIds.length === 0 && gods.filter(Boolean).length === 5,
        broken: brokenIds.length > 0
      };
    });
    let alert = null;
    if (action && action.god && action.side && action.side !== ourSide) {
      const hitRoles = ROLES.filter(function (role) { return normalized.roles[role].indexOf(action.god) !== -1; });
      const onBans = normalized.bans.indexOf(action.god) !== -1;
      if (hitRoles.length || onBans) {
        const verb = action.type === 'ban' ? 'banned' : 'took';
        let text = '';
        let next = null;
        if (hitRoles.length) {
          const parts = hitRoles.map(function (role) {
            const following = normalized.roles[role].find(function (id) { return id && !used.has(id); }) || null;
            if (!next) next = following;
            return following ? labelOf(role) + ' next is ' + nameOf(following) : 'nothing left for ' + labelOf(role);
          });
          text = action.side + ' ' + verb + ' ' + nameOf(action.god) + ' — ' + parts.join('; ');
        } else {
          next = nextBan;
          text = next
            ? action.side + ' ' + verb + ' ' + nameOf(action.god) + ' — your next ban is ' + nameOf(next)
            : action.side + ' ' + verb + ' ' + nameOf(action.god) + ' — nothing left on that list';
        }
        alert = { text: text, god: action.god, next: next, taker: action.side, list: hitRoles.length ? 'pick' : 'ban', roles: hitRoles };
      }
    }
    return {
      roles: roles,
      needed: roles.filter(function (role) { return role.needed; }).map(function (role) { return role.label; }),
      picks: normalized.picks.map(function (id) { return { id: id, name: nameOf(id), out: used.has(id) }; }),
      bans: bans,
      nextPick: nextPick,
      nextBan: nextBan,
      comps: comps,
      alert: alert
    };
  }

  const api = {
    ROLES: ROLES,
    ROLE_LABELS: ROLE_LABELS,
    PLAN_LIMIT: PLAN_LIMIT,
    normalizePlan: normalizePlan,
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
