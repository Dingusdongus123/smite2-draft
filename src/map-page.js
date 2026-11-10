'use strict';
(() => {
  const Data = window.CrystalMapData;
  const Board = window.CrystalMapBoard;
  const $ = id => document.getElementById(id);
  const STORE = 'crystal-map-board-v2';
  const SOUND_KEY = 'crystal-draft-sound';
  const MAP = Data.MAP_SIZE;

  const audio = { ctx: null, enabled: false, unlocked: false };
  try { audio.enabled = localStorage.getItem(SOUND_KEY) === '1'; } catch { /* private mode */ }

  let state = Board.hydrate((() => { try { return localStorage.getItem(STORE); } catch { return null; } })());
  let side = 'Order';
  let wardType = 'vision';
  let tool = 'ward';
  let color = Data.colors[0];
  let brush = 4;
  let showRadii = true;
  let gods = [];
  let armedGod = '';
  let selectedToken = '';
  let draftPicks = [];
  const GOD_PX = Data.GOD_ICON_PX;
  let drag = null;
  let drawing = null;
  let panning = null;
  let saveTimer = 0;
  let toastTimer = 0;
  const view = { x: 0, y: 0, w: MAP, h: MAP };

  function toast(text) {
    const node = $('toast');
    node.hidden = false;
    node.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
  }
  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!audio.unlocked) {
      audio.unlocked = true;
      if (AC) {
        try { audio.ctx = new AC(); if (audio.ctx.state === 'suspended') audio.ctx.resume(); }
        catch { audio.ctx = null; }
      }
    } else if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  }
  function play(kind) {
    if (!audio.enabled || !audio.unlocked || !audio.ctx) return;
    const ctx = audio.ctx;
    const notes = kind === 'confirm' ? [[1568, 0], [2093, 0.04]] : [[1860, 0]];
    notes.forEach(([freq, delay]) => {
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.14);
    });
  }
  function setSound(on) {
    audio.enabled = on;
    $('soundEffects').checked = on;
    try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    if (on) { unlockAudio(); play('confirm'); }
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, Board.serialize(state)); } catch { /* ignore */ }
    }, 150);
  }
  function applyView() {
    $('board').setAttribute('viewBox', [view.x, view.y, view.w, view.h].map(n => n.toFixed(2)).join(' '));
  }
  function svgPoint(ev) {
    const svg = $('board');
    const ctm = svg.getScreenCTM && svg.getScreenCTM();
    if (ctm && svg.createSVGPoint) {
      try {
        const pt = svg.createSVGPoint();
        pt.x = ev.clientX;
        pt.y = ev.clientY;
        const p = pt.matrixTransform(ctm.inverse());
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
      } catch { /* use the bounding box when the matrix is unavailable */ }
    }
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: view.x + view.w / 2, y: view.y + view.h / 2 };
    return {
      x: view.x + (ev.clientX - rect.left) / rect.width * view.w,
      y: view.y + (ev.clientY - rect.top) / rect.height * view.h
    };
  }
  function zoomAt(clientX, clientY, factor) {
    const before = svgPoint({ clientX: clientX, clientY: clientY });
    const next = Math.max(180, Math.min(MAP * 2, view.w * factor));
    const scale = next / view.w;
    view.x = before.x - (before.x - view.x) * scale;
    view.y = before.y - (before.y - view.y) * scale;
    view.w = next;
    view.h = next;
    applyView();
  }

  function pointsAttr(points) {
    return points.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  }
  function arrowHead(a, b, size) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const len = 12 + size;
    const left = { x: b.x - len * Math.cos(ang - 0.45), y: b.y - len * Math.sin(ang - 0.45) };
    const right = { x: b.x - len * Math.cos(ang + 0.45), y: b.y - len * Math.sin(ang + 0.45) };
    return `${b.x.toFixed(1)},${b.y.toFixed(1)} ${left.x.toFixed(1)},${left.y.toFixed(1)} ${right.x.toFixed(1)},${right.y.toFixed(1)}`;
  }
  function strokeSvg(stroke) {
    const common = `stroke="${stroke.color}" stroke-width="${stroke.size}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
    if (stroke.tool === 'arrow') {
      const a = stroke.points[0];
      const b = stroke.points[stroke.points.length - 1];
      return `<g class="stroke"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${common}/><polygon points="${arrowHead(a, b, stroke.size)}" fill="${stroke.color}"/></g>`;
    }
    return `<polyline class="stroke" points="${pointsAttr(stroke.points)}" ${common}/>`;
  }
  function esc(value) {
    return String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
  function tokenSvg(token) {
    const god = gods.find(g => g.id === token.godId);
    const name = god ? god.name : token.godId;
    const half = GOD_PX / 2;
    const chaos = token.side === 'Chaos';
    const ink = chaos ? '#ff9a3c' : '#3ec6ff';
    const picked = selectedToken === token.id;
    const cls = (chaos ? 'token chaos' : 'token order') + (picked ? ' selected' : '');
    return `<g class="${cls}" data-token="${token.id}" transform="translate(${token.x} ${token.y})"><circle class="mark" r="${(half + 3).toFixed(1)}" fill="none" stroke="#ffe08a" stroke-width="2.5" opacity="${picked ? 1 : 0}" pointer-events="none"/><circle class="halo" r="${(half + 1).toFixed(1)}" fill="none" stroke="${ink}" stroke-width="1.5"/><image href="src/portraits/${esc(token.godId)}.webp" x="${-half}" y="${-half}" width="${GOD_PX}" height="${GOD_PX}" clip-path="url(#roundGod)"/><circle class="hit" r="${half}" fill="transparent"/><title>${esc(token.side)} ${esc(name)}</title></g>`;
  }
  function godButton(g, team) {
    const armed = armedGod === g.id && (!team || side === team);
    return `<button type="button" class="godchip ${armed ? 'armed' : ''}" draggable="true" data-god="${esc(g.id)}" ${team ? `data-team="${team}"` : ''}><img src="src/portraits/${esc(g.id)}.webp" alt="" width="44" height="44"><span>${esc(g.name)}</span></button>`;
  }
  function paintGods() {
    const box = $('godList');
    if (!box) return;
    const term = ($('godSearch') && $('godSearch').value || '').trim().toLowerCase();
    box.innerHTML = gods.filter(g => !term || g.name.toLowerCase().includes(term)).map(g => godButton(g)).join('');
  }
  function paintDraft() {
    const row = $('draftGods');
    const button = $('loadDraft');
    if (!row || !button) return;
    if (!draftPicks.length) { row.hidden = true; row.innerHTML = ''; return; }
    row.hidden = false;
    button.hidden = false;
    row.innerHTML = draftPicks.map(pick => {
      const god = gods.find(g => g.id === pick.id);
      return god ? godButton(god, pick.side) : '';
    }).join('');
  }
  function loadLastDraft() {
    draftPicks = [];
    let history = [];
    try { history = JSON.parse(localStorage.getItem('crystal-draft-history') || '[]'); } catch { history = []; }
    const latest = history[0];
    const codec = window.DraftCodec;
    const engine = window.DraftEngine;
    if (latest && codec && engine && gods.length) {
      try {
        const record = codec.decodeDraft(latest.id, gods.map(g => g.id));
        draftPicks = codec.orderedActions(record, engine.DRAFT_ORDERS).filter(step => step.type === 'pick' && step.god).map(step => ({ id: step.god, side: step.side }));
      } catch { draftPicks = []; }
    }
    if ($('loadDraft')) $('loadDraft').hidden = !history.length;
    paintDraft();
  }
  function placeGod(godId, team, x, y) {
    const id = Board.placeToken(state, { godId: godId, side: team || side, x: x, y: y });
    selectedToken = id;
    play('place');
    changed();
    return id;
  }
  function removeSelected() {
    if (!selectedToken) return;
    const id = selectedToken;
    selectedToken = '';
    if (Board.removeToken(state, id)) changed();
    else render();
  }
  function wardSvg(ward) {
    const spec = Data.wardById(ward.type);
    const r = Data.radiusPx(ward.type);
    const size = Data.WARD_ICON_PX;
    const half = size / 2;
    const ring = half + 1.25;
    const chaos = ward.side === 'Chaos';
    const cls = chaos ? 'ward chaos' : 'ward order';
    const ink = chaos ? '#ff9a3c' : '#3ec6ff';
    const icon = spec && spec.icon ? spec.icon : Data.wardById('vision').icon;
    const name = spec ? spec.name : ward.type;
    return `<g class="${cls}" data-ward="${ward.id}" data-type="${ward.type}" transform="translate(${ward.x} ${ward.y})"><circle class="radius" r="${r.toFixed(2)}" fill="${ink}" fill-opacity="0.13" stroke="${ink}" stroke-width="2" pointer-events="none"/><circle class="hit" r="${(ring + 2).toFixed(2)}" fill="transparent"/><circle class="team-ring" r="${ring.toFixed(2)}" fill="none" stroke="${ink}" stroke-width="1.5" pointer-events="none"/><image class="icon" href="${icon}" x="${-half}" y="${-half}" width="${size}" height="${size}"/><title>${ward.side} ${name} · 7.2m</title></g>`;
  }
  function render() {
    const preview = drawing && drawing.points.length > 1 ? strokeSvg({ tool: drawing.tool, color: color, size: brush, points: drawing.points }) : '';
    $('ink').innerHTML = state.strokes.map(strokeSvg).join('') + preview;
    $('vision').innerHTML = state.wards.map(wardSvg).join('');
    $('tokens').innerHTML = state.tokens.map(tokenSvg).join('');
    $('board').classList.toggle('radii-off', !showRadii);
    const count = Board.counts(state);
    $('wardCount').textContent = `Order ${count.Order}/10 · Chaos ${count.Chaos}/10`;
    const spec = Data.wardById(wardType);
    $('wardHint').textContent = spec ? `${spec.name}: 7.2m radius · drawn size estimated` : '';
    $('undoBtn').disabled = !state.past.length;
    $('redoBtn').disabled = !state.future.length;
    if ($('removeGod')) $('removeGod').disabled = !state.tokens.some(token => token.id === selectedToken);
  }
  function changed() { render(); persist(); }

  function onDown(ev) {
    if (ev.button === 1 || (ev.button === 0 && tool === 'pan')) {
      panning = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
      return;
    }
    if (ev.button !== 0) return;
    const pin = ev.target.closest && ev.target.closest('[data-ward], [data-token]');
    const p = svgPoint(ev);
    if (pin && tool !== 'pen' && tool !== 'arrow' && tool !== 'eraser') {
      const tokenId = pin.getAttribute('data-token');
      drag = { id: tokenId || pin.getAttribute('data-ward'), kind: tokenId ? 'token' : 'ward', startX: p.x, startY: p.y, ox: p.x, oy: p.y, moved: false };
      const item = tokenId ? state.tokens.find(t => t.id === tokenId) : state.wards.find(w => w.id === drag.id);
      drag.originX = item.x;
      drag.originY = item.y;
      if (tokenId) selectedToken = tokenId;
      if (ev.pointerId != null && board.setPointerCapture) {
        try { board.setPointerCapture(ev.pointerId); } catch { /* already captured */ }
      }
      return;
    }
    if (tool === 'god') {
      if (!armedGod) { toast('Choose a god first.'); return; }
      placeGod(armedGod, side, p.x, p.y);
      return;
    }
    if (tool === 'ward') {
      try {
        Board.placeWard(state, { type: wardType, side: side, x: p.x, y: p.y });
        play('place');
        changed();
      } catch (error) { toast(error.message); }
      return;
    }
    if (tool === 'pen' || tool === 'arrow') {
      drawing = { tool: tool, points: [p] };
      return;
    }
    if (tool === 'eraser') drag = { kind: 'eraser', points: [p] };
  }
  function onMove(ev) {
    if (panning) {
      const rect = $('board').getBoundingClientRect();
      view.x = panning.vx - (ev.clientX - panning.x) / rect.width * view.w;
      view.y = panning.vy - (ev.clientY - panning.y) / rect.height * view.h;
      applyView();
      return;
    }
    if (drawing) {
      const p = svgPoint(ev);
      if (drawing.tool === 'arrow') drawing.points = [drawing.points[0], p];
      else {
        const last = drawing.points[drawing.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) > 1.2) drawing.points.push(p);
      }
      render();
      return;
    }
    if (!drag) return;
    const p = svgPoint(ev);
    if (drag.kind === 'eraser') { drag.points.push(p); return; }
    const item = drag.kind === 'token' ? state.tokens.find(t => t.id === drag.id) : state.wards.find(w => w.id === drag.id);
    const dx = p.x - drag.ox;
    const dy = p.y - drag.oy;
    if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > 3) drag.moved = true;
    item.x = drag.originX + (p.x - drag.startX);
    item.y = drag.originY + (p.y - drag.startY);
    drag.ox = p.x;
    drag.oy = p.y;
    render();
  }
  function onUp(ev) {
    if (panning && (!ev || ev.button === 0 || ev.button === 1)) { panning = null; return; }
    if (drawing) {
      Board.addStroke(state, { tool: drawing.tool, color: color, size: brush, points: drawing.points });
      drawing = null;
      changed();
      return;
    }
    if (!drag) return;
    if (drag.kind === 'eraser') {
      if (Board.erasePoints(state, drag.points, brush + 6)) changed();
    } else if (drag.kind === 'token') {
      if (drag.moved) {
        const item = state.tokens.find(t => t.id === drag.id);
        const x = item.x;
        const y = item.y;
        item.x = drag.originX;
        item.y = drag.originY;
        Board.moveToken(state, drag.id, x, y);
        persist();
      }
    } else if (drag.moved) {
      const item = state.wards.find(w => w.id === drag.id);
      const x = item.x;
      const y = item.y;
      item.x = drag.originX;
      item.y = drag.originY;
      Board.moveWard(state, drag.id, x, y);
      persist();
    } else Board.removeWard(state, drag.id);
    drag = null;
    if (!drawing) changed();
  }

  function setTool(next) {
    tool = next;
    document.querySelectorAll('[data-tool]').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === next));
  }
  function setSide(next) {
    side = next;
    $('sideOrder').classList.toggle('active', next === 'Order');
    $('sideChaos').classList.toggle('active', next === 'Chaos');
    $('sideOrder').setAttribute('aria-pressed', String(next === 'Order'));
    $('sideChaos').setAttribute('aria-pressed', String(next === 'Chaos'));
  }

  $('soundEffects').checked = audio.enabled;
  $('soundEffects').addEventListener('change', () => setSound($('soundEffects').checked));
  document.addEventListener('pointerdown', () => { if (audio.enabled) unlockAudio(); });
  $('sideOrder').onclick = () => setSide('Order');
  $('sideChaos').onclick = () => setSide('Chaos');
  $('wardTypes').innerHTML = Data.wards.map(w => `<button type="button" data-ward-type="${w.id}" class="${w.id === wardType ? 'active' : ''}"><img src="${w.icon}" alt="" width="26" height="26">${w.name}</button>`).join('');
  $('wardTypes').onclick = ev => {
    const btn = ev.target.closest('[data-ward-type]');
    if (!btn) return;
    wardType = btn.dataset.wardType;
    setTool('ward');
    $('wardTypes').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    render();
  };
  document.querySelectorAll('[data-tool]').forEach(btn => { btn.onclick = () => setTool(btn.dataset.tool); });
  $('colors').innerHTML = Data.colors.map((c, i) => `<button type="button" class="swatch ${i === 0 ? 'active' : ''}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  $('colors').onclick = ev => {
    const btn = ev.target.closest('[data-color]');
    if (!btn) return;
    color = btn.dataset.color;
    $('colors').querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s === btn));
    if (tool === 'ward' || tool === 'god' || tool === 'pan') setTool('pen');
  };
  $('brush').addEventListener('input', () => { brush = Number($('brush').value); $('brushLabel').textContent = brush + 'px'; });
  $('showRadii').onchange = () => { showRadii = $('showRadii').checked; render(); };
  $('undoBtn').onclick = () => { if (Board.undo(state)) changed(); };
  $('redoBtn').onclick = () => { if (Board.redo(state)) changed(); };
  $('clearDraw').onclick = () => { if (Board.clearDrawings(state)) changed(); };
  $('clearOrder').onclick = () => { if (Board.clearWards(state, 'Order')) changed(); };
  $('clearChaos').onclick = () => { if (Board.clearWards(state, 'Chaos')) changed(); };
  $('fitBtn').onclick = () => { view.x = 0; view.y = 0; view.w = MAP; view.h = MAP; applyView(); };
  $('aboutBtn').onclick = () => { $('about').hidden = false; };
  $('aboutClose').onclick = () => { $('about').hidden = true; };
  $('aboutBody').innerHTML = Data.wards.map(w => `<h3>${w.name}</h3><p>${w.blurb}</p><p class="src"><a href="${w.source}" target="_blank" rel="noopener">${w.source}</a></p>`).join('') + Data.notes.map(n => `<p>${n}</p>`).join('');
  const board = $('board');
  board.addEventListener('pointerdown', onDown);
  board.addEventListener('wheel', ev => { ev.preventDefault(); zoomAt(ev.clientX, ev.clientY, ev.deltaY > 0 ? 1.12 : 0.89); }, { passive: false });
  board.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    const token = ev.target.closest && ev.target.closest('[data-token]');
    const pin = ev.target.closest && ev.target.closest('[data-ward]');
    if (token) {
      const id = token.getAttribute('data-token');
      if (selectedToken === id) selectedToken = '';
      Board.removeToken(state, id);
      changed();
      return;
    }
    if (!pin) return;
    Board.removeWard(state, pin.getAttribute('data-ward'));
    changed();
  });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  document.addEventListener('keydown', ev => {
    const meta = ev.metaKey || ev.ctrlKey;
    const typing = ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA');
    if (!typing && (ev.key === 'Delete' || ev.key === 'Backspace') && selectedToken) {
      ev.preventDefault();
      removeSelected();
    }
    if (ev.key === 'Escape') $('about').hidden = true;
    if (meta && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) Board.redo(state); else Board.undo(state); changed(); }
    if (meta && ev.key.toLowerCase() === 'y') { ev.preventDefault(); Board.redo(state); changed(); }
  });

  function loadImage(src) {
    const image = new Image();
    image.src = src;
    return image.decode().then(() => image);
  }
  async function exportCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    const map = await loadImage('src/assets/conquest.png');
    ctx.drawImage(map, 0, 0, 1024, 1024);
    const icons = {};
    for (const spec of Data.wards) icons[spec.id] = await loadImage(spec.icon);
    const clone = board.cloneNode(true);
    clone.querySelector('#mapImage')?.remove();
    clone.querySelectorAll('.icon, .hit, .token image, .token .hit').forEach(node => node.remove());
    if (!showRadii) clone.querySelectorAll('.radius').forEach(node => node.remove());
    clone.setAttribute('width', '1024');
    clone.setAttribute('height', '1024');
    clone.setAttribute('viewBox', '0 0 1024 1024');
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const overlay = new Image();
    overlay.src = url;
    await overlay.decode();
    ctx.drawImage(overlay, 0, 0);
    URL.revokeObjectURL(url);
    const size = Data.WARD_ICON_PX;
    state.wards.forEach(ward => {
      const icon = icons[ward.type] || icons.vision;
      ctx.drawImage(icon, ward.x - size / 2, ward.y - size / 2, size, size);
    });
    for (const token of state.tokens) {
      const portrait = await loadImage('src/portraits/' + token.godId + '.webp');
      ctx.save();
      ctx.beginPath();
      ctx.arc(token.x, token.y, GOD_PX / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(portrait, token.x - GOD_PX / 2, token.y - GOD_PX / 2, GOD_PX, GOD_PX);
      ctx.restore();
    }
    return canvas;
  }
  async function exportPng() {
    const canvas = await exportCanvas();
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'smite2-conquest-board.png';
    link.click();
  }
  $('exportBtn').onclick = () => { exportPng().catch(() => toast('Could not export the board.')); };

  render();
  window.CrystalMap = {
    data: Data,
    getState: () => state,
    placeWard: (type, team, x, y) => {
      const id = Board.placeWard(state, { type: type, side: team, x: x, y: y });
      changed();
      return id;
    },
    undo: () => { const ok = Board.undo(state); if (ok) changed(); return ok; },
    counts: () => Board.counts(state),
    placeToken: (godId, team, x, y) => placeGod(godId, team, x, y),
    gods: () => gods,
    exportCanvas: exportCanvas
  };
  function armGod(id, team) {
    armedGod = id;
    if (team) setSide(team);
    setTool('god');
    paintGods();
    paintDraft();
  }
  $('godSearch').addEventListener('input', paintGods);
  $('godList').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-god]');
    if (btn) armGod(btn.dataset.god, btn.dataset.team);
  });
  $('draftGods').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-god]');
    if (btn) armGod(btn.dataset.god, btn.dataset.team);
  });
  function onGodDragStart(ev) {
    const btn = ev.target.closest && ev.target.closest('[data-god]');
    if (!btn || !ev.dataTransfer) return;
    ev.dataTransfer.setData('text/plain', 'god:' + btn.dataset.god + ':' + (btn.dataset.team || side));
    ev.dataTransfer.effectAllowed = 'copy';
  }
  $('godList').addEventListener('dragstart', onGodDragStart);
  $('draftGods').addEventListener('dragstart', onGodDragStart);
  board.addEventListener('dragover', ev => {
    if (ev.dataTransfer) ev.preventDefault();
  });
  board.addEventListener('drop', ev => {
    const raw = ev.dataTransfer && ev.dataTransfer.getData('text/plain');
    if (!raw || raw.indexOf('god:') !== 0) return;
    ev.preventDefault();
    const parts = raw.split(':');
    const point = svgPoint(ev);
    placeGod(parts[1], parts[2] || side, point.x, point.y);
  });
  $('clearGods').onclick = () => { selectedToken = ''; if (Board.clearTokens(state)) changed(); else render(); };
  $('removeGod').onclick = removeSelected;
  $('loadDraft').onclick = () => { loadLastDraft(); if (!draftPicks.length) toast('No saved draft picks to load.'); };
  function loadJson(url) {
    if (typeof fetch === 'function') return fetch(url).then(r => r.json());
    return new Promise((resolve, reject) => {
      const req = new XMLHttpRequest();
      req.open('GET', url);
      req.onload = () => {
        try { resolve(JSON.parse(req.responseText)); }
        catch (error) { reject(error); }
      };
      req.onerror = () => reject(new Error('Could not load gods'));
      req.send();
    });
  }
  const loadGods = loadJson('src/gods.json');
  loadGods.then(list => {
    gods = Array.isArray(list) ? list : [];
    paintGods();
    loadLastDraft();
    render();
  }).catch(() => {});
})();
