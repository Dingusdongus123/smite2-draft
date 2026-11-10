'use strict';
(() => {
  const Data = window.CrystalMapData;
  const Board = window.CrystalMapBoard;
  const $ = id => document.getElementById(id);
  const STORE = 'crystal-map-board';
  const SOUND_KEY = 'crystal-draft-sound';

  const audio = { ctx: null, enabled: false, unlocked: false };
  try { audio.enabled = localStorage.getItem(SOUND_KEY) === '1'; } catch { /* private mode */ }

  let state = Board.hydrate((() => { try { return localStorage.getItem(STORE); } catch { return null; } })());
  let side = 'Order';
  let wardType = 'vision';
  let tool = 'ward';
  let color = Data.colors[0];
  let brush = 4;
  let armedGod = null;
  let selected = null;
  let gods = [];
  let drag = null;
  let drawing = null;
  let saveTimer = 0;

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
  function tone(freq, dur, delay) {
    if (!audio.enabled || !audio.unlocked || !audio.ctx) return;
    const ctx = audio.ctx;
    const t = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 480;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  function play(kind) {
    if (kind === 'confirm') { tone(1568, 0.08, 0); tone(2093, 0.12, 0.03); }
    else if (kind === 'place') tone(1860, 0.06, 0);
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
  function svgPoint(ev) {
    const svg = $('board');
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return {
      x: Math.max(0, Math.min(vb.width, (ev.clientX - rect.left) / rect.width * vb.width)),
      y: Math.max(0, Math.min(vb.height, (ev.clientY - rect.top) / rect.height * vb.height))
    };
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function geometry() {
    const lane = (d, cls) => `<path class="lane ${cls}" d="${d}"/>`;
    const marks = Data.landmarks.map(mark => {
      const labeled = mark.kind === 'titan' || mark.kind === 'gold' || mark.kind === 'fire' || mark.kind === 'ritual' || mark.kind === 'pyro' || mark.kind === 'totem';
      let shape = '<circle r="6"/>';
      if (mark.kind === 'titan') shape = '<circle r="18"/>';
      else if (mark.kind === 'tower') shape = '<rect x="-6" y="-6" width="12" height="12"/>';
      else if (mark.kind === 'phoenix') shape = '<polygon points="0,-10 9,8 -9,8"/>';
      else if (mark.kind === 'gold' || mark.kind === 'fire') shape = '<circle r="14"/>';
      return `<g class="mark ${mark.kind} ${mark.side || ''}" transform="translate(${mark.x} ${mark.y})">${shape}<title>${esc(mark.name)}</title>${labeled ? `<text y="24">${esc(shortName(mark))}</text>` : ''}</g>`;
    }).join('');
    return `
      <path class="ground" d="M500 48 L640 78 L760 150 L880 210 L948 340 L972 500 L948 660 L880 790 L760 850 L640 922 L500 952 L360 922 L240 850 L120 790 L52 660 L28 500 L52 340 L120 210 L240 150 L360 78 Z"/>
      ${lane('M500 860 L500 140', 'mid')}
      ${lane('M340 860 C220 760 120 640 150 500 C180 360 240 220 340 140', 'duo')}
      ${lane('M660 845 C820 760 900 640 860 500 C820 360 780 230 660 155', 'solo')}
      <ellipse class="pit gold" cx="300" cy="478" rx="54" ry="40"/>
      <ellipse class="pit fire" cx="720" cy="490" rx="62" ry="46"/>
      <circle class="ritual-ring" cx="500" cy="500" r="28"/>
      ${marks}
      <g class="scalebar" transform="translate(70 930)">
        <line x1="0" y1="0" x2="${(10 * Data.SVG_PER_METER).toFixed(1)}" y2="0"/>
        <text y="16">10m · estimated</text>
      </g>`;
  }
  function shortName(mark) {
    const names = {
      gold: 'Gold Fury', fire: 'Fire Giant', ancient: 'Ancient Fury', pyro: 'Pyromancer',
      totem: 'Totem of Ku', ritual: 'Ritual', titan: mark.side === 'order' ? 'Order Titan' : 'Chaos Titan'
    };
    return names[mark.kind] || '';
  }
  function pointsAttr(points) {
    return points.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  }
  function arrowHead(a, b, size) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const len = 10 + size;
    const left = { x: b.x - len * Math.cos(ang - 0.45), y: b.y - len * Math.sin(ang - 0.45) };
    const right = { x: b.x - len * Math.cos(ang + 0.45), y: b.y - len * Math.sin(ang + 0.45) };
    return `${b.x.toFixed(1)},${b.y.toFixed(1)} ${left.x.toFixed(1)},${left.y.toFixed(1)} ${right.x.toFixed(1)},${right.y.toFixed(1)}`;
  }
  function strokeSvg(stroke) {
    const common = `stroke="${stroke.color}" stroke-width="${stroke.size}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
    if (stroke.tool === 'arrow') {
      const a = stroke.points[0];
      const b = stroke.points[stroke.points.length - 1];
      return `<g class="stroke" data-stroke="${stroke.id}"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${common}/><polygon points="${arrowHead(a, b, stroke.size)}" fill="${stroke.color}"/></g>`;
    }
    return `<polyline class="stroke" data-stroke="${stroke.id}" points="${pointsAttr(stroke.points)}" ${common}/>`;
  }
  function wardSvg(ward) {
    const spec = Data.wardById(ward.type);
    const r = spec ? spec.radiusM * Data.SVG_PER_METER : 0;
    const cls = `ward ${ward.side.toLowerCase()} ${spec ? spec.kind : ''} ${selected === ward.id ? 'selected' : ''}`;
    const dash = spec && spec.kind !== 'ward' ? 'stroke-dasharray="6 4"' : '';
    return `<g class="${cls}" data-ward="${ward.id}" transform="translate(${ward.x} ${ward.y})">
      <circle class="radius" r="${r.toFixed(2)}" ${dash}/>
      <circle class="pin" r="${spec && spec.revealsWards ? 8 : 6}"/>
      <title>${esc(spec ? spec.name : ward.type)} · ${ward.side} · ${spec ? spec.radiusM + 'm' : ''}</title>
    </g>`;
  }
  function tokenSvg(token) {
    const god = gods.find(g => g.id === token.godId);
    const name = god ? god.name : token.godId;
    return `<g class="token ${token.side.toLowerCase()} ${selected === token.id ? 'selected' : ''}" data-token="${token.id}" transform="translate(${token.x} ${token.y})">
      <circle r="16"/>
      <image href="src/portraits/${esc(token.godId)}.webp" x="-13" y="-13" width="26" height="26" clip-path="circle()"/>
      <text y="28">${esc(name)}</text>
      <title>${esc(name)}</title>
    </g>`;
  }
  function render() {
    const preview = drawing && drawing.points.length ? strokeSvg({
      id: 'preview', tool: drawing.tool, color: color, size: brush, points: drawing.points
    }) : '';
    $('geometry').innerHTML = geometry();
    $('ink').innerHTML = state.strokes.map(strokeSvg).join('') + preview;
    $('vision').innerHTML = state.wards.map(wardSvg).join('') + state.tokens.map(tokenSvg).join('');
    const count = Board.counts(state);
    $('wardCount').textContent = `Order ${count.Order} · Chaos ${count.Chaos}`;
    const spec = Data.wardById(wardType);
    $('wardHint').textContent = spec ? `${spec.name}: ${spec.radiusM}m${Data.scaleEstimated ? ' · drawn size estimated' : ''}` : '';
    renderDetail();
    $('undoBtn').disabled = !state.past.length;
    $('redoBtn').disabled = !state.future.length;
  }
  function renderDetail() {
    const ward = state.wards.find(w => w.id === selected);
    const token = state.tokens.find(t => t.id === selected);
    if (ward) {
      const spec = Data.wardById(ward.type);
      $('detail').innerHTML = `<strong>${esc(spec.name)}</strong><p>${esc(ward.side)} · ${spec.radiusM}m radius · ${spec.durationS}s · ${esc(spec.limit)}</p><p>${esc(spec.blurb)}</p><p class="src">Radius is the wiki figure. Circle size uses the estimated map scale.</p><button type="button" id="removeSelected">Remove</button>`;
    } else if (token) {
      const god = gods.find(g => g.id === token.godId);
      $('detail').innerHTML = `<strong>${esc(god ? god.name : token.godId)}</strong><p>${esc(token.side)} token</p><button type="button" id="removeSelected">Remove</button>`;
    } else {
      $('detail').innerHTML = '<p class="muted">Select a ward or portrait, or place a new one.</p>';
    }
    const remove = $('removeSelected');
    if (remove) remove.onclick = () => {
      if (ward) Board.removeWard(state, ward.id);
      if (token) Board.removeToken(state, token.id);
      selected = null;
      changed();
    };
  }
  function changed() {
    render();
    persist();
  }
  function paintGods() {
    const term = $('godSearch').value.trim().toLowerCase();
    const list = gods.filter(g => !term || g.name.toLowerCase().includes(term)).slice(0, 40);
    $('godList').innerHTML = list.map(g => `<button type="button" class="godchip ${armedGod === g.id ? 'armed' : ''}" data-god="${esc(g.id)}" title="${esc(g.name)}"><img src="src/portraits/${esc(g.id)}.webp" alt=""><span>${esc(g.name)}</span></button>`).join('');
  }
  function fillAbout() {
    $('aboutBody').innerHTML = Data.wards.map(w => `<h3>${esc(w.name)}</h3><p>${esc(w.blurb)} ${esc(w.cost)}. ${esc(w.carry)}. ${esc(w.limit)}.</p><p class="src"><a href="${esc(w.source)}" target="_blank" rel="noopener">${esc(w.source)}</a></p>`).join('')
      + Data.notes.map(n => `<p>${esc(n)}</p>`).join('')
      + `<p>Live sharing with the draft room server is not hooked up. The room server that is already online only relays drafts, and this page keeps its board in this browser.</p>`;
  }

  function onDown(ev) {
    if (ev.button != null && ev.button !== 0) return;
    const pin = ev.target.closest('[data-ward], [data-token]');
    const p = svgPoint(ev);
    if (pin && (tool === 'ward' || tool === 'token' || tool === 'select')) {
      selected = pin.dataset.ward || pin.dataset.token;
      const kind = pin.dataset.ward ? 'ward' : 'token';
      const item = kind === 'ward' ? state.wards.find(w => w.id === selected) : state.tokens.find(t => t.id === selected);
      drag = { kind, id: selected, ox: p.x - item.x, oy: p.y - item.y, startX: item.x, startY: item.y, moved: false };
      render();
      return;
    }
    selected = null;
    if (tool === 'ward') {
      const id = Board.placeWard(state, { type: wardType, side, x: p.x, y: p.y });
      selected = id;
      play('place');
      changed();
      return;
    }
    if (tool === 'token' && armedGod) {
      const id = Board.placeToken(state, { godId: armedGod, side, x: p.x, y: p.y });
      selected = id;
      play('place');
      changed();
      return;
    }
    if (tool === 'pen' || tool === 'arrow') {
      drawing = { tool, points: [p] };
      render();
      return;
    }
    if (tool === 'eraser') drag = { kind: 'eraser', points: [p] };
  }
  function onMove(ev) {
    if (!drag && !drawing) return;
    const p = svgPoint(ev);
    if (drawing) {
      const last = drawing.points[drawing.points.length - 1];
      if (drawing.tool === 'arrow') drawing.points = [drawing.points[0], p];
      else if (Math.hypot(p.x - last.x, p.y - last.y) > 1.5) drawing.points.push(p);
      render();
      return;
    }
    if (drag.kind === 'ward' || drag.kind === 'token') {
      const x = p.x - drag.ox;
      const y = p.y - drag.oy;
      const item = drag.kind === 'ward' ? state.wards.find(w => w.id === drag.id) : state.tokens.find(t => t.id === drag.id);
      if (Math.hypot(x - item.x, y - item.y) > 0.5) drag.moved = true;
      item.x = x;
      item.y = y;
      render();
      return;
    }
    if (drag.kind === 'eraser') drag.points.push(p);
  }
  function onUp() {
    if (drawing) {
      Board.addStroke(state, { tool: drawing.tool, color, size: brush, points: drawing.points });
      drawing = null;
      changed();
      return;
    }
    if (!drag) return;
    if (drag.kind === 'eraser') {
      if (Board.erasePoints(state, drag.points, brush + 4)) changed();
    } else if (drag.moved) {
      const item = drag.kind === 'ward' ? state.wards.find(w => w.id === drag.id) : state.tokens.find(t => t.id === drag.id);
      const x = item.x;
      const y = item.y;
      item.x = drag.startX;
      item.y = drag.startY;
      if (drag.kind === 'ward') Board.moveWard(state, drag.id, x, y);
      else Board.moveToken(state, drag.id, x, y);
      persist();
    }
    drag = null;
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
  $('wardTypes').innerHTML = Data.wards.map(w => `<button type="button" data-ward-type="${w.id}" class="${w.id === wardType ? 'active' : ''}">${esc(w.name)}</button>`).join('');
  $('wardTypes').onclick = ev => {
    const btn = ev.target.closest('[data-ward-type]');
    if (!btn) return;
    wardType = btn.dataset.wardType;
    setTool('ward');
    $('wardTypes').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    render();
  };
  document.querySelectorAll('[data-tool]').forEach(btn => { btn.onclick = () => setTool(btn.dataset.tool); });
  $('colors').innerHTML = Data.colors.map((c, i) => `<button type="button" class="swatch ${i === 0 ? 'active' : ''}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('');
  $('colors').onclick = ev => {
    const btn = ev.target.closest('[data-color]');
    if (!btn) return;
    color = btn.dataset.color;
    $('colors').querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s === btn));
    if (tool === 'ward' || tool === 'token') setTool('pen');
  };
  $('brush').addEventListener('input', () => { brush = Number($('brush').value); $('brushLabel').textContent = brush + 'px'; });
  $('undoBtn').onclick = () => { if (Board.undo(state)) changed(); };
  $('redoBtn').onclick = () => { if (Board.redo(state)) changed(); };
  $('clearWards').onclick = () => { if (Board.clearWards(state)) { selected = null; changed(); } };
  $('clearDraw').onclick = () => { if (Board.clearDrawings(state)) changed(); };
  $('clearAll').onclick = () => { if (Board.clearAll(state)) { selected = null; changed(); } };
  $('exportBtn').onclick = exportPng;
  $('aboutBtn').onclick = () => { $('about').hidden = false; };
  $('aboutClose').onclick = () => { $('about').hidden = true; };
  $('godSearch').addEventListener('input', paintGods);
  $('godList').onclick = ev => {
    const btn = ev.target.closest('[data-god]');
    if (!btn) return;
    armedGod = btn.dataset.god;
    setTool('token');
    paintGods();
  };
  const board = $('board');
  board.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  document.addEventListener('keydown', ev => {
    const meta = ev.metaKey || ev.ctrlKey;
    if (meta && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) { if (Board.redo(state)) changed(); }
      else if (Board.undo(state)) changed();
    } else if (meta && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      if (Board.redo(state)) changed();
    } else if (ev.key === 'Escape') $('about').hidden = true;
    else if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected && ev.target.tagName !== 'INPUT') {
      const ward = state.wards.find(w => w.id === selected);
      if (ward) Board.removeWard(state, ward.id);
      else Board.removeToken(state, selected);
      selected = null;
      changed();
    }
  });

  async function exportPng() {
    const clone = $('board').cloneNode(true);
    clone.querySelectorAll('image').forEach(img => img.remove());
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 1400;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#070d1b';
    ctx.fillRect(0, 0, 1400, 1400);
    ctx.drawImage(image, 0, 0, 1400, 1400);
    URL.revokeObjectURL(url);
    const scale = 1400 / 1000;
    for (const token of state.tokens) {
      const portrait = new Image();
      portrait.src = 'src/portraits/' + token.godId + '.webp';
      try {
        await portrait.decode();
        ctx.save();
        ctx.beginPath();
        ctx.arc(token.x * scale, token.y * scale, 18 * scale / 1.4, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(portrait, token.x * scale - 18, token.y * scale - 18, 36, 36);
        ctx.restore();
      } catch { /* portrait missing */ }
    }
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'smite2-conquest-board.png';
    a.click();
  }

  fillAbout();
  render();
  if (typeof fetch === 'function') {
    fetch('src/gods.json').then(r => r.json()).then(list => { gods = list; paintGods(); render(); }).catch(() => {});
  }

  window.CrystalMap = {
    data: Data,
    getState: () => state,
    placeWard: (type, team, x, y) => { const id = Board.placeWard(state, { type, side: team, x, y }); changed(); return id; },
    counts: () => Board.counts(state),
    undo: () => { const ok = Board.undo(state); if (ok) changed(); return ok; },
    serialize: () => Board.serialize(state)
  };
})();
