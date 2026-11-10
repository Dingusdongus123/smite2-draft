'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const Data = require('./src/map-data');
const Board = require('./src/map-board');

let checks = 0;
function ok(condition, label) {
  assert.ok(condition, label);
  checks += 1;
  console.log('PASS', label);
}

function unit() {
  ok(Data.scaleEstimated === true, 'Map scale is marked estimated');
  ok(Data.ESTIMATED_TITAN_SPAN_METERS === 160, 'Estimated titan span is 160m');
  ok(Math.abs(Data.SVG_PER_METER - Data.TITAN_SPAN_SVG / 160) < 1e-9, 'Scale is titan span divided by the estimate');
  const vision = Data.wardById('vision');
  const sentry = Data.wardById('sentry');
  const heim = Data.wardById('heimdallr');
  const flare = Data.wardById('gjallar');
  ok(vision.radiusM === 7.2 && vision.estimated === false && vision.durationS === 120, 'Vision Ward is 7.2m for 120s');
  ok(sentry.radiusM === 7.2 && sentry.revealsWards === true, 'Sentry Ward matches 7.2m and reveals wards');
  ok(Data.wardById('chalice').radiusM === 7.2 && Data.wardById('bifrost').durationS === 90, 'Chalice radius and Bifrost duration');
  ok(heim.radiusM === 8.8 && heim.kind === 'pulse', "Heimdallr's Sight is an 8.8m pulse");
  ok(flare.radiusM === 13.2 && flare.travelM === 44 && flare.corridorM === 8.8, 'Gjallarflare burst and travel figures');
  ok(Data.radiusSvg('vision') === 7.2 * Data.SVG_PER_METER, 'Vision circle uses the estimated scale');
  ok(Data.radiusSvg('gjallar') > Data.radiusSvg('heimdallr') && Data.radiusSvg('heimdallr') > Data.radiusSvg('vision'), 'Larger reveals draw larger circles');
  const gf = Data.landmarks.find(m => m.id === 'gold-fury');
  const fg = Data.landmarks.find(m => m.id === 'fire-giant');
  const order = Data.landmarks.find(m => m.id === 'order-titan');
  const chaos = Data.landmarks.find(m => m.id === 'chaos-titan');
  ok(gf.x < fg.x, 'Gold Fury is on the duo side, Fire Giant on the solo side');
  ok(order.y > chaos.y, 'Order base is the bottom of the board');
  ok(['mid', 'duo', 'solo'].every(lane => ['t1', 't2', 'phoenix'].every(tier =>
    Data.landmarks.some(m => m.id === 'order-' + lane + '-' + tier) &&
    Data.landmarks.some(m => m.id === 'chaos-' + lane + '-' + tier)
  )), 'Each lane has two towers and a Phoenix for both sides');
  ok(Data.notes.some(n => /estimated/i.test(n) && /160m/.test(n)), 'Notes say the 160m span is estimated');

  const state = Board.blank();
  const id = Board.placeWard(state, { type: 'sentry', side: 'Order', x: 300, y: 500 });
  Board.placeWard(state, { type: 'vision', side: 'Chaos', x: 400, y: 400 });
  ok(Board.counts(state).Order === 1 && Board.counts(state).Chaos === 1, 'Ward counts are per side');
  Board.moveWard(state, id, 320, 510);
  ok(state.wards.find(w => w.id === id).x === 320, 'A ward can be moved');
  Board.addStroke(state, { tool: 'pen', color: '#8ceeff', size: 4, points: [{ x: 1, y: 1 }, { x: 20, y: 20 }] });
  Board.addStroke(state, { tool: 'arrow', color: '#c9a6ff', size: 4, points: [{ x: 50, y: 50 }, { x: 80, y: 60 }] });
  ok(state.strokes.length === 2, 'Pen and arrow strokes are stored');
  Board.undo(state);
  ok(state.strokes.length === 1, 'Undo removes the last stroke');
  Board.redo(state);
  ok(state.strokes.length === 2, 'Redo restores it');
  Board.eraseNear(state, 10, 10, 6);
  ok(state.strokes.length === 1 && state.strokes[0].tool === 'arrow', 'Eraser removes the stroke it touches');
  const saved = Board.serialize(state);
  const restored = Board.hydrate(saved);
  ok(restored.wards.length === 2 && restored.strokes.length === 1 && restored.wards[0].type === 'sentry', 'The board round-trips through JSON');
  assert.throws(() => Board.placeWard(Board.blank(), { type: 'nope', side: 'Order', x: 0, y: 0 }));
  checks += 1;
  console.log('PASS', 'Unknown ward types are rejected');
}

function serve() {
  const root = __dirname;
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.normalize(path.join(root, url === '/' ? 'map.html' : url));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      const ext = path.extname(file);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp' };
      res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function page(server) {
  const port = server.address().port;
  const dom = await JSDOM.fromURL('http://127.0.0.1:' + port + '/map.html', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.localStorage.clear();
    }
  });
  await new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (dom.window.CrystalMap) { clearInterval(timer); resolve(); }
      else if (Date.now() - start > 4000) { clearInterval(timer); reject(new Error('map page did not start')); }
    }, 20);
  });
  const w = dom.window;
  ok(!w.document.getElementById('soundEffects').checked, 'Map page sound effects start off');
  w.document.getElementById('soundEffects').click();
  ok(w.document.getElementById('soundEffects').checked && w.localStorage.getItem('crystal-draft-sound') === '1', 'The map checkbox uses the same sound setting');
  ok(/7\.2/.test(w.document.getElementById('aboutBody').textContent), 'About panel shows the 7.2m radius');
  ok(/estimated/i.test(w.document.getElementById('aboutBody').textContent), 'About panel labels the scale as estimated');
  ok(w.document.querySelector('[data-landmark], .mark.gold, .mark.fire'), 'The schematic draws Gold Fury and Fire Giant');
  const id = w.CrystalMap.placeWard('vision', 'Order', 420, 500);
  const radius = w.document.querySelector('[data-ward="' + id + '"] .radius');
  ok(radius && Math.abs(Number(radius.getAttribute('r')) - Data.radiusSvg('vision')) < 0.02, 'A placed ward draws its scaled vision circle');
  ok(w.CrystalMap.counts().Order === 1, 'The page counts the Order ward');
  w.CrystalMap.undo();
  ok(w.CrystalMap.counts().Order === 0, 'Undo removes the placed ward');
  ok(w.document.body.textContent.includes('Conquest') || w.document.title.includes('Conquest'), 'The page is the Conquest board');
  const built = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  ok(built.includes('href="map.html"'), 'The draft page links to the map');
  ok(!/room server only relays drafts/.test(built), 'The draft simulator source was not given map-sync copy');
  dom.window.close();
}

(async () => {
  unit();
  const server = await serve();
  try {
    await page(server);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log(`\n${checks} map checks passed.`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
