// Rekam simulasi jadi video MP4 (1080p, 30 fps) dengan suara sintesis.
//   node tools/record.js                → video/winding-jig.mp4
//   node tools/record.js --preview      → pratinjau cepat: tiap 15 frame, tanpa supersampling (video/preview-*.jpg)
// Frame dirender satu per satu dengan waktu simulasi terkunci (tick 1/30 s), jadi hasilnya mulus
// walau render di mesin ini lambat. Suara dihitung dari kejadian simulasi yang sama (sim.js).
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
let pw;
try { pw = require('playwright'); } catch { pw = require('/home/claude/.npm-global/lib/node_modules/playwright'); }
const S = require('../sim.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'video');
const PREVIEW = process.argv.includes('--preview');
const FPS = 30, W = 1920, H = 1080, SS = PREVIEW ? 1 : 1.5;       // supersampling → anti-alias saat diperkecil
const RPM = 90, TPS = 20, SPW = 3;
const VENDOR = { 'build/three.min.js': 'three.min.js', 'examples/js/controls/OrbitControls.js': 'OrbitControls.js',
  'examples/js/loaders/TGALoader.js': 'TGALoader.js', 'examples/js/loaders/ColladaLoader.js': 'ColladaLoader.js' };

// ---------- garis waktu ----------
const cfg = S.create({ rpmIn: RPM, turnsPerSlot: TPS, slotsPerWire: SPW }).cfg;
const T_START = 2.0;                                   // tombol mulai ditekan
const bps = RPM / 60;                                  // putaran bobbin per detik (rasio 1 : 1)
const NB_DONE = S.totalTurns(cfg);
const T_DONE = T_START + NB_DONE / bps;
const crossT = (k) => { const g = S.schedule(cfg, 0)[2 * k + 1]; return T_START + (g.ws + S.CROSS.w * 0.4) / bps; };
const T_X1 = crossT(0), T_X2 = crossT(1);
const T_CLAMP = T_DONE + 3.2, T_END = T_DONE + 6.5;
const DUR = T_END;

// ---------- storyboard kamera ----------
const V3 = { add: (a, b) => a.map((v, i) => v + b[i]), sub: (a, b) => a.map((v, i) => v - b[i]), mul: (a, k) => a.map((v) => v * k),
  len: (a) => Math.hypot(...a), norm: (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); }, lerp: (a, b, t) => a.map((v, i) => v + (b[i] - v) * t) };
const yaw = (d, deg) => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c]; };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const pose = (dir, tgt, dist) => ({ pos: V3.add(tgt, V3.mul(V3.norm(dir), dist)), tgt });
const SHOTS = [
  { view: 'a', t0: 0, t1: 7.2, at: (u) => pose(yaw([0.55, 0.62, 1], -18 + 30 * u), [38, 105, -8], 300 - 50 * u) },
  { view: 'gear', t0: 8.0, t1: 12.2, at: (u) => pose(yaw([0.5, 0.3, 1], 12 - 20 * u), [30, 113.5, 6], 95 - 20 * u) },
  { view: 'bobbin', t0: 13.8, t1: T_X1 - 1.6, at: (u) => pose(yaw([-0.35, 1, 0.25], -10 + 10 * u), [29.6, 132, -3], 64 - 4 * u) },
  { view: 'bobbin', t0: T_X1 - 0.8, t1: T_X1 + 1.8, at: (u) => pose(yaw([-0.45, 1, 0.35], -4 + 8 * u), [29.6, 135, -3], 36) },
  { view: 'bobbin', t0: T_X1 + 2.6, t1: T_X2 - 1.6, at: (u) => pose(yaw([-0.35, 1, 0.25], 25 * u), [29.6, 132, -3], 60 - 4 * u) },
  { view: 'bobbin', t0: T_X2 - 0.8, t1: T_X2 + 1.8, at: (u) => pose(yaw([-0.45, 1, 0.35], 4 - 8 * u), [29.6, 135, -3], 36) },
  { view: 'bobbin', t0: T_X2 + 2.6, t1: T_DONE + 0.4, at: (u) => pose(yaw([-0.35, 1, 0.25], -20 * u), [29.6, 132, -3], 58 + 6 * u) },
  { view: 'a', t0: T_DONE + 1.4, t1: T_END, at: (u) => pose(yaw([0.55, 0.62, 1], -8 + 10 * u), [42, 108, -6], 230 - 20 * u) }
];
function camAt(t) {
  for (let i = 0; i < SHOTS.length; i++) {
    const s = SHOTS[i];
    if (t >= s.t0 && t <= s.t1) return { view: s.view, ...s.at((t - s.t0) / (s.t1 - s.t0)) };
    const n = SHOTS[i + 1];
    if (n && t > s.t1 && t < n.t0) {                     // transisi: interpolasi posisi & target kamera
      const k = ease((t - s.t1) / (n.t0 - s.t1)), a = s.at(1), b = n.at(0);
      return { view: k < 0.5 ? s.view : n.view, pos: V3.lerp(a.pos, b.pos, k), tgt: V3.lerp(a.tgt, b.tgt, k) };
    }
  }
  const l = SHOTS[SHOTS.length - 1]; return { view: l.view, ...l.at(1) };
}

// ---------- suara (sintesis offline, sama dengan Web Audio di halaman) ----------
function synthAudio(file) {
  const SR = 44100, N = Math.ceil(DUR * SR), out = new Float32Array(N);
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const MASTER = 0.55;
  // dengung bearing: noise → low-pass satu kutub, menyala selama berputar
  const fc = 200 + RPM * 6, a = Math.exp(-2 * Math.PI * fc / SR), gain = 0.025 + 0.0003 * RPM;
  let lp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, on = Math.max(0, Math.min(1, (t - T_START) / 0.15, (T_DONE - t) / 0.15));
    lp = (1 - a) * rnd() + a * lp; out[i] += lp * gain * 3 * on * MASTER;
  }
  const add = (t0, fn, dur) => { const i0 = Math.floor(t0 * SR), n = Math.floor(dur * SR); for (let k = 0; k < n && i0 + k < N; k++) out[i0 + k] += fn(k / SR) * MASTER; };
  // tik gigi: noise band-pass (biquad) ~2,8 kHz, 25 ms
  const toothBurst = () => { const f = 2600 + Math.random() * 400, q = 6, w0 = 2 * Math.PI * f / SR, al = Math.sin(w0) / (2 * q);
    const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * Math.cos(w0), a2 = 1 - al; let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return (t) => { const x = rnd(), y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y * 0.5 * Math.exp(-t / 0.006); }; };
  const toothDt = 1 / (bps * cfg.zA);
  for (let t = T_START + toothDt; t < T_DONE; t += toothDt) add(t, toothBurst(), 0.03);
  for (let t = T_START + 1 / bps; t <= T_DONE + 1e-6; t += 1 / bps) add(t, (u) => Math.sin(2 * Math.PI * 1480 * u) * 0.12 * Math.exp(-u / 0.015), 0.06);
  // chime selesai
  add(T_DONE, (u) => Math.sin(2 * Math.PI * 880 * u) * 0.18 * Math.exp(-u / 0.2), 0.9);
  add(T_DONE + 0.14, (u) => Math.sin(2 * Math.PI * 1318.5 * u) * 0.16 * Math.exp(-u / 0.25), 1.1);
  // bunyi klem: sinus 160→55 Hz + klik noise
  let ph = 0;
  add(T_CLAMP, (u) => { const f = 160 * Math.pow(55 / 160, Math.min(1, u / 0.16)); ph += 2 * Math.PI * f / SR; return Math.sin(ph) * 0.5 * Math.exp(-u / 0.05); }, 0.2);
  let hp = 0, px = 0;
  add(T_CLAMP, (u) => { const x = rnd(); hp = 0.6 * (hp + x - px); px = x; return hp * 0.4 * Math.exp(-u / 0.012); }, 0.06);
  // normalisasi ke −1 dBFS, tulis WAV 16-bit mono
  let peak = 0; for (const v of out) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? 0.89 / peak : 1, buf = Buffer.alloc(44 + N * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 2, 40);
  for (let i = 0; i < N; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out[i] * k * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

// ---------- perekaman ----------
// Tiap frame dihitung langsung dari waktunya (bukan dari frame sebelumnya), jadi perekaman bisa
// dilanjutkan setelah terputus: frame yang sudah ada di video/frames dilewati.
const FRAMES_DIR = path.join(OUT_DIR, 'frames');
const CHUNK = 300;                                        // browser dibuka ulang tiap 300 frame (cegah memori menumpuk)
const stateAt = (t) => {
  const ts = Math.max(0, t - T_START), nb = Math.min(NB_DONE, ts * bps);
  return { thetaIn: nb * 2 * Math.PI, running: t >= T_START && t < T_DONE, done: t >= T_DONE,
    clampClosed: t < T_CLAMP, clampAngle: t < T_CLAMP ? 0 : -cfg.clampOpenRad * (1 - Math.exp(-5 * (t - T_CLAMP))) };
};
async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SS });
  await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/(.*)$/, (r) => r.fulfill({ path: path.join(ROOT, 'vendor', VENDOR[r.request().url().split('three@0.128.0/')[1]]), contentType: 'application/javascript' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto('file://' + path.join(ROOT, 'index.html') + '?rec');
  await page.evaluate(() => window.__jig.ready);
  await page.waitForTimeout(600);
  await page.evaluate(([rpm, tps, spw]) => {
    const set = (id, v, ev) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(ev)); };
    set('i-rpm', rpm, 'input'); set('i-spw', spw, 'change'); set('i-tps', tps, 'change');
    window.__jig.frozen = true; window.__jig.recording = true;
  }, [RPM, TPS, SPW]);
  return page;
}
async function renderFrame(page, f, view) {
  const t = f / FPS, c = camAt(t), st = stateAt(t);
  if (c.view !== view.v) { await page.evaluate((v) => window.__jig.setView(v), c.view); view.v = c.view; }
  await page.evaluate(([pos, tgt, st]) => {
    const j = window.__jig, s = j.sim;
    s.thetaIn = st.thetaIn; s.running = st.running; s.done = st.done; s.clampClosed = st.clampClosed;
    j.setClampAngle(st.clampAngle); j.setCam(pos, tgt); j.tick(0);
  }, [c.pos, c.tgt, st]);
}

(async () => {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  console.log(`durasi ${DUR.toFixed(1)} s · mulai ${T_START}s · pindah alur ${T_X1.toFixed(2)}s & ${T_X2.toFixed(2)}s · selesai ${T_DONE.toFixed(2)}s · klem ${T_CLAMP.toFixed(2)}s`);
  const frames = Math.round(DUR * FPS), step = PREVIEW ? 15 : 1;
  const todo = [];
  for (let f = 0; f < frames; f += step) { const file = path.join(PREVIEW ? OUT_DIR : FRAMES_DIR, PREVIEW ? `preview-${String(f).padStart(4, '0')}.jpg` : `f${String(f).padStart(5, '0')}.jpg`); if (!fs.existsSync(file)) todo.push([f, file]); }
  console.log(`${todo.length} frame perlu dirender (${frames} total)`);
  const t0 = Date.now(); let done = 0;
  for (let k = 0; k < todo.length; k += CHUNK) {
    const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
    const page = await openPage(browser), view = { v: null };
    for (const [f, file] of todo.slice(k, k + CHUNK)) {
      await renderFrame(page, f, view);
      const jpg = await page.screenshot({ type: 'jpeg', quality: PREVIEW ? 80 : 92 });
      fs.writeFileSync(file + '.tmp', jpg); fs.renameSync(file + '.tmp', file);       // tulis atomik: frame setengah jadi tidak pernah tersimpan
      done++;
      if (done % 60 === 0) { const el = (Date.now() - t0) / 1000; console.log(`frame ${f}/${frames} · ${done}/${todo.length} · sisa ±${(el / done * (todo.length - done) / 60).toFixed(1)} mnt`); }
    }
    await browser.close();
  }
  if (PREVIEW) { console.log('pratinjau selesai'); return; }

  // ---------- encode ----------
  const wav = path.join(OUT_DIR, 'audio.wav'); synthAudio(wav);
  const out = path.join(OUT_DIR, 'winding-jig.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(FRAMES_DIR, 'f%05d.jpg'), '-i', wav,
    '-vf', `scale=${W}:${H}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out]);
  console.log('selesai:', out);
})().catch((e) => { console.error(e); process.exit(1); });
