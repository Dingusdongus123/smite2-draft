/* Pure Conquest-board state: wards, drawing strokes, god tokens, undo. */
(function (root) {
  'use strict';
  const Data = root.CrystalMapData || (typeof module !== 'undefined' ? require('./map-data.js') : null);

  function blank() {
    return { wards: [], tokens: [], strokes: [], past: [], future: [], seq: 1 };
  }
  function snapshot(state) {
    return JSON.parse(JSON.stringify({ wards: state.wards, tokens: state.tokens, strokes: state.strokes }));
  }
  function restore(state, snap) {
    state.wards = snap.wards;
    state.tokens = snap.tokens;
    state.strokes = snap.strokes;
  }
  function transaction(state, fn) {
    const before = snapshot(state);
    const changed = fn() !== false;
    if (!changed) return false;
    state.past.push(before);
    if (state.past.length > 80) state.past.shift();
    state.future = [];
    return true;
  }
  function undo(state) {
    if (!state.past.length) return false;
    state.future.push(snapshot(state));
    restore(state, state.past.pop());
    return true;
  }
  function redo(state) {
    if (!state.future.length) return false;
    state.past.push(snapshot(state));
    restore(state, state.future.pop());
    return true;
  }
  function nextId(state, prefix) {
    state.seq += 1;
    return prefix + state.seq;
  }
  function placeWard(state, input) {
    const spec = Data.wardById(input.type);
    if (!spec) throw new Error('Unknown ward');
    if (input.side !== 'Order' && input.side !== 'Chaos') throw new Error('Unknown side');
    const limit = Data.WARD_LIMIT || 10;
    const have = state.wards.filter(function (w) { return w.side === input.side; }).length;
    if (have >= limit) throw new Error(input.side + ' already has ' + limit + ' wards.');
    let id = '';
    transaction(state, function () {
      id = nextId(state, 'w');
      state.wards.push({
        id: id,
        type: spec.id,
        side: input.side,
        x: Number(input.x),
        y: Number(input.y)
      });
    });
    return id;
  }
  function moveWard(state, id, x, y) {
    const ward = state.wards.find(function (w) { return w.id === id; });
    if (!ward) return false;
    if (ward.x === x && ward.y === y) return false;
    return transaction(state, function () {
      const current = state.wards.find(function (w) { return w.id === id; });
      current.x = x;
      current.y = y;
    });
  }
  function removeWard(state, id) {
    if (!state.wards.some(function (w) { return w.id === id; })) return false;
    return transaction(state, function () {
      state.wards = state.wards.filter(function (w) { return w.id !== id; });
    });
  }
  function clearWards(state, side) {
    const next = side ? state.wards.filter(function (w) { return w.side !== side; }) : [];
    if (next.length === state.wards.length) return false;
    return transaction(state, function () { state.wards = next; });
  }
  function placeToken(state, input) {
    let id = '';
    transaction(state, function () {
      id = nextId(state, 'g');
      state.tokens.push({
        id: id,
        godId: String(input.godId),
        side: input.side === 'Chaos' ? 'Chaos' : 'Order',
        x: Number(input.x),
        y: Number(input.y)
      });
    });
    return id;
  }
  function moveToken(state, id, x, y) {
    const token = state.tokens.find(function (t) { return t.id === id; });
    if (!token || (token.x === x && token.y === y)) return false;
    return transaction(state, function () {
      const current = state.tokens.find(function (t) { return t.id === id; });
      current.x = x;
      current.y = y;
    });
  }
  function removeToken(state, id) {
    if (!state.tokens.some(function (t) { return t.id === id; })) return false;
    return transaction(state, function () {
      state.tokens = state.tokens.filter(function (t) { return t.id !== id; });
    });
  }
  function clearTokens(state) {
    if (!state.tokens.length) return false;
    return transaction(state, function () { state.tokens = []; });
  }
  function addStroke(state, stroke) {
    if (!stroke || !stroke.points || stroke.points.length < 2) return null;
    let id = '';
    transaction(state, function () {
      id = nextId(state, 's');
      state.strokes.push({
        id: id,
        tool: stroke.tool === 'arrow' ? 'arrow' : 'pen',
        color: stroke.color,
        size: stroke.size,
        points: stroke.points.map(function (p) { return { x: p.x, y: p.y }; })
      });
    });
    return id;
  }
  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len;
    t = Math.max(0, Math.min(1, t));
    const x = ax + dx * t;
    const y = ay + dy * t;
    return Math.hypot(px - x, py - y);
  }
  function strokeHits(stroke, x, y, radius) {
    const pts = stroke.points;
    for (let i = 1; i < pts.length; i++) {
      if (distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= radius + stroke.size) return true;
    }
    return false;
  }
  function eraseNear(state, x, y, radius) {
    return erasePoints(state, [{ x: x, y: y }], radius);
  }
  function erasePoints(state, points, radius) {
    const hit = state.strokes.some(function (s) {
      return points.some(function (p) { return strokeHits(s, p.x, p.y, radius); });
    });
    if (!hit) return false;
    return transaction(state, function () {
      state.strokes = state.strokes.filter(function (s) {
        return !points.some(function (p) { return strokeHits(s, p.x, p.y, radius); });
      });
    });
  }
  function clearDrawings(state) {
    if (!state.strokes.length) return false;
    return transaction(state, function () { state.strokes = []; });
  }
  function clearAll(state) {
    if (!state.wards.length && !state.tokens.length && !state.strokes.length) return false;
    return transaction(state, function () {
      state.wards = [];
      state.tokens = [];
      state.strokes = [];
    });
  }
  function counts(state) {
    return {
      Order: state.wards.filter(function (w) { return w.side === 'Order'; }).length,
      Chaos: state.wards.filter(function (w) { return w.side === 'Chaos'; }).length
    };
  }
  function serialize(state) {
    return JSON.stringify({ v: 1, wards: state.wards, tokens: state.tokens, strokes: state.strokes });
  }
  function hydrate(raw) {
    const state = blank();
    if (!raw) return state;
    let data = raw;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw); } catch { return state; }
    }
    if (!data || data.v !== 1) return state;
    state.wards = Array.isArray(data.wards) ? data.wards : [];
    state.tokens = Array.isArray(data.tokens) ? data.tokens : [];
    state.strokes = Array.isArray(data.strokes) ? data.strokes : [];
    return state;
  }

  const api = {
    blank: blank, undo: undo, redo: redo, placeWard: placeWard, moveWard: moveWard, removeWard: removeWard,
    clearWards: clearWards, placeToken: placeToken, moveToken: moveToken, removeToken: removeToken, clearTokens: clearTokens,
    addStroke: addStroke, eraseNear: eraseNear, erasePoints: erasePoints, clearDrawings: clearDrawings, clearAll: clearAll,
    counts: counts, serialize: serialize, hydrate: hydrate
  };
  if (typeof module !== 'undefined') module.exports = api;
  root.CrystalMapBoard = api;
})(typeof window === 'undefined' ? globalThis : window);
