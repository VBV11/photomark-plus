// End-to-end checks for PhotoMark+ in a headless browser with a mocked Obsidian API (test/mock-obsidian.js).
// Usage: node test/run.js [--shots]        (--shots also writes the README screenshots to docs/)
// Needs playwright (npm install) or PMP_PLAYWRIGHT=playwright-core with PMP_CHROME=<path to chromium>.
const { chromium, devices } = require(process.env.PMP_PLAYWRIGHT || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const SHOTS = process.argv.includes('--shots');
let failed = 0;
const ok = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failed++; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.md': 'text/markdown' };

// tiny static server for the repo root
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

const redPixels = (page) => page.evaluate(async () => {
  const bm = await createImageBitmap(new Blob([window.lastSaved]));
  const c = new OffscreenCanvas(bm.width, bm.height); const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
  const d = x.getImageData(0, 0, bm.width, bm.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] < 60 && d[i + 2] < 60) n++;
  return { n, w: bm.width, h: bm.height };
});
// how many distinct colours a region of the saved image has (pixelation should lower it a lot)
const colours = (page, region) => page.evaluate(async ([x0, y0, w, h]) => {
  const bm = await createImageBitmap(new Blob([window.lastSaved]));
  const c = new OffscreenCanvas(bm.width, bm.height); const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
  const d = x.getImageData(x0, y0, w, h).data; const s = new Set();
  for (let i = 0; i < d.length; i += 4) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return s.size;
}, region);

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/test/index.html`;
  const browser = await chromium.launch(process.env.PMP_CHROME ? { executablePath: process.env.PMP_CHROME, args: ['--no-sandbox'] } : {});
  if (SHOTS) fs.mkdirSync(DOCS, { recursive: true });

  // ---------------------------------------------------------------- desktop
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 860 }, deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.ready || window.loadError);
  ok('plugin loads', await page.evaluate(() => !window.loadError && !!window.plugin));
  if (await page.evaluate(() => window.loadError)) console.log(await page.evaluate(() => window.loadError));
  await page.waitForFunction(() => document.querySelector('#embed-sample img').naturalWidth > 0);
  const visible = () => page.$eval('.pmp-hover', (b) => b.classList.contains('is-visible'));

  // hover button
  await page.hover('#embed-sample img', { position: { x: 200, y: 120 } });
  await page.waitForTimeout(100);
  const pos = await page.evaluate(() => { const b = document.querySelector('.pmp-hover').getBoundingClientRect(), i = document.querySelector('#embed-sample img').getBoundingClientRect(); return { right: Math.round(i.right - b.right), top: Math.round(b.top - i.top), text: document.querySelector('.pmp-hover').textContent }; });
  ok(`Mark button appears top-right of a hovered image (${JSON.stringify(pos)})`, (await visible()) && pos.right === 8 && pos.top === 8 && pos.text === 'Mark');
  if (SHOTS) {
    const r = await (await page.$('#embed-sample img')).boundingBox();
    await page.screenshot({ path: path.join(DOCS, 'hover-button.png'), clip: { x: r.x - 40, y: 40, width: r.width + 80, height: 420 } });
  }
  const bb = await (await page.$('.pmp-hover')).boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(400);
  ok('button stays while the pointer is on it', await visible());
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  ok('button hides when the pointer leaves', !(await visible()));
  await page.evaluate(() => document.getElementById('external').scrollIntoView());
  await page.hover('#external');
  await page.waitForTimeout(100);
  ok('no button on an external image', !(await visible()));
  await page.hover('#plain');
  await page.waitForTimeout(100);
  ok('button on a markdown-link image resolved through its resource URL', await visible());
  await page.evaluate(() => { document.querySelector('.workspace-leaf-content').scrollTop = 0; });
  await page.waitForTimeout(100);
  await page.hover('#embed-sample img');
  await page.waitForTimeout(100);
  await page.evaluate(() => { document.querySelector('.workspace-leaf-content').scrollTop = 40; });
  await page.waitForTimeout(100);
  ok('button hides on scroll', !(await visible()));
  await page.evaluate(() => { document.querySelector('.workspace-leaf-content').scrollTop = 0; });
  await page.mouse.move(600, 300, { steps: 3 });
  await page.waitForTimeout(100);
  ok('button comes back when the pointer moves again', await visible());
  await page.evaluate(() => { window.plugin.settings.buttonPosition = 'bottom-left'; });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(350);
  await page.hover('#embed-sample img', { position: { x: 200, y: 120 } });
  await page.waitForTimeout(100);
  const corner = await page.evaluate(() => { const b = document.querySelector('.pmp-hover').getBoundingClientRect(), i = document.querySelector('#embed-sample img').getBoundingClientRect(); return { left: Math.round(b.left - i.left), bottom: Math.round(i.bottom - b.bottom) }; });
  ok(`button corner setting works (bottom-left: ${JSON.stringify(corner)})`, corner.left === 8 && corner.bottom === 8);
  await page.evaluate(() => { window.plugin.settings.buttonPosition = 'top-right'; });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(350);
  await page.mouse.move(600, 300, { steps: 3 });
  await page.waitForTimeout(100);

  // editor
  await page.click('.pmp-hover');
  await page.waitForFunction(() => { const c = document.querySelector('.pmp-canvas'); return c && c.width > 100 && c.style.width; });
  await page.waitForTimeout(150);
  const c = await (await page.$('.pmp-canvas')).boundingBox();
  const states = () => page.$$eval('.pmp-actions button', (a) => a.map((b) => (b.disabled ? 0 : 1)).join(''));
  ok(`editor opens, undo/clear/save disabled until something is drawn (${await states()})`, (await states()) === '0010');
  const drag = async (x1, y1, x2, y2) => { await page.mouse.move(c.x + x1, c.y + y1); await page.mouse.down(); await page.mouse.move(c.x + (x1 + x2) / 2, c.y + (y1 + y2) / 2, { steps: 3 }); await page.mouse.move(c.x + x2, c.y + y2, { steps: 3 }); await page.mouse.up(); };
  const active = () => page.$eval('.pmp-tool.is-active', (b) => b.dataset.tool);
  // tools via keyboard: R E A N P
  await drag(c.width * 0.22, c.height * 0.11, c.width * 0.56, c.height * 0.26); // rectangle around WAN card
  await page.keyboard.press('e'); ok(`E selects ellipse (${await active()})`, (await active()) === 'ellipse');
  await drag(c.width * 0.21, c.height * 0.37, c.width * 0.42, c.height * 0.46);
  await page.keyboard.press('a'); ok(`A selects arrow (${await active()})`, (await active()) === 'arrow');
  await drag(c.width * 0.72, c.height * 0.9, c.width * 0.86, c.height * 0.83);
  await page.keyboard.press('n'); ok(`N selects number (${await active()})`, (await active()) === 'number');
  await page.mouse.click(c.x + c.width * 0.19, c.y + c.height * 0.185);
  await page.mouse.click(c.x + c.width * 0.19, c.y + c.height * 0.415);
  await page.keyboard.press('p'); ok(`P selects pixelate (${await active()})`, (await active()) === 'pixelate');
  await drag(c.width * 0.325, c.height * 0.135, c.width * 0.47, c.height * 0.175); // hide the public address
  await page.keyboard.press('r'); ok(`R selects rectangle (${await active()})`, (await active()) === 'rect');
  await drag(c.width * 0.3, c.height * 0.3, c.width * 0.302, c.height * 0.302); // a click without dragging: no mark
  ok(`actions enabled after drawing (${await states()})`, (await states()) === '1111');
  await page.keyboard.press('Control+z'); // removes the pixelation
  await page.keyboard.press('Control+z'); // and marker 2
  await page.keyboard.press('n');
  await page.mouse.click(c.x + c.width * 0.19, c.y + c.height * 0.415);
  await page.keyboard.press('p');
  await drag(c.width * 0.325, c.height * 0.135, c.width * 0.47, c.height * 0.175);
  ok('Ctrl+Z undoes and the editor stays open', !!(await page.$('.pmp-canvas')));
  if (SHOTS) await page.screenshot({ path: path.join(DOCS, 'editor.png') });

  // discard protection
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  ok('Esc with marks asks for confirmation', (await page.$$('.modal')).length === 2 && !!(await page.$('.modal-button-container')));
  if (SHOTS) {
    const r = await (await page.$('.modal-button-container')).boundingBox();
    await page.screenshot({ path: path.join(DOCS, 'discard.png'), clip: { x: r.x - 60, y: r.y - 190, width: 620, height: 300 } });
  }
  await page.click('.modal-button-container .mod-cta');
  await page.waitForTimeout(100);
  ok('"Keep editing" returns to the editor', (await page.$$('.modal')).length === 1 && !!(await page.$('.pmp-canvas')));
  await page.mouse.click(4, 4);
  await page.waitForTimeout(100);
  ok('clicking outside also asks first', (await page.$$('.modal')).length === 2);
  await page.keyboard.press('Escape'); // closes the confirmation = keep editing
  await page.waitForTimeout(100);
  ok('Esc on the confirmation keeps editing', (await page.$$('.modal')).length === 1 && !!(await page.$('.pmp-canvas')));

  // save (overwrite)
  const before = await page.evaluate(() => document.querySelector('#embed-sample img').src);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.pmp-canvas'), null, { timeout: 8000 });
  const saved = await page.evaluate(() => ({ calls: window.calls.modifyBinary, notice: window.calls.notices.at(-1), src: document.querySelector('#embed-sample img').src }));
  const px = await redPixels(page);
  ok(`Enter saves over the original (${JSON.stringify(saved.calls)}, notice "${saved.notice}")`, saved.calls.length === 1 && saved.calls[0].path === 'Attachments/sample.png');
  ok(`saved image keeps its size and has red marks (${px.w}x${px.h}, ${px.n} red pixels)`, px.w === 1400 && px.h === 900 && px.n > 3000);
  const flat = await colours(page, [470, 125, 180, 30]);
  ok(`public address is pixelated (${flat} colours in that area)`, flat < 60);
  ok('embedded image on the page is refreshed', saved.src !== before && saved.src.endsWith('?1001'));
  if (SHOTS) {
    const b64 = await page.evaluate(() => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(new Blob([window.lastSaved])); }));
    fs.writeFileSync(path.join(DOCS, 'result.png'), Buffer.from(b64, 'base64'));
  }

  // save as copy + link update
  await page.evaluate(() => { window.plugin.settings.saveMode = 'copy'; });
  await page.hover('#embed-sample img');
  await page.waitForTimeout(100);
  await page.click('.pmp-hover');
  await page.waitForFunction(() => { const c = document.querySelector('.pmp-canvas'); return c && c.width > 100 && c.style.width; });
  await page.waitForTimeout(150);
  await drag(60, 60, 240, 160);
  await page.click('.pmp-save');
  await page.waitForFunction(() => !document.querySelector('.pmp-canvas'), null, { timeout: 8000 });
  const copy = await page.evaluate(() => ({ created: window.calls.createBinary, note: window.texts['Network setup.md'], notice: window.calls.notices.at(-1), modify: window.calls.modifyBinary.length }));
  ok(`copy mode creates sample-marked.png and leaves the original alone (${JSON.stringify(copy.created)})`, copy.created.length === 1 && copy.created[0].path === 'Attachments/sample-marked.png' && copy.modify === 1);
  ok(`both links in the note now point at the copy (notice "${copy.notice}")`, copy.note.includes('![[Attachments/sample-marked.png|500]]') && copy.note.includes('![dashboard](Attachments/sample-marked.png)') && copy.note.includes('![[second.png]]') && copy.notice.includes('2 links'));
  await page.evaluate(() => { window.plugin.settings.saveMode = 'overwrite'; });

  // menus, command, picker
  const menus = await page.evaluate(() => {
    const titles = [];
    const menu = { addItem: (cb) => { const it = { setTitle(t) { titles.push(t); return it; }, setIcon() { return it; }, onClick() { return it; } }; cb(it); } };
    window.handlers['file-menu'][0](menu, window.files[0]);
    window.handlers['file-menu'][0](menu, window.files[2]); // a note: nothing added
    window.handlers['editor-menu'][0](menu, { getLine: () => 'see ![[sample.png|300]] and ![x](Attachments/second.png) and ![[Other.md]]', getCursor: () => ({ line: 0 }) }, { file: window.files[2] });
    return titles;
  });
  ok(`context menus (${JSON.stringify(menus)})`, menus.join('|') === 'Mark image|Mark image: sample.png|Mark image: second.png');
  await page.evaluate(() => { window.cursorLine = 'no image here'; window.calls.commands[0].callback(); });
  await page.waitForTimeout(200);
  ok('command with several images in the note opens a picker', !!(await page.$('.prompt .suggestion-item')));
  await page.click('.prompt .suggestion-item:nth-child(2)');
  await page.waitForFunction(() => { const c = document.querySelector('.pmp-canvas'); return c && c.width > 100; });
  ok('picking an image opens the editor', (await page.$eval('.pmp-filename', (e) => e.textContent)) === 'second.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  ok('Esc without marks closes immediately', !(await page.$('.pmp-canvas')));
  await page.evaluate(() => { window.cursorLine = 'look at ![[second.png]]'; window.calls.commands[0].callback(); });
  await page.waitForFunction(() => { const c = document.querySelector('.pmp-canvas'); return c && c.width > 100; });
  ok('command opens the image on the cursor line directly', (await page.$eval('.pmp-filename', (e) => e.textContent)) === 'second.png');
  await page.keyboard.press('Escape');

  // settings tab renders
  const settingsCount = await page.evaluate(() => { window.settingTab.display(); return window.settingTab.containerEl.querySelectorAll('.setting-item').length; });
  ok(`settings tab renders (${settingsCount} settings)`, settingsCount === 7);
  const lang = await page.evaluate(() => { window.plugin.settings.language = 'nl'; window.plugin.applyLanguage(); const a = [document.querySelector('.pmp-hover').textContent, window.calls.commands.at(-1).name]; window.plugin.settings.language = 'auto'; window.plugin.applyLanguage(); a.push(document.querySelector('.pmp-hover').textContent); return a; });
  ok(`language setting switches texts (${lang.join(' / ')})`, lang[0] === 'Markeren' && lang[1] === 'Afbeelding markeren' && lang[2] === 'Mark');
  ok(`no console errors (${JSON.stringify(errors)})`, errors.length === 0);

  // Dutch interface
  const nl = await ctx.newPage();
  await nl.goto(`${base}?lang=nl`);
  await nl.waitForFunction(() => window.ready || window.loadError);
  ok('Dutch strings when Obsidian runs in Dutch', (await nl.$eval('.pmp-hover', (b) => b.textContent)) === 'Markeren' && (await nl.evaluate(() => window.calls.commands[0].name)) === 'Afbeelding markeren');
  await ctx.close();

  // ---------------------------------------------------------------- phone
  const mctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: SHOTS ? 2 : 1 });
  const m = await mctx.newPage();
  const merrors = [];
  m.on('pageerror', (e) => merrors.push(e.message));
  await m.goto(base);
  await m.waitForFunction(() => window.ready && document.querySelector('#embed-sample img').naturalWidth > 0);
  await m.tap('#embed-sample img');
  await m.waitForTimeout(600);
  ok('phone: tapping an image shows the button', await m.$eval('.pmp-hover', (b) => b.classList.contains('is-visible')));
  await m.tap('.pmp-hover');
  await m.waitForFunction(() => { const c = document.querySelector('.pmp-canvas'); return c && c.width > 100 && c.style.width; });
  await m.waitForTimeout(200);
  const mc = await (await m.$('.pmp-canvas')).boundingBox();
  const cdp = await mctx.newCDPSession(m);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', mc.x + mc.width * 0.22, mc.y + mc.height * 0.11);
  for (let i = 1; i <= 6; i++) await touch('touchMove', mc.x + mc.width * (0.22 + i * 0.055), mc.y + mc.height * (0.11 + i * 0.025));
  await touch('touchEnd');
  await m.waitForTimeout(150);
  ok('phone: a touch drag draws a mark', (await m.$eval('.pmp-save', (b) => !b.disabled)));
  ok('phone: toolbar shows icons only', (await m.$eval('.pmp-tool .pmp-label', (e) => getComputedStyle(e).display)) === 'none');
  if (SHOTS) await m.screenshot({ path: path.join(DOCS, 'mobile.png') });
  await m.tap('.pmp-save');
  await m.waitForFunction(() => !document.querySelector('.pmp-canvas'), null, { timeout: 8000 });
  ok('phone: saving works', (await m.evaluate(() => window.calls.modifyBinary.length)) === 1);
  await m.tap('#embed-sample img');
  await m.waitForTimeout(5600);
  ok('phone: button disappears again after a few seconds', !(await m.$eval('.pmp-hover', (b) => b.classList.contains('is-visible'))));
  ok(`phone: no console errors (${JSON.stringify(merrors)})`, merrors.length === 0);
  await mctx.close();

  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
