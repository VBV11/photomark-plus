// Generates the fictional "router dashboard" screenshots used by the tests and the README
// (test/vault/Attachments/sample.png and second.png). All names, addresses and numbers are made up.
const { chromium } = require(process.env.PMP_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');

const draw = (ctx, variant) => {
  const W = 1400, H = 900;
  ctx.fillStyle = '#f3f4f6'; ctx.fillRect(0, 0, W, H);
  // top bar
  ctx.fillStyle = variant ? '#1f4d3a' : '#1e3a5f'; ctx.fillRect(0, 0, W, 64);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif'; ctx.fillText(variant ? 'Switch admin' : 'Router admin', 28, 40);
  ctx.font = '16px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText('Firmware 3.2.1  ·  Uptime 14 days', W - 330, 39);
  // sidebar
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 64, 240, H - 64);
  ctx.strokeStyle = '#e5e7eb'; ctx.beginPath(); ctx.moveTo(240.5, 64); ctx.lineTo(240.5, H); ctx.stroke();
  const menu = ['Dashboard', 'Devices', 'Wireless', 'Firewall', 'Port forwarding', 'VPN', 'Logs', 'System'];
  menu.forEach((m, i) => {
    const y = 110 + i * 52;
    if (i === 1) { ctx.fillStyle = '#e8eefc'; ctx.fillRect(12, y - 30, 216, 44); }
    ctx.fillStyle = i === 1 ? '#1e3a5f' : '#374151'; ctx.font = `${i === 1 ? 'bold ' : ''}17px sans-serif`; ctx.fillText(m, 36, y);
  });
  // cards
  const card = (x, y, w, h, title) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#e5e7eb'; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    ctx.fillStyle = '#111827'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(title, x + 20, y + 32);
  };
  card(272, 92, 540, 150, 'WAN');
  ctx.font = '15px sans-serif'; ctx.fillStyle = '#6b7280';
  ctx.fillText('Public address', 292, 140); ctx.fillText('Gateway', 292, 172); ctx.fillText('DNS', 292, 204);
  ctx.fillStyle = '#111827'; ctx.font = '16px monospace';
  ctx.fillText(variant ? '198.51.100.17' : '203.0.113.42', 460, 140); ctx.fillText('203.0.113.1', 460, 172); ctx.fillText('9.9.9.9, 1.1.1.1', 460, 204);
  card(836, 92, 532, 150, 'Status');
  const pill = (x, y, text, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y - 18, 130, 28, 14); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(text, x + 14, y + 1); };
  pill(856, 150, 'Internet OK', '#16a34a'); pill(1000, 150, 'VPN off', '#9ca3af'); pill(1144, 150, 'Firewall on', '#16a34a');
  ctx.fillStyle = '#6b7280'; ctx.font = '15px sans-serif'; ctx.fillText('CPU 7%   ·   Memory 41%   ·   Temperature 48 °C', 856, 206);
  card(272, 270, 1096, 560, 'Devices');
  const cols = [292, 560, 800, 1040, 1230];
  const head = ['Name', 'IP address', 'MAC address', 'Connection', 'Status'];
  ctx.fillStyle = '#6b7280'; ctx.font = 'bold 14px sans-serif'; head.forEach((h, i) => ctx.fillText(h.toUpperCase(), cols[i], 326));
  const rows = [
    ['server-01', '192.0.2.10', '02:00:00:aa:01:10', 'LAN 1 Gbit', 'online'],
    ['backup-nas', '192.0.2.11', '02:00:00:aa:01:11', 'LAN 1 Gbit', 'online'],
    ['printer-hall', '192.0.2.20', '02:00:00:aa:01:20', 'LAN 100 Mbit', 'online'],
    ['laptop-sam', '192.0.2.101', '02:00:00:aa:02:01', 'Wi-Fi 5 GHz', 'online'],
    ['phone-alex', '192.0.2.102', '02:00:00:aa:02:02', 'Wi-Fi 5 GHz', 'online'],
    ['thermostat', '192.0.2.150', '02:00:00:aa:03:50', 'Wi-Fi 2.4 GHz', 'offline'],
    ['smart-tv', '192.0.2.151', '02:00:00:aa:03:51', 'Wi-Fi 2.4 GHz', 'online'],
    ['unknown-device', '192.0.2.199', '02:00:00:aa:09:99', 'Wi-Fi 2.4 GHz', 'online'],
  ];
  rows.forEach((r, i) => {
    const y = 370 + i * 54;
    ctx.strokeStyle = '#f0f1f3'; ctx.beginPath(); ctx.moveTo(292, y + 18); ctx.lineTo(1348, y + 18); ctx.stroke();
    r.forEach((c, j) => {
      if (j === 4) { pill(cols[j], y, c, c === 'online' ? '#16a34a' : '#dc2626'); return; }
      ctx.fillStyle = j === 0 ? '#111827' : '#374151'; ctx.font = `${j === 1 || j === 2 ? '15px monospace' : '16px sans-serif'}`; ctx.fillText(c, cols[j], y);
    });
  });
};

(async () => {
  const out = path.join(__dirname, 'vault', 'Attachments');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(process.env.PMP_CHROME ? { executablePath: process.env.PMP_CHROME, args: ['--no-sandbox'] } : {});
  const page = await browser.newPage();
  await page.setContent('<canvas id="c" width="1400" height="900"></canvas>');
  for (const [name, variant] of [['sample.png', 0], ['second.png', 1]]) {
    const dataUrl = await page.evaluate(`(${draw.toString()})(document.getElementById('c').getContext('2d'), ${variant}), document.getElementById('c').toDataURL('image/png')`);
    fs.writeFileSync(path.join(out, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('wrote', path.join(out, name));
  }
  await browser.close();
})();
