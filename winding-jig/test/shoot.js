// Screenshot + cek angka HUD vs modul simulasi.
// Jalankan: node test/shoot.js   (butuh playwright; three.js dilayani dari ./vendor bila CDN tak terjangkau)
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(process.env.HOME, '.npm-global/lib/node_modules/playwright')); }
const S = require('../sim.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const URL = 'file://' + path.join(ROOT, 'index.html');
const VENDOR = {
  'build/three.min.js': path.join(ROOT, 'vendor/three.min.js'),
  'examples/js/controls/OrbitControls.js': path.join(ROOT, 'vendor/OrbitControls.js')
};

const fails = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`); if (!ok) fails.push(name); };
const num = (s) => parseFloat(String(s).replace(',', '.'));

(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const run = async (viewport, label, fn) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/(.*)$/, (route) => {
      const rel = route.request().url().split('three@0.128.0/')[1];
      const f = VENDOR[rel];
      if (f && fs.existsSync(f)) route.fulfill({ path: f, contentType: 'application/javascript' });
      else route.continue();
    });
    // font CDN tak terjangkau di sandbox: jawab dengan CSS kosong agar fallback dipakai tanpa error
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto(URL);
    await page.waitForFunction(() => window.__jig && window.__jig.readout, null, { timeout: 15000 });
    await page.waitForTimeout(400);
    await fn(page);
    check(`${label}: tanpa error konsol`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  };
  const hud = (page) => page.evaluate(() => {
    const t = (id) => document.getElementById(id).textContent.trim();
    return { turns: t('o-turns'), rpmA: t('o-rpmA'), rpmB: t('o-rpmB'), rpmC: t('o-rpmC'), mesh: t('o-mesh'), vp: t('o-vp'),
      layer: t('o-layer'), build: t('o-build'), len: t('o-len'), trav: t('o-trav'), status: t('status'), ratio: t('o-ratio') };
  });
  const canvasVariance = (page) => page.evaluate(() => {
    const src = document.querySelector('#stage canvas'); const c = document.createElement('canvas'); c.width = 160; c.height = 100;
    const g = c.getContext('2d'); g.drawImage(src, 0, 0, 160, 100); const d = g.getImageData(0, 0, 160, 100).data;
    const set = new Set(); let dark = 0;
    for (let i = 0; i < d.length; i += 4) { set.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3)); if (d[i] + d[i + 1] + d[i + 2] < 120) dark++; }
    return { colors: set.size, darkFrac: dark / (d.length / 4) };
  });

  await run({ width: 1366, height: 820 }, 'desktop', async (page) => {
    const v = await canvasVariance(page);
    check('kanvas 3D tergambar (bukan kosong)', v.colors > 40 && v.darkFrac > 0.005, JSON.stringify(v));
    await page.screenshot({ path: path.join(OUT, '01-iso-idle.png') });

    // 10 detik @ 40 rpm
    await page.evaluate(() => { window.__jig.start(); });
    const r = await page.evaluate(() => window.__jig.advance(10));
    const h = await hud(page);
    const cfg = S.create().cfg;
    const expLen = S.wireLengthPerSlot(cfg, 20) * cfg.slots / 1000;
    check('lilitan = 20 setelah 10 s', h.turns === '20', h.turns);
    check('readout sim = 20', Math.abs(r.turns - 20) < 1e-6, r.turns);
    check('rpm A = 40', num(h.rpmA) === 40, h.rpmA);
    check('rpm B = 120', num(h.rpmB) === 120, h.rpmB);
    check('rpm C = 80', num(h.rpmC) === 80, h.rpmC);
    check('rasio 1 : 3', h.ratio === '1 : 3', h.ratio);
    check('mesh 32.0 Hz', num(h.mesh) === 32, h.mesh);
    check('v pitch = ω·r', Math.abs(num(h.vp) - 40 * 2 * Math.PI / 60 * 36) < 0.06, h.vp);
    check('lapisan 2', num(h.layer) === 2, h.layer);
    check('Ø tumpukan 16.0', num(h.build) === 16, h.build);
    check('panjang kawat sesuai sim Node', Math.abs(num(h.len) - expLen) < 0.006, `${h.len} vs ${expLen.toFixed(3)}`);
    check('sisir = traverse(20)', Math.abs(num(h.trav) - S.traverse(cfg, 20)) < 0.06, h.trav);
    check('status Melilit', h.status === 'Melilit', h.status);
    // sudut gear di adegan = sudut dari sim
    const ang = await page.evaluate(() => { const r = window.__jig.readout(); return r; });
    check('thetaB = meshAngle(thetaA)', Math.abs(ang.thetaB - S.meshAngle(ang.thetaA, 48, 16, Math.PI / 2)) < 1e-9);
    await page.screenshot({ path: path.join(OUT, '02-iso-winding.png') });

    await page.evaluate(() => window.__jig.setView('gear'));
    await page.screenshot({ path: path.join(OUT, '03-gear.png') });
    await page.evaluate(() => window.__jig.setView('bobbin'));
    await page.screenshot({ path: path.join(OUT, '04-bobbin.png') });

    // lanjut sampai target 150
    await page.evaluate(() => window.__jig.advance(120));
    const d = await hud(page);
    check('berhenti di 150', d.turns === '150', d.turns);
    check('status Selesai', d.status === 'Selesai', d.status);
    check('rpm B = 0 saat selesai', num(d.rpmB) === 0, d.rpmB);
    check('panjang akhir sesuai sim', Math.abs(num(d.len) - S.wireLengthPerSlot(cfg, 150) * 4 / 1000) < 0.006, d.len);
    await page.screenshot({ path: path.join(OUT, '05-bobbin-full.png') });

    // interlock klem
    await page.click('#b-reset');
    await page.click('#b-clamp');
    await page.evaluate(() => { const s = window.__jig.sim; s.running = true; });
    await page.evaluate(() => window.__jig.advance(5));
    const k = await hud(page);
    check('klem terbuka: lilitan tetap 0', k.turns === '0', k.turns);
    check('status Klem terbuka', k.status === 'Klem terbuka', k.status);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, '06-clamp-open.png') });
  });

  await run({ width: 390, height: 844 }, 'mobile', async (page) => {
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('ponsel: tidak scroll horizontal', ov <= 0, 'overflow ' + ov + 'px');
    await page.screenshot({ path: path.join(OUT, '07-mobile.png'), fullPage: true });
  });

  await browser.close();
  console.log(fails.length ? `\n${fails.length} gagal` : '\nsemua cek lolos');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
