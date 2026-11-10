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
  ok(Data.TITAN_SPAN_PX === 935, 'Measured base-glow span is 935px');
  ok(Math.abs(Data.PX_PER_METER - 935 / 160) < 1e-9, 'Scale is the measured span divided by the estimate');
  ok(Data.ORDER_BASE.y > Data.CHAOS_BASE.y, 'Order base is the bottom of the image');
  const vision = Data.wardById('vision');
  const sentry = Data.wardById('sentry');
  ok(vision.radiusM === 7.2 && vision.estimated === false && vision.durationS === 120, 'Vision Ward is 7.2m for 120s');
  ok(sentry.radiusM === 7.2 && sentry.revealsWards === true, 'Sentry Ward matches 7.2m and reveals wards');
  ok(Math.abs(Data.radiusPx('vision') - 7.2 * Data.PX_PER_METER) < 1e-9, 'Vision circle uses the estimated scale');
  ok(Data.notes.some(n => /estimated/i.test(n) && /160m/.test(n) && /7\.2/.test(n)), 'Notes state the 7.2m radius and the 160m estimate');
  ok(fs.existsSync(path.join(__dirname, 'src/assets/conquest.png')), 'The SmiteSource map image is in the repo');
  ok(Data.WARD_ICON_PX === 16, 'Placed ward icons are 16 map pixels');
  ok(vision.icon.endsWith('vision-ward.png') && sentry.icon.endsWith('sentry-ward.png') && vision.icon !== sentry.icon, 'Vision and Sentry use different item icons');
  ok(fs.existsSync(path.join(__dirname, vision.icon)) && fs.existsSync(path.join(__dirname, sentry.icon)), 'Ward icon files are in the repo');

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
  const capped = Board.blank();
  for (let i = 0; i < 10; i++) Board.placeWard(capped, { type: i % 2 ? 'sentry' : 'vision', side: 'Order', x: i, y: 10 });
  ok(Board.counts(capped).Order === 10, 'A team can place 10 wards');
  assert.throws(() => Board.placeWard(capped, { type: 'vision', side: 'Order', x: 1, y: 1 }), /10 wards/);
  checks += 1;
  console.log('PASS', 'An 11th Order ward is rejected');
  Board.placeWard(capped, { type: 'vision', side: 'Chaos', x: 4, y: 4 });
  ok(Board.counts(capped).Chaos === 1, 'The other team is not blocked by that cap');
  Board.clearWards(capped, 'Order');
  ok(Board.counts(capped).Order === 0 && Board.counts(capped).Chaos === 1, 'Clearing one team leaves the other');
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
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png' };
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
  ok(w.document.getElementById('mapImage').getAttribute('href').endsWith('conquest.png'), 'The board uses the SmiteSource image');
  ok(/Map image:/.test(w.document.body.textContent) && /SmiteSource/.test(w.document.body.textContent), 'The page credits SmiteSource');
  ok(/wiki\.smite2\.com/.test(w.document.querySelector('.credit').textContent), 'The credit line names the wiki');
  const visionBtn = w.document.querySelector('[data-ward-type="vision"] img');
  const sentryBtn = w.document.querySelector('[data-ward-type="sentry"] img');
  ok(visionBtn && visionBtn.getAttribute('src').endsWith('vision-ward.png'), 'The Vision selector shows the Vision icon');
  ok(sentryBtn && sentryBtn.getAttribute('src').endsWith('sentry-ward.png'), 'The Sentry selector shows the Sentry icon');
  const id = w.CrystalMap.placeWard('vision', 'Order', 420, 500);
  const sentryId = w.CrystalMap.placeWard('sentry', 'Chaos', 600, 400);
  const radius = w.document.querySelector('[data-ward="' + id + '"] .radius');
  ok(radius && Math.abs(Number(radius.getAttribute('r')) - Data.radiusPx('vision')) < 0.02, 'A placed ward draws its scaled vision circle');
  const visionIcon = w.document.querySelector('[data-ward="' + id + '"] .icon');
  const sentryIcon = w.document.querySelector('[data-ward="' + sentryId + '"] .icon');
  ok(visionIcon && visionIcon.getAttribute('href').endsWith('vision-ward.png'), 'A Vision ward draws the pyramid icon');
  ok(sentryIcon && sentryIcon.getAttribute('href').endsWith('sentry-ward.png'), 'A Sentry ward draws the eye icon');
  ok(Number(visionIcon.getAttribute('width')) === Data.WARD_ICON_PX, 'The placed icon uses the small map size');
  ok(w.document.querySelector('[data-ward="' + id + '"].order .team-ring') && w.document.querySelector('[data-ward="' + sentryId + '"].chaos .team-ring'), 'Each ward has a team ring');
  ok(/stroke-width:1\.5/.test(w.document.querySelector('style').textContent), 'The team ring is 1.5px');
  w.CrystalMap.undo();
  ok(w.CrystalMap.getState().wards.length === 1 && w.CrystalMap.getState().wards[0].type === 'vision', 'Undo removes the Sentry ward and keeps the Vision ward');
  w.document.querySelector('[data-ward-type="sentry"]').click();
  const press = new w.Event('pointerdown', { bubbles: true });
  Object.defineProperties(press, { button: { value: 0 }, clientX: { value: 30 }, clientY: { value: 30 } });
  w.document.getElementById('board').dispatchEvent(press);
  ok(w.CrystalMap.getState().wards.some(ward => ward.type === 'sentry' && ward.side === 'Order'), 'The selector sets the type of a new ward');
  await new Promise(resolve => setTimeout(resolve, 250));
  const saved = JSON.parse(w.localStorage.getItem('crystal-map-board-v2'));
  ok(saved.wards.some(ward => ward.type === 'vision') && saved.wards.some(ward => ward.type === 'sentry'), 'Ward types persist in localStorage');
  ok(w.CrystalMap.counts().Order === 2, 'The page counts both Order wards');
  w.CrystalMap.undo();
  ok(w.CrystalMap.counts().Order === 1 && w.CrystalMap.getState().wards[0].type === 'vision', 'Undo removes the ward placed from the selector');
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
