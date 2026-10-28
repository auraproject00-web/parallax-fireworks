// Screenshot + cek model dan angka HUD vs sim.js.
// Jalankan: node test/shoot.js   (three.js dilayani dari ./vendor bila CDN tak terjangkau)
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch { pw = require('/home/claude/.npm-global/lib/node_modules/playwright'); }
const S = require('../sim.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const URL = 'file://' + path.join(ROOT, 'index.html');
const VENDOR = {
  'build/three.min.js': 'three.min.js',
  'examples/js/controls/OrbitControls.js': 'OrbitControls.js',
  'examples/js/loaders/TGALoader.js': 'TGALoader.js',
  'examples/js/loaders/ColladaLoader.js': 'ColladaLoader.js'
};
// ukuran model mentah dari loader tanpa modifikasi apa pun (mm)
const RAW = { size: [116.4, 156.4, 304], center: [23.8, 65.9, -99.1] };

const fails = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? '  — ' + detail : ''}`); if (!ok) fails.push(name); };
const num = (s) => parseFloat(String(s).replace(',', '.'));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const run = async (viewport, label, fn) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/(.*)$/, (route) => {
      const f = VENDOR[route.request().url().split('three@0.128.0/')[1]];
      if (f) route.fulfill({ path: path.join(ROOT, 'vendor', f), contentType: 'application/javascript' }); else route.continue();
    });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto(URL);
    await page.waitForFunction(() => window.__jig, null, { timeout: 15000 });
    await page.evaluate(() => window.__jig.ready);
    await page.waitForTimeout(800);
    await fn(page);
    // tekstur yang hilang memang diharapkan gagal dimuat; error lain tidak
    const real = errors.filter((e) => !/ERR_FILE_NOT_FOUND|404|Failed to load resource/.test(e) && !/THREE\.ColladaLoader.*texture/i.test(e));
    check(`${label}: tanpa error skrip`, real.length === 0, real.slice(0, 3).join(' | '));
    await ctx.close();
  };
  const hud = (page) => page.evaluate(() => {
    const t = (id) => document.getElementById(id).textContent.trim();
    return { turns: t('o-turns'), rpmA: t('o-rpmA'), rpmB: t('o-rpmB'), mesh: t('o-mesh'), vp: t('o-vp'), rim: t('o-rim'), mod: t('o-mod'), ratio: t('o-ratio'), status: t('status'), clamp: t('o-clamp') };
  });

  await run({ width: 1366, height: 820 }, 'desktop', async (page) => {
    const info = await page.evaluate(() => window.__jig.info());
    check('handwheel kaca ditemukan (2 mesh)', info.found.handwheelMeshes === 2, info.found.handwheelMeshes);
    for (const g of ['group_57', 'group_60', 'group_28', 'group_30', 'group_32', 'group_62']) check(`part ${g} ditemukan`, info.found[g] === true);
    const size = info.box.max.map((v, i) => v - info.box.min[i]);
    const ctr = info.box.max.map((v, i) => (v + info.box.min[i]) / 2);
    check('ukuran model sama dengan file mentah', size.every((v, i) => Math.abs(v - RAW.size[i]) < 0.15), size.map((v) => v.toFixed(1)).join(' × '));
    check('posisi model sama dengan file mentah', ctr.every((v, i) => Math.abs(v - RAW.center[i]) < 0.15), ctr.map((v) => v.toFixed(1)).join(', '));
    const ax = await page.evaluate(() => window.__jig.axisWorld());
    check('poros A di (29,67; 108,12) sepanjang Z', Math.abs(ax.A.pos[0] - 29.67) < 0.01 && Math.abs(ax.A.pos[1] - 108.12) < 0.01 && Math.abs(Math.abs(ax.A.dir[2]) - 1) < 1e-3, JSON.stringify(ax.A));
    check('poros B di (29,67; 119,02)', Math.abs(ax.B.pos[1] - 119.02) < 0.01, JSON.stringify(ax.B));
    check('poros bobbin di (29,62; 129,46)', Math.abs(ax.C.pos[0] - 29.62) < 0.01 && Math.abs(ax.C.pos[1] - 129.46) < 0.01, JSON.stringify(ax.C));
    check('engsel klem di (56,5; 123,2)', Math.abs(ax.K.pos[0] - 56.5) < 0.01 && Math.abs(ax.K.pos[1] - 123.2) < 0.01, JSON.stringify(ax.K));
    console.log('     tekstur pengganti:', info.fallbacks.join(', ') || '-');

    const v = await page.evaluate(() => {
      const src = document.querySelector('#stage canvas'); const c = document.createElement('canvas'); c.width = 160; c.height = 100;
      const g = c.getContext('2d'); g.drawImage(src, 0, 0, 160, 100); const d = g.getImageData(0, 0, 160, 100).data; const set = new Set();
      for (let i = 0; i < d.length; i += 4) set.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
      return set.size;
    });
    check('kanvas 3D tergambar', v > 40, v + ' warna');
    await page.screenshot({ path: path.join(OUT, '01-tampak-a.png') });

    await page.evaluate(() => { window.__jig.frozen = true; window.__jig.start(); });
    const r = await page.evaluate(() => window.__jig.advance(20.25));   // 30 rpm → 10,125 putaran
    const h = await hud(page);
    check('putaran = 10 setelah 20,25 s @30 rpm', h.turns === '10', h.turns);
    check('rpm handwheel 30', num(h.rpmA) === 30, h.rpmA);
    check('rpm gear atas 30', num(h.rpmB) === 30, h.rpmB);
    check('rasio 1 : 1', h.ratio === '1 : 1', h.ratio);
    check('modul 1.09', num(h.mod) === 1.09, h.mod);
    check('mesh 5.0 Hz', num(h.mesh) === 5, h.mesh);
    check('v pitch = ω·5,45', Math.abs(num(h.vp) - Math.PI * 5.45) < 0.06, h.vp);
    check('v tepi handwheel = ω·30', Math.abs(num(h.rim) - Math.PI * 30) < 0.6, h.rim);
    const pa = await page.evaluate(() => window.__jig.pivotAngles());
    check('sudut poros A = sim', Math.abs(wrap(pa.A - r.thetaA)) < 1e-4, `${pa.A.toFixed(4)} vs ${wrap(r.thetaA).toFixed(4)}`);
    check('gear atas berlawanan arah', Math.abs(wrap(pa.B + pa.A)) < 1e-4, `${pa.B.toFixed(4)}`);
    check('bobbin berputar searah handwheel', Math.abs(wrap(pa.C - pa.A)) < 1e-4 && Math.abs(pa.C) > 0.1, `${pa.C.toFixed(4)}`);
    const hb = await page.evaluate(() => ({ rpmC: document.getElementById('o-rpmC').textContent, bob: document.getElementById('o-bob').textContent }));
    check('rpm bobbin 30', num(hb.rpmC) === 30, hb.rpmC);
    check('putaran bobbin 10.1', hb.bob === '10.1', hb.bob);
    // lilitan setelah 10,125 putaran bobbin, kawat 0,2 mm, 20 lilitan per alur
    const cfg = S.create().cfg, wexp = S.winding(cfg, 10.125);
    const hw = await page.evaluate(() => { const t = (id) => document.getElementById(id).textContent.trim(); return { slot: t('o-slot'), layer: t('o-layer'), build: t('o-build'), len: t('o-len') }; });
    check('alur aktif 1', num(hw.slot) === 1, hw.slot);
    check('lapisan 2 (6 lilitan per lapis)', num(hw.layer) === wexp.layer && wexp.layer === 2, hw.layer);
    check('Ø tumpukan = sim', Math.abs(num(hw.build) - wexp.buildD) < 0.006, `${hw.build} vs ${wexp.buildD.toFixed(2)}`);
    check('kawat terpakai = sim', Math.abs(num(hw.len) - wexp.lengthM) < 0.0006, `${hw.len} vs ${wexp.lengthM.toFixed(3)}`);
    const cs = await page.evaluate(() => window.__jig.coilState());
    check('hanya kumparan alur 1 terlihat', cs.visible[0] && cs.visible.slice(1).every((v) => !v), JSON.stringify(cs.visible));
    check('radius kumparan = sim', Math.abs(cs.radius[0] - wexp.radii[0]) < 1e-6, cs.radius[0].toFixed(3));
    const [z0, z1] = S.MODEL.slots[0];
    check('kawat masuk di dalam alur 1', cs.strandEnd[2] >= z0 && cs.strandEnd[2] <= z1, cs.strandEnd[2].toFixed(3));
    check('ujung kawat menempel di kumparan', Math.abs(Math.hypot(cs.strandEnd[0] - 29.62, cs.strandEnd[1] - 129.46) - (wexp.radii[0] + 0.1)) < 0.01);
    check('kumparan ikut berputar dengan bobbin', Math.abs(wrap(cs.rot - r.thetaC)) < 1e-6);
    await page.screenshot({ path: path.join(OUT, '02-berputar.png') });
    await page.evaluate(() => window.__jig.setView('bobbin'));
    await page.screenshot({ path: path.join(OUT, '02b-bobbin-melilit.png') });
    await page.evaluate(() => window.__jig.setView('a'));

    await page.evaluate(() => window.__jig.setView('gear'));
    await page.screenshot({ path: path.join(OUT, '03-gear-tembus.png') });
    await page.evaluate(() => window.__jig.setView('b'));
    await page.screenshot({ path: path.join(OUT, '04-tampak-b.png') });
    await page.evaluate(() => window.__jig.setView('full'));
    await page.screenshot({ path: path.join(OUT, '05-penuh.png') });

    // satu putaran penuh mengembalikan model ke bentuk semula
    await page.evaluate(() => { const s = window.__jig.sim; s.thetaIn = Math.PI * 2 * 3; window.__jig.advance(0); });
    const back = await page.evaluate(() => window.__jig.liveBox());
    const bs = back.max.map((v, i) => v - back.min[i]);
    check('ukuran model sama setelah 3 putaran penuh', bs.every((v, i) => Math.abs(v - RAW.size[i]) < 0.15), bs.map((v) => v.toFixed(1)).join(' × '));

    // berhenti saat 7 alur × 5 lilitan penuh
    await page.fill('#i-tps', '5'); await page.dispatchEvent('#i-tps', 'change');
    await page.evaluate(() => { window.__jig.sim.running = true; });
    await page.evaluate(() => window.__jig.advance(120));
    const d = await hud(page);
    check('berhenti di 35 lilitan (7 × 5)', d.turns === '35', d.turns);
    check('status Selesai', d.status === 'Selesai', d.status);
    const wfull = await page.evaluate(() => window.__jig.coilState());
    check('ketujuh kumparan terlihat', wfull.visible.filter(Boolean).length === 7, JSON.stringify(wfull.visible));
    await page.evaluate(() => window.__jig.setView('bobbin'));
    await page.screenshot({ path: path.join(OUT, '05b-bobbin-penuh.png') });

    // interlock klem + engsel berputar
    await page.click('#b-reset');
    await page.click('#b-clamp');
    await page.evaluate(() => { window.__jig.sim.running = true; });
    await page.evaluate(() => window.__jig.advance(5));
    const k = await hud(page);
    check('klem terbuka: putaran tetap 0', k.turns === '0', k.turns);
    check('status Klem terbuka', k.status === 'Klem terbuka', k.status);
    const pc = await page.evaluate(() => window.__jig.pivotAngles().K);
    check('klem membuka 0,35 rad', Math.abs(pc + 0.35) < 0.01, pc.toFixed(3));
    await page.evaluate(() => window.__jig.setView('a'));
    await page.screenshot({ path: path.join(OUT, '06-klem-buka.png') });
  });

  await run({ width: 390, height: 844 }, 'mobile', async (page) => {
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('ponsel: tidak scroll horizontal', ov <= 0, 'overflow ' + ov + 'px');
    await page.screenshot({ path: path.join(OUT, '07-ponsel.png'), fullPage: true });
  });

  await browser.close();
  console.log(fails.length ? `\n${fails.length} gagal` : '\nsemua cek lolos');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
