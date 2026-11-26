// End-to-end checks for PhotoMark+ 2 in a headless browser with a mocked Obsidian API (test/mock-obsidian.js).
// Usage: node test/run.js [--shots]        (--shots also writes the README screenshots to docs/)
// Needs playwright (npm install) or PMP_PLAYWRIGHT=playwright-core with PMP_CHROME=<path to chromium>.
const { chromium, devices } = require(process.env.PMP_PLAYWRIGHT || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOCS = process.env.PMP_DOCS || path.join(ROOT, 'docs');
const SHOTS = process.argv.includes('--shots');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
let failed = 0, passed = 0;
const ok = (name, cond, extra) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? `  [${typeof extra === 'string' ? extra : JSON.stringify(extra)}]` : ''}`);
  if (cond) passed++; else failed++;
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.md': 'text/markdown' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

const ED = '(window.modalStack.find((m) => m.gallery))';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(page, query = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // files created during the test (copies) are served from the vault in the page
  await page.route('**/test/vault/**', async (route) => {
    const p = decodeURI(new URL(route.request().url()).pathname.split('/test/vault/')[1]);
    if (fs.existsSync(path.join(__dirname, 'vault', p))) return route.continue();
    const b64 = await page.evaluate((q) => {
      const b = window.binaries && window.binaries[q];
      if (!b) return null;
      let s = ''; const u = new Uint8Array(b);
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(s);
    }, p).catch(() => null);
    if (!b64) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(p)] || 'image/png', body: Buffer.from(b64, 'base64') });
  });
  await page.goto(`${BASE}${query}`);
  await page.waitForFunction(() => window.ready || window.loadError);
  const err = await page.evaluate(() => window.loadError);
  if (err) console.log(err);
  await page.waitForFunction(() => document.querySelector('#embed-sample img').naturalWidth > 0);
  return errors;
}
const editorReady = (page) => page.waitForFunction((ed) => { const e = eval(ed); return e && e.ready && !e.busy && e.canvas.width > 1; }, ED, { timeout: 10000 });
const editorOpen = (page) => page.evaluate((ed) => !!eval(ed), ED);
const ed = (page, fn, arg) => page.evaluate(([src, ed, a]) => { const e = eval(ed); return new Function('e', 'a', src)(e, a); }, [fn, ED, arg]);
// image coordinates -> page coordinates
const toPage = (page, x, y) => page.evaluate(([ed, x, y]) => {
  const e = eval(ed); const r = e.canvas.getBoundingClientRect(); const v = e.view();
  return { x: r.left + ((x - v.x) / v.w) * r.width, y: r.top + ((y - v.y) / v.h) * r.height };
}, [ED, x, y]);
async function drag(page, x1, y1, x2, y2, opts = {}) {
  const a = await toPage(page, x1, y1), b = await toPage(page, x2, y2);
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const steps = opts.steps || 6;
  for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
  await sleep(40);
}
async function clickAt(page, x, y) { const a = await toPage(page, x, y); await page.mouse.click(a.x, a.y); await sleep(40); }
const marks = (page) => ed(page, 'return e.state.marks.map((m) => m.tool)');
// decode the last saved file
const saved = (page, region) => page.evaluate(async (rg) => {
  const buf = window.lastSaved;
  const head = Array.from(new Uint8Array(buf).slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const bm = await createImageBitmap(new Blob([buf]));
  const c = new OffscreenCanvas(bm.width, bm.height); const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
  const [x0, y0, w, h] = rg || [0, 0, bm.width, bm.height];
  const d = x.getImageData(x0, y0, w, h).data;
  let red = 0, gray = 0, n = 0; const colours = new Set();
  for (let i = 0; i < d.length; i += 4) {
    n++;
    if (d[i] > 225 && d[i + 1] < 70 && d[i + 2] < 70) red++;
    if (Math.abs(d[i] - d[i + 1]) <= 3 && Math.abs(d[i + 1] - d[i + 2]) <= 3) gray++;
    colours.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }
  return { w: bm.width, h: bm.height, head, red, gray, n, colours: colours.size };
}, region);
async function openFromButton(page, selector) {
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), selector);
  await sleep(100);
  await page.hover(selector, { position: { x: 120, y: 100 } });
  await sleep(120);
  await page.click('.pmp-hover');
  await editorReady(page);
}
const dialog = (page) => page.evaluate(() => { const m = document.querySelector('.modal.pmp-dialog'); return m ? { title: m.querySelector('.modal-title').textContent, buttons: [...m.querySelectorAll('button')].map((b) => b.dataset.choice), check: m.querySelector('input[type=checkbox]') ? { label: m.querySelector('.pmp-check').textContent, checked: m.querySelector('input[type=checkbox]').checked } : null } : null; });
const choose = async (page, id) => { await page.click(`.modal.pmp-dialog button[data-choice="${id}"]`); await sleep(150); };
const shot = async (page, name, clip) => { if (!SHOTS) return; await page.evaluate(() => document.querySelectorAll('.notice').forEach((n) => n.remove())); await page.screenshot({ path: path.join(DOCS, name), clip }); };
const modalClip = async (page) => { const b = await (await page.$('.modal.pmp-modal')).boundingBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };

let BASE;
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}/test/index.html`;
  const browser = await chromium.launch(process.env.PMP_CHROME ? { executablePath: process.env.PMP_CHROME, args: ['--no-sandbox'] } : {});
  if (SHOTS) fs.mkdirSync(DOCS, { recursive: true });

  // ---------------------------------------------------------------- static
  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  ok('main.js does not list the vault (no getFiles / getAllLoadedFiles)', !/getFiles|getAllLoadedFiles|getMarkdownFiles/.test(src));
  ok('main.js does not use localStorage', !/localStorage|sessionStorage/.test(src));
  ok('main.js has no network calls', !/fetch\(|XMLHttpRequest|requestUrl|WebSocket/.test(src));

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = await setup(page);
  ok('plugin loads', await page.evaluate(() => !window.loadError && !!window.plugin));
  ok('settings migrated to version 2 with the Edit button top left', await page.evaluate(() => window.plugin.settings.settingsVersion === 2 && window.plugin.settings.buttonPosition === 'top-left'));

  // ---------------------------------------------------------------- Edit button
  if (!ONLY || ONLY === 'button') {
    const visible = () => page.$eval('.pmp-hover', (b) => b.classList.contains('is-visible'));
    await page.hover('#embed-sample img', { position: { x: 300, y: 160 } });
    await sleep(100);
    const pos = await page.evaluate(() => { const b = document.querySelector('.pmp-hover').getBoundingClientRect(), i = document.querySelector('#embed-sample img').getBoundingClientRect(); return { left: Math.round(b.left - i.left), top: Math.round(b.top - i.top), text: document.querySelector('.pmp-hover').textContent }; });
    ok('Edit button appears in the top left corner of a hovered image', (await visible()) && pos.left === 8 && pos.top === 8 && pos.text === 'Edit', pos);
    if (SHOTS) {
      const r = await (await page.$('#embed-sample img')).boundingBox();
      await page.screenshot({ path: path.join(DOCS, 'hover-button.png'), clip: { x: r.x - 40, y: 40, width: r.width + 80, height: 420 } });
    }
    const bb = await (await page.$('.pmp-hover')).boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await sleep(400);
    ok('button stays while the pointer is on it', await visible());
    await page.mouse.move(5, 5);
    await sleep(400);
    ok('button hides when the pointer leaves', !(await visible()));
    await page.evaluate(() => document.getElementById('external').scrollIntoView());
    await page.hover('#external');
    await sleep(100);
    ok('no button on an external image', !(await visible()));
    // icon-only style and another corner
    await page.evaluate(() => { window.plugin.settings.buttonStyle = 'icon'; window.plugin.settings.buttonPosition = 'bottom-right'; window.plugin.applyButtonStyle(); });
    await page.hover('#plain', { position: { x: 100, y: 100 } });
    await sleep(100);
    const pos2 = await page.evaluate(() => { const b = document.querySelector('.pmp-hover').getBoundingClientRect(), i = document.querySelector('#plain').getBoundingClientRect(); return { right: Math.round(i.right - b.right), bottom: Math.round(i.bottom - b.bottom), label: getComputedStyle(document.querySelector('.pmp-hover .pmp-label')).display }; });
    ok('setting: icon only, bottom right', pos2.right === 8 && pos2.bottom === 8 && pos2.label === 'none', pos2);
    await page.evaluate(() => { window.plugin.settings.buttonStyle = 'label'; window.plugin.settings.buttonPosition = 'top-left'; window.plugin.applyButtonStyle(); });
    await page.mouse.move(5, 5);
    await sleep(300);
    // a plain markdown image (no embed) is found through its resource URL
    await openFromButton(page, '#plain');
    const info = await ed(page, 'return { name: e.file.path, source: e.sourcePath, gallery: e.gallery.map((f) => f.name), counter: e.counterEl.textContent }');
    ok('markdown image resolves to the vault file, gallery = images in the note', info.name === 'Attachments/second.png' && info.source === 'Network setup.md' && info.gallery.join() === 'sample.png,second.png' && info.counter === '2 / 2', info);
    await page.keyboard.press('Escape');
    await sleep(200);
    ok('Esc without changes closes right away', !(await editorOpen(page)));
  }

  // ---------------------------------------------------------------- draw + save over the original
  if (!ONLY || ONLY === 'save') {
    await openFromButton(page, '#embed-sample img');
    const st = await page.evaluate(() => ({ save: document.querySelector('.pmp-save').disabled, undo: document.querySelector('.pmp-content [aria-label="Undo"]').disabled, active: document.querySelector('.pmp-tool.is-active').dataset.tool, film: document.querySelectorAll('.pmp-thumb').length }));
    ok('editor opens: Save and Undo off, Rectangle active, 2 thumbnails', st.save && st.undo && st.active === 'rect' && st.film === 2, st);
    await drag(page, 300, 120, 800, 260);
    ok('drawing a rectangle turns Save on', await page.$eval('.pmp-save', (b) => !b.disabled));
    const before = await page.$eval('#embed-sample img', (i) => i.src);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.calls.modifyBinary.length === 1);
    await sleep(150);
    const px = await saved(page);
    ok('Enter saves over the original: same size, red frame', px.w === 1400 && px.h === 900 && px.red > 2000 && px.head === '89504e47', px);
    ok('editor closes after saving (default)', !(await editorOpen(page)));
    const after = await page.$eval('#embed-sample img', (i) => i.src);
    ok('image in the note is refreshed', after !== before && after.endsWith('?1001'), after);
  }

  // ---------------------------------------------------------------- all tools, select, undo, rotate
  if (!ONLY || ONLY === 'tools') {
    await openFromButton(page, '#embed-sample img');
    await page.keyboard.press('Shift+B'); await drag(page, 100, 100, 300, 200);
    await page.keyboard.press('p'); await drag(page, 320, 100, 520, 200);
    await page.keyboard.press('u'); await drag(page, 540, 100, 740, 200);
    await page.keyboard.press('d'); await drag(page, 100, 300, 300, 380, { steps: 12 });
    await page.keyboard.press('h'); await drag(page, 100, 420, 400, 420);
    await page.keyboard.press('l'); await drag(page, 500, 300, 700, 330, { shift: true });
    await page.keyboard.press('a'); await drag(page, 800, 300, 1000, 400);
    await page.keyboard.press('e'); await drag(page, 1050, 300, 1200, 380, { shift: true });
    await page.keyboard.press('n'); await clickAt(page, 1250, 120); await clickAt(page, 1300, 120);
    await page.keyboard.press('t'); await clickAt(page, 600, 600);
    await page.keyboard.type('Hello world');
    await page.keyboard.press('Enter');
    await sleep(100);
    const list = await marks(page);
    ok('every tool adds a mark', list.join() === 'block,pixelate,blur,pen,highlighter,line,arrow,ellipse,number,number,text', list);
    const geo = await ed(page, 'const m = e.state.marks; const line = m[5], el = m[7]; return { lineDy: Math.round(line.y2 - line.y1), elW: Math.round(Math.abs(el.x2 - el.x1)), elH: Math.round(Math.abs(el.y2 - el.y1)), block: m[0].color, text: m[10].text, cell: m[1].cell }');
    ok('Shift: straight line and a circle; block red; text kept', geo.lineDy === 0 && geo.elW === geo.elH && geo.block === '#ff1f1f' && geo.text === 'Hello world' && geo.cell > 0, geo);
    // select, move, recolor, delete
    await page.keyboard.press('v');
    await clickAt(page, 200, 150);
    ok('select tool picks the block', (await ed(page, 'return e.selected')) === 0);
    await drag(page, 200, 150, 260, 190);
    const moved = await ed(page, 'const m = e.state.marks[0]; return [Math.round(Math.min(m.x1, m.x2)), Math.round(Math.min(m.y1, m.y2))]');
    ok('dragging moves the selected mark', Math.abs(moved[0] - 160) <= 2 && Math.abs(moved[1] - 140) <= 2, moved);
    await page.click('.pmp-swatch[title="#0ea5e9"]');
    ok('a color swatch recolors the selected mark', (await ed(page, 'return e.state.marks[0].color')) === '#0ea5e9');
    await page.keyboard.press('Delete');
    ok('Delete removes the selected mark', (await marks(page)).length === 10);
    // edit an existing text
    await page.keyboard.press('t');
    const tx = await ed(page, 'const m = e.state.marks.find((k) => k.tool === "text"); return [m.x + 10, m.y + 10]');
    await clickAt(page, tx[0], tx[1]);
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Enter');
    await sleep(80);
    ok('clicking a text with the text tool edits it', (await ed(page, 'return e.state.marks.find((k) => k.tool === "text").text')) === 'Hello world!');
    // undo / redo
    const n = (await marks(page)).length;
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    ok('Ctrl+Z undoes (text edit, then the delete)', n === 10 && (await ed(page, 'return e.state.marks.find((k) => k.tool === "text").text')) === 'Hello world' && (await ed(page, 'return e.state.marks.length')) === 11);
    await page.keyboard.press('Control+Shift+z'); await page.keyboard.press('Control+y');
    ok('Ctrl+Shift+Z / Ctrl+Y redo', (await ed(page, 'return e.state.marks.length')) === 10 && (await ed(page, 'return e.state.marks.find((k) => k.tool === "text").text')) === 'Hello world!');
    // rotate and flip: marks follow, four turns are the identity
    const snap0 = await ed(page, 'return JSON.stringify(e.state.marks.map(({ _box, ...m }) => m))');
    await page.keyboard.press(']');
    const r1 = await ed(page, 'const m = e.state.marks.find((k) => k.tool === "arrow"); return { W: e.W, H: e.H, rot: e.state.rot, x1: Math.round(m.x1), y1: Math.round(m.y1) }');
    ok('rotate right: size swaps and marks turn with the image', r1.W === 900 && r1.H === 1400 && r1.rot === 90 && r1.x1 === 900 - 300 && r1.y1 === 800, r1);
    await page.keyboard.press(']'); await page.keyboard.press(']'); await page.keyboard.press(']');
    const back = await ed(page, 'return { rot: e.state.rot, marks: JSON.stringify(e.state.marks.map(({ _box, ...m }) => ({ ...m, ...(m.points ? { points: m.points.map((p) => p.map((v) => Math.round(v * 1000) / 1000)) } : {}) }))) }');
    const norm = (s) => JSON.stringify(JSON.parse(s).map((m) => { for (const k of Object.keys(m)) if (typeof m[k] === 'number') m[k] = Math.round(m[k] * 1000) / 1000; if (m.points) m.points = m.points.map((p) => p.map((v) => Math.round(v * 1000) / 1000)); return m; }));
    ok('four turns bring every mark back', back.rot === 0 && norm(back.marks) === norm(snap0));
    await page.click('.pmp-content [aria-label="Flip horizontally"]');
    await page.click('.pmp-content [aria-label="Flip vertically"]');
    const fl = await ed(page, 'const m = e.state.marks.find((k) => k.tool === "arrow"); return { rot: e.state.rot, flip: e.state.flip, x1: Math.round(m.x1), y1: Math.round(m.y1) }');
    ok('flip horizontally + vertically = rotate 180', fl.rot === 180 && fl.flip === false && fl.x1 === 1400 - 800 && fl.y1 === 900 - 300, fl);
    // zoom
    await page.keyboard.press('Shift+Equal');
    const z1 = await page.$eval('.pmp-zoom-label', (b) => b.textContent);
    await page.keyboard.press('0');
    const z0 = await page.$eval('.pmp-zoom-label', (b) => b.textContent);
    ok('zoom with + and back to fit with 0', z1 !== z0 && parseInt(z1, 10) > parseInt(z0, 10), [z1, z0]);
    // zoom under the mouse: the image point under the pointer stays there, also with a plain mouse wheel
    const pt = await toPage(page, 1000, 300);
    const under = () => page.evaluate(([x, y]) => { const e = window.modalStack.find((m) => m.gallery); const f = e.fracAt(x, y); const v = e.view(); return [Math.round(v.x + f.fx * v.w), Math.round(v.y + f.fy * v.h)]; }, [pt.x, pt.y]);
    await page.mouse.move(pt.x, pt.y);
    await page.keyboard.down('Control'); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -200); await sleep(30); } await page.keyboard.up('Control');
    await sleep(80);
    const u1 = await under(), z2 = await ed(page, 'return e.zoom');
    await page.mouse.wheel(0, -100);
    await sleep(80);
    const u2 = await under(), z3 = await ed(page, 'return e.zoom');
    ok('Ctrl+wheel and mouse wheel zoom in around the pointer, in steady steps', z3 > z2 && z2 > 1.8 && z2 < 3.5 && Math.abs(u1[0] - 1000) <= 3 && Math.abs(u1[1] - 300) <= 3 && Math.abs(u2[0] - 1000) <= 3 && Math.abs(u2[1] - 300) <= 3, { z2, z3, u1, u2 });
    // drawing while zoomed in lands exactly where you drag
    const before = (await marks(page)).length;
    await page.keyboard.press('r');
    await page.mouse.move(pt.x - 150, pt.y - 100); await page.mouse.down(); await page.mouse.move(pt.x, pt.y, { steps: 5 }); await page.mouse.up();
    await sleep(60);
    const mk = await ed(page, 'const m = e.state.marks.at(-1); return [Math.round(Math.max(m.x1, m.x2)), Math.round(Math.max(m.y1, m.y2)), e.state.marks.length]');
    ok('drawing while zoomed in lands under the pointer', mk[2] === before + 1 && Math.abs(mk[0] - 1000) <= 3 && Math.abs(mk[1] - 300) <= 3, mk);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('0');
    ok('no Obsidian close button over the Save button', (await page.$$('.modal.pmp-modal .modal-close-button')).length === 0);
    // close with changes asks first
    await page.keyboard.press('Escape');
    await sleep(150);
    const d1 = await dialog(page);
    ok('Esc with changes asks before discarding', !!d1 && d1.buttons.join() === 'keep,discard', d1);
    await choose(page, 'keep');
    ok('Keep editing keeps the editor open', await editorOpen(page));
    await page.click('.pmp-content [aria-label="Close"]');
    await sleep(150);
    await choose(page, 'discard');
    ok('Discard closes without saving', !(await editorOpen(page)) && (await page.evaluate(() => window.calls.modifyBinary.length)) === 1);
  }

  // ---------------------------------------------------------------- crop, adjust, size
  if (!ONLY || ONLY === 'adjust') {
    await openFromButton(page, '#embed-sample img');
    await page.keyboard.press('c');
    await sleep(80);
    ok('crop tool shows a frame with handles', (await page.$$('.pmp-crop .pmp-handle')).length === 8);
    await page.click('.pmp-options .pmp-chip:text("1:1")');
    // drag the frame to the right
    const cr = await ed(page, 'const r = e.cropping.rect; return [r.x + r.w / 2, r.y + r.h / 2]');
    await drag(page, cr[0], cr[1], cr[0] + 200, cr[1]);
    await shot(page, 'crop.png', await modalClip(page));
    await page.keyboard.press('Enter');
    await sleep(100);
    const crop = await ed(page, 'return e.state.crop');
    ok('crop 1:1 applied with Enter', !!crop && crop.w === crop.h && crop.w === 900 && crop.x === 450, crop);
    // adjustments
    await page.click('.pmp-content [aria-label="Adjust"]');
    await sleep(80);
    ok('Adjust opens the side panel', await page.$eval('.pmp-panel', (p) => p.classList.contains('is-open')));
    await page.$eval('input[data-adjust="brightness"]', (r) => { r.value = '30'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
    await page.click('.pmp-panel button[data-adjust="grayscale"]');
    await page.click('.pmp-panel .pmp-chip:text("50%")');
    await sleep(80);
    const adj = await ed(page, 'return { b: e.state.adj.brightness, g: e.state.adj.grayscale, size: e.state.size, info: e.infoEl.textContent }');
    ok('brightness, black and white and 50% size are set', adj.b === 30 && adj.g === true && adj.size === 50 && adj.info.startsWith('450 × 450'), adj);
    await shot(page, 'adjust.png', await modalClip(page));
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => window.calls.modifyBinary.length === 2);
    const px = await saved(page);
    ok('saved image is cropped, smaller and black and white', px.w === 450 && px.h === 450 && px.gray / px.n > 0.99, px);
    // adjustments are reset for the next image, the panel stays where it was
    await openFromButton(page, '#embed-sample img');
    ok('next edit starts without adjustments', (await ed(page, 'return e.state.adj.grayscale === false && e.state.size === 100 && e.W === 450')));
    await page.keyboard.press('Escape');
    await sleep(150);
  }

  // ---------------------------------------------------------------- browsing like a gallery
  if (!ONLY || ONLY === 'gallery') {
    await openFromButton(page, '#embed-sample img');
    await page.keyboard.press('ArrowRight');
    await editorReady(page);
    ok('→ goes to the next image in the note', (await ed(page, 'return e.file.name + " " + e.counterEl.textContent')) === 'second.png 2 / 2');
    ok('Next is off at the last image', await page.$eval('.pmp-content [aria-label="Next image"]', (b) => b.disabled));
    await drag(page, 200, 200, 500, 400);
    await page.keyboard.press('ArrowLeft');
    await sleep(150);
    const d = await dialog(page);
    ok('switching with changes asks to save', !!d && d.buttons.join() === 'cancel,discard,save', d);
    await page.keyboard.press('b');
    await page.keyboard.press('ArrowLeft');
    ok('keys do nothing to the editor while a dialog is on top', (await ed(page, 'return e.tool + " " + e.file.name')) === 'rect second.png' && !!(await dialog(page)));
    await choose(page, 'save');
    await editorReady(page);
    const g = await page.evaluate(() => ({ calls: window.calls.modifyBinary.map((c) => c.path) }));
    ok('Save in that dialog saves and then switches', g.calls.at(-1) === 'Attachments/second.png' && (await ed(page, 'return e.file.name')) === 'sample.png', g);
    await page.click('.pmp-thumb:nth-child(2)');
    await editorReady(page);
    ok('clicking a thumbnail opens that image', (await ed(page, 'return e.file.name')) === 'second.png');
    // the setting "save automatically when switching"
    await page.evaluate(() => { window.plugin.settings.onSwitch = 'discard'; });
    await drag(page, 600, 200, 800, 400);
    await page.click('.pmp-content [aria-label="Previous image"]');
    await editorReady(page);
    ok('onSwitch = discard: switches without asking or saving', (await ed(page, 'return e.file.name')) === 'sample.png' && (await page.evaluate(() => window.calls.modifyBinary.length)) === 3 && !(await dialog(page)));
    await page.evaluate(() => { window.plugin.settings.onSwitch = 'ask'; });
    // afterSave = next
    await page.evaluate(() => { window.plugin.settings.afterSave = 'next'; });
    await drag(page, 100, 100, 300, 300);
    await page.click('.pmp-save');
    await editorReady(page);
    ok('after saving: go to the next image', (await ed(page, 'return e.file.name')) === 'second.png' && (await page.evaluate(() => window.calls.modifyBinary.at(-1).path)) === 'Attachments/sample.png');
    await page.evaluate(() => { window.plugin.settings.afterSave = 'stay'; });
    await drag(page, 100, 100, 300, 300);
    await page.click('.pmp-save');
    await editorReady(page);
    ok('after saving: keep editing (Save off, Undo off, same image)', (await ed(page, 'return e.file.name')) === 'second.png' && await page.$eval('.pmp-save', (b) => b.disabled) && await page.$eval('.pmp-content [aria-label="Undo"]', (b) => b.disabled));
    await page.evaluate(() => { window.plugin.settings.afterSave = 'close'; });
    await page.keyboard.press('Escape');
    await sleep(150);
    // folder gallery from the file explorer
    await page.evaluate(() => { const menu = { addItem: (fn) => fn({ setTitle() { return this; }, setIcon() { return this; }, onClick(cb) { window.menuClick = cb; return this; } }) }; window.handlers['file-menu'][0](menu, window.files.find((f) => f.name === 'photo.jpg')); window.menuClick(); });
    await editorReady(page);
    const fg = await ed(page, 'return { g: e.gallery.map((f) => f.name).join(), c: e.counterEl.textContent }');
    ok('opened from the file explorer: browse the folder, sorted', fg.g === 'photo.jpg,sample.png,second.png' && fg.c === '1 / 3', fg);
    await shot(page, 'gallery.png', await modalClip(page));
    await page.keyboard.press('Escape');
    await sleep(150);
  }

  // ---------------------------------------------------------------- copy, other format, settings in the editor
  if (!ONLY || ONLY === 'copy') {
    await openFromButton(page, '#embed-sample img');
    await page.click('.pmp-content [aria-label="Settings"]');
    await sleep(80);
    const heads = await page.$$eval('.pmp-panel .setting-item-heading', (h) => h.map((x) => x.textContent));
    ok('settings panel in the editor, with sections', heads.length === 6 && heads[0] === 'General', heads);
    const sel = await page.evaluateHandle(() => [...document.querySelectorAll('.pmp-panel .setting-item')].find((s) => s.querySelector('.setting-item-name').textContent === 'When saving').querySelector('select'));
    await sel.selectOption('copy');
    await sleep(80);
    ok('changing a setting in the editor saves it', await page.evaluate(() => window.plugin.settings.saveMode === 'copy' && window.storedSettings.saveMode === 'copy'));
    ok('copy suffix setting appears when it applies', await page.evaluate(() => [...document.querySelectorAll('.pmp-panel .setting-item-name')].some((n) => n.textContent === 'Suffix for copies')));
    await drag(page, 300, 300, 600, 500);
    await page.click('.pmp-save');
    await page.waitForFunction(() => window.calls.createBinary.length === 1);
    await sleep(100);
    const c1 = await page.evaluate(() => ({ created: window.calls.createBinary[0].path, note: window.texts['Network setup.md'], notice: window.calls.notices.at(-1) }));
    ok('copy saved next to the original, both links in the note updated', c1.created === 'Attachments/sample-edited.png' && (c1.note.match(/sample-edited\.png/g) || []).length === 2 && /2 links updated/.test(c1.notice), c1);
    // JPEG: always a new file
    await page.evaluate(() => { window.plugin.settings.saveMode = 'overwrite'; window.plugin.settings.format = 'jpeg'; });
    await page.evaluate(() => { const m = { addItem: (fn) => fn({ setTitle() { return this; }, setIcon() { return this; }, onClick(cb) { window.menuClick = cb; return this; } }) }; window.handlers['file-menu'][0](m, window.files.find((f) => f.name === 'second.png')); window.menuClick(); });
    await editorReady(page);
    await drag(page, 300, 300, 600, 500);
    await page.click('.pmp-save');
    await page.waitForFunction(() => window.calls.createBinary.length === 2);
    const px = await saved(page);
    ok('format JPEG saves a .jpg next to the PNG', (await page.evaluate(() => window.calls.createBinary[1].path)) === 'Attachments/second-edited.jpg' && px.head.startsWith('ffd8'), px.head);
    await page.evaluate(() => { window.plugin.settings.format = 'same'; window.plugin.settings.saveMode = 'overwrite'; });
  }

  // ---------------------------------------------------------------- delete
  if (!ONLY || ONLY === 'delete') {
    // second.png is embedded on its own line in the note
    await page.evaluate(() => { window.plugin.settings.removeEmbedsOnDelete = true; });
    await openFromButton(page, '#plain');
    await page.click('.pmp-content [aria-label="Delete image"]');
    await sleep(120);
    const d = await dialog(page);
    ok('delete asks first, with "also remove from the note" ticked', !!d && d.buttons.join() === 'cancel,delete' && d.check && d.check.checked && /Network setup/.test(d.check.label), d);
    await shot(page, 'delete.png', await modalClip(page));
    await choose(page, 'delete');
    await editorReady(page);
    const r = await page.evaluate(() => ({ trash: window.calls.trash, note: window.texts['Network setup.md'], notice: window.calls.notices.at(-1) }));
    ok('image goes to the trash via the file manager', r.trash.length === 1 && r.trash[0].path === 'Attachments/second.png' && r.trash[0].via === 'fileManager.trashFile', r.trash);
    ok('its embed line is removed from the note, the rest stays', !r.note.includes('second.png') && r.note.includes('Same image as a markdown link') && r.note.includes('The end.') && !/\n\n\n\n/.test(r.note), r.note);
    ok('editor goes on with the other image', (await ed(page, 'return e.file.name + " " + e.gallery.length')) === 'sample-edited.png 1');
    // cancel keeps everything
    await page.click('.pmp-content [aria-label="Delete image"]');
    await sleep(120);
    await choose(page, 'cancel');
    ok('Cancel keeps the image', (await page.evaluate(() => window.calls.trash.length)) === 1 && (await editorOpen(page)));
    // without asking, last image: editor closes
    await page.evaluate(() => { window.plugin.settings.confirmDelete = false; });
    await page.click('.pmp-content [aria-label="Delete image"]');
    await sleep(300);
    ok('deleting the last image closes the editor', !(await editorOpen(page)) && (await page.evaluate(() => window.calls.trash.length)) === 2);
    await page.evaluate(() => { window.plugin.settings.confirmDelete = true; });
  }

  // ---------------------------------------------------------------- settings tab
  if (!ONLY || ONLY === 'settings') {
    const tab = await page.evaluate(() => { window.settingTab.display(); const c = window.settingTab.containerEl; return { heads: [...c.querySelectorAll('.setting-item-heading')].map((h) => h.textContent), n: c.querySelectorAll('.setting-item').length }; });
    ok('settings tab: 6 sections with all settings', tab.heads.join('|') === 'General|Edit button on images|Drawing|Saving|Browsing images|Deleting' && tab.n >= 28, tab);
  }
  ok('no icons missing', (await page.evaluate(() => [...window.missingIcons])).length === 0, await page.evaluate(() => [...window.missingIcons]));
  ok('the vault was never listed', (await page.evaluate(() => window.calls.getFiles)) === 0);
  ok(`no console errors`, errors.length === 0, errors);
  await ctx.close();

  // ---------------------------------------------------------------- languages and migration
  {
    const c2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const p2 = await c2.newPage();
    const e2 = await setup(p2, '?lang=nl&settings=' + encodeURIComponent(JSON.stringify({ buttonPosition: 'top-right', color: '#00ff00', saveMode: 'copy' })));
    const s = await p2.evaluate(() => window.plugin.settings);
    ok('old settings: kept, but the button moves to the top left', s.buttonPosition === 'top-left' && s.color === '#00ff00' && s.saveMode === 'copy' && s.settingsVersion === 2, s);
    ok('migration is saved', await p2.evaluate(() => window.storedSettings.settingsVersion === 2 && window.storedSettings.buttonPosition === 'top-left'));
    await p2.hover('#embed-sample img', { position: { x: 200, y: 120 } });
    await sleep(100);
    ok('Dutch: the button says Bewerken', (await p2.$eval('.pmp-hover', (b) => b.textContent)) === 'Bewerken');
    await p2.click('.pmp-hover');
    await editorReady(p2);
    ok('Dutch editor', (await p2.$eval('.pmp-save', (b) => b.textContent)) === 'Opslaan' && (await p2.$eval('.pmp-hint', (h) => h.textContent)).startsWith('Sleep'));
    ok('Dutch: no console errors', e2.length === 0, e2);
    await c2.close();
    const c3 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const p3 = await c3.newPage();
    await setup(p3, '?lang=none');
    await p3.hover('#embed-sample img', { position: { x: 200, y: 120 } });
    await sleep(100);
    ok('without getLanguage(): language from moment (nl)', (await p3.$eval('.pmp-hover', (b) => b.textContent)) === 'Bewerken');
    await c3.close();
  }

  // ---------------------------------------------------------------- phone
  {
    const mctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: SHOTS ? 3 : 1 });
    const m = await mctx.newPage();
    const merrors = await setup(m);
    await m.tap('#embed-sample img');
    await sleep(150);
    const pos = await m.evaluate(() => { const b = document.querySelector('.pmp-hover').getBoundingClientRect(), i = document.querySelector('#embed-sample img').getBoundingClientRect(); return { vis: document.querySelector('.pmp-hover').classList.contains('is-visible'), left: Math.round(b.left - i.left), top: Math.round(b.top - i.top) }; });
    ok('phone: a tap shows the Edit button top left', pos.vis && pos.left === 8 && pos.top === 8, pos);
    await m.tap('.pmp-hover');
    await editorReady(m);
    const layout = await m.evaluate(() => { const r = document.querySelector('.modal.pmp-modal').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, scroll: document.querySelector('.pmp-content').scrollWidth <= document.querySelector('.pmp-content').clientWidth, label: getComputedStyle(document.querySelector('.pmp-tool .pmp-label')).display }; });
    ok('phone: editor fills the screen, icons only, nothing sticks out', layout.w === layout.vw && layout.h === layout.vh && layout.scroll && layout.label === 'none', layout);
    const fade = await m.evaluate(async () => { const b = document.querySelector('.pmp-toolbar'); const r1 = b.className; b.scrollLeft = b.scrollWidth; await new Promise((r) => setTimeout(r, 50)); const r2 = b.className; b.scrollLeft = 0; return [/more-right/.test(r1) && !/more-left/.test(r1), /more-left/.test(r2) && !/more-right/.test(r2)]; });
    ok('phone: the sideways toolbar fades where more tools are', fade[0] && fade[1], fade);
    // touch drag
    const a = await toPage(m, 300, 300), b = await toPage(m, 900, 600);
    const cdp = await mctx.newCDPSession(m);
    const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6, id: 1 }]);
    await touch('touchEnd', []);
    await sleep(100);
    ok('phone: a finger drag draws', (await marks(m)).length === 1);
    // pinch
    const z0 = await ed(m, 'return e.zoom');
    const c = await toPage(m, 700, 450);
    await touch('touchStart', [{ x: c.x - 30, y: c.y, id: 1 }, { x: c.x + 30, y: c.y, id: 2 }]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: c.x - 30 - i * 15, y: c.y, id: 1 }, { x: c.x + 30 + i * 15, y: c.y, id: 2 }]);
    await touch('touchEnd', []);
    await sleep(100);
    const z1 = await ed(m, 'return e.zoom');
    ok('phone: two fingers zoom in, no mark drawn', z1 > z0 * 1.5 && (await marks(m)).length === 1, [z0, z1]);
    await m.keyboard.press('0');
    await m.tap('.pmp-content [aria-label="Adjust"]');
    await sleep(100);
    const sheet = await m.evaluate(() => { const p = document.querySelector('.pmp-panel').getBoundingClientRect(); return { bottom: Math.round(p.bottom), w: Math.round(p.width), vh: innerHeight, vw: innerWidth }; });
    ok('phone: Adjust opens as a sheet from the bottom', Math.abs(sheet.bottom - sheet.vh) <= 1 && sheet.w >= sheet.vw - 2, sheet);
    if (SHOTS) {
      await m.screenshot({ path: path.join(DOCS, 'mobile-adjust.png') });
      await m.tap('.pmp-content [aria-label="Adjust"]');
      await sleep(100);
      await m.screenshot({ path: path.join(DOCS, 'mobile.png') });
    }
    await m.tap('.pmp-save');
    await m.waitForFunction(() => window.calls.modifyBinary.length === 1);
    ok('phone: saving works', true);
    ok('phone: no console errors', merrors.length === 0, merrors);
    await mctx.close();
  }

  // ---------------------------------------------------------------- a real-world edit (also the README result image)
  {
    const c4 = await browser.newContext({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    const p4 = await c4.newPage();
    const e4 = await setup(p4);
    await openFromButton(p4, '#embed-sample img');
    await p4.keyboard.press('r'); await drag(p4, 280, 722, 1362, 774);
    await p4.keyboard.press('n'); await clickAt(p4, 1362, 722);
    await p4.keyboard.press('b'); await drag(p4, 455, 120, 640, 150);
    await p4.keyboard.press('u'); await drag(p4, 455, 153, 600, 182);
    await p4.keyboard.press('p'); await drag(p4, 795, 728, 1000, 762);
    await p4.keyboard.press('e'); await drag(p4, 990, 122, 1142, 168);
    await p4.keyboard.press('t'); await clickAt(p4, 760, 790);
    await p4.keyboard.type('Unknown device, block it');
    await p4.keyboard.press('Enter');
    await p4.keyboard.press('a'); await drag(p4, 748, 812, 672, 774);
    await p4.keyboard.press('r');
    await shot(p4, 'editor.png', await modalClip(p4));
    await p4.click('.pmp-content [aria-label="Settings"]');
    await sleep(100);
    await shot(p4, 'settings.png', await modalClip(p4));
    await p4.click('.pmp-content [aria-label="Settings"]');
    await p4.keyboard.press('Control+s');
    await p4.waitForFunction(() => window.calls.modifyBinary.length === 1);
    // pixelated: only a few flat blocks left of the MAC address
    const pix = await saved(p4, [800, 730, 195, 30]);
    ok('pixelate: the hidden text is reduced to flat blocks', pix.colours <= 60, pix.colours);
    // blurred: no sharp edges left in the gateway address
    const edge = await p4.evaluate(async ([x0, y0, w, h]) => {
      const bm = await createImageBitmap(new Blob([window.lastSaved]));
      const c = new OffscreenCanvas(bm.width, bm.height); const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
      const d = x.getImageData(x0, y0, w, h).data; let max = 0;
      for (let yy = 0; yy < h; yy++) for (let xx = 1; xx < w; xx++) { const i = (yy * w + xx) * 4; max = Math.max(max, Math.abs(d[i] - d[i - 4]) + Math.abs(d[i + 1] - d[i - 3]) + Math.abs(d[i + 2] - d[i - 2])); }
      return max;
    }, [462, 158, 110, 18]);
    const orig = await p4.evaluate(async ([x0, y0, w, h]) => {
      const r = await fetch('vault/Attachments/sample.png'); const bm = await createImageBitmap(await r.blob());
      const c = new OffscreenCanvas(bm.width, bm.height); const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
      const d = x.getImageData(x0, y0, w, h).data; let max = 0;
      for (let yy = 0; yy < h; yy++) for (let xx = 1; xx < w; xx++) { const i = (yy * w + xx) * 4; max = Math.max(max, Math.abs(d[i] - d[i - 4]) + Math.abs(d[i + 1] - d[i - 3]) + Math.abs(d[i + 2] - d[i - 2])); }
      return max;
    }, [462, 158, 110, 18]);
    ok('blur: the sharp edges of the text are gone', edge < orig / 4, { blurred: edge, original: orig });
    ok('real-world edit: no console errors', e4.length === 0, e4);
    if (SHOTS) {
      const b64 = await p4.evaluate(() => { let s = ''; const u = new Uint8Array(window.lastSaved); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); });
      fs.writeFileSync(path.join(DOCS, 'result.png'), Buffer.from(b64, 'base64'));
    }
    await c4.close();
  }

  await browser.close();
  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
