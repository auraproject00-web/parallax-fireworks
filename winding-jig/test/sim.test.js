// Tes angka simulasi: node --test test/sim.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../sim.js');

const near = (a, b, eps = 1e-6, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a} (eps ${eps})`);

test('angka gear sesuai model: 10T + 10T, jarak sumbu 10,90 mm', () => {
  const c = S.DEFAULTS;
  assert.equal(c.zA, 10); assert.equal(c.zB, 10);
  near(c.centerDist, 10.9, 1e-9);
  near(S.moduleOf(c), 1.09, 1e-9);
  near(S.pitchRadius(c, 10) * 2, c.centerDist, 1e-9, 'dua radius pitch = jarak sumbu');
  assert.ok(S.pitchRadius(c, 10) < S.MODEL.outerR, 'pitch di dalam lingkaran kepala gigi');
  assert.equal(S.ratio(c), 1);
});

test('30 rpm → gear atas 30 rpm, mesh 5 Hz', () => {
  const s = S.create({ rpmIn: 30 }); s.running = true; S.step(s, 0.1);
  const r = S.readout(s);
  near(r.rpmA, 30); near(r.rpmB, 30); near(r.meshHz, 5);
});

test('kecepatan pitch sama di kedua gear', () => {
  const c = S.DEFAULTS, w = c.rpmIn * S.TAU / 60;
  near(w * S.pitchRadius(c, c.zA), w * S.ratio(c) * S.pitchRadius(c, c.zB), 1e-12);
  const s = S.create(); s.running = true; S.step(s, 0.01);
  near(S.readout(s).pitchVel, w * S.pitchRadius(c, c.zA), 1e-9);
});

test('gear atas berputar berlawanan arah, sudut sama besar', () => {
  const c = S.DEFAULTS;
  for (const t of [0, 0.3, 2, 17.5]) near(S.angleB(c, t), -t, 1e-12);
});

test('bobbin digerakkan gear atas: 10T, searah handwheel, 1 : 1', () => {
  const c = S.DEFAULTS;
  assert.equal(c.zC, 10);
  assert.equal(S.ratioC(c), 1);
  for (const t of [0, 0.3, 2, 17.5]) {
    near(S.angleC(c, t), t, 1e-12, 'searah A');
    assert.ok(S.angleC(c, t) * S.angleB(c, t) <= 0, 'berlawanan dengan B');
  }
  // gear bobbin harus menyentuh gear atas: jarak sumbu < jumlah radius luar
  const d = S.MODEL.axisC.y - S.MODEL.axisB.y;
  assert.ok(d < S.MODEL.outerR + 5.9 && d > 5.9, `jarak ${d}`);
  const s = S.create({ rpmIn: 45 }); s.running = true; S.step(s, 4);
  const r = S.readout(s); near(r.rpmC, 45); near(r.bobbinTurns, 3, 1e-9);
});

test('20 detik pada 30 rpm = 10 putaran', () => {
  const s = S.create({ rpmIn: 30 }); s.running = true;
  let ticks = 0;
  for (let i = 0; i < 2000; i++) ticks += S.step(s, 0.01);
  near(S.turns(s), 10, 1e-6); assert.equal(ticks, 10);
});

test('satu langkah besar = banyak langkah kecil', () => {
  const a = S.create(), b = S.create(); a.running = b.running = true;
  S.step(a, 7.3);
  for (let i = 0; i < 730; i++) S.step(b, 0.01);
  near(a.thetaIn, b.thetaIn, 1e-7);
});

test('berhenti tepat di target', () => {
  const s = S.create({ targetTurns: 25, rpmIn: 120 }); s.running = true;
  for (let i = 0; i < 100; i++) S.step(s, 0.37);
  assert.equal(s.done, true); assert.equal(s.running, false);
  near(S.turns(s), 25, 1e-9);
  assert.equal(S.readout(s).rpmA, 0);
});

test('klem terbuka = poros terkunci', () => {
  const s = S.create(); s.running = true; s.clampClosed = false;
  S.step(s, 5);
  assert.equal(S.turns(s), 0);
  assert.equal(S.readout(s).rpmB, 0);
});

test('kecepatan tepi handwheel Ø60', () => {
  const s = S.create({ rpmIn: 60 }); s.running = true; S.step(s, 0.01);
  near(S.readout(s).rimVel, S.TAU * 30, 1e-9);
});

test('reset mengembalikan ke nol', () => {
  const s = S.create(); s.running = true; S.step(s, 3); S.reset(s);
  assert.equal(S.turns(s), 0); assert.equal(s.running, false);
});

// ---------- lilitan kawat ----------
test('alur dari model: 7 alur, inti 5,89, flens 8,39', () => {
  assert.equal(S.MODEL.slots.length, 7);
  const w = S.MODEL.slots.map((_, i) => +S.slotWidth(i).toFixed(2));
  assert.deepEqual(w, [1.2, 1.8, 1.8, 0.9, 0.9, 1.8, 1.8]);
  for (let i = 1; i < 7; i++) assert.ok(S.MODEL.slots[i][0] > S.MODEL.slots[i - 1][1], 'alur tidak tumpang tindih');
});

test('kapasitas alur @ kawat 0,2 mm', () => {
  const c = { ...S.DEFAULTS, wireD: 0.2 };
  assert.equal(S.maxLayers(c), 12);                 // (8,39 − 5,89) / 0,2
  assert.equal(S.turnsPerLayer(c, 0), 6);           // 1,2 / 0,2
  assert.equal(S.turnsPerLayer(c, 1), 9);
  assert.equal(S.turnsPerLayer(c, 3), 4);           // 0,9 / 0,2
  assert.equal(S.maxTurnsPerSlot(c), 48);           // alur tersempit 4 × 12
  assert.equal(S.create({ turnsPerSlot: 999 }).cfg.turnsPerSlot, 48);
});

test('target putaran = 7 × lilitan per alur', () => {
  const s = S.create({ turnsPerSlot: 20 });
  assert.equal(S.totalTurns(s.cfg), 140);
  near(s.cfg.targetTurns, 140);
});

test('alur diisi berurutan', () => {
  const c = { ...S.DEFAULTS, turnsPerSlot: 20 };
  let w = S.winding(c, 0); assert.equal(w.active, 0); assert.ok(w.fills.every((f) => f === 0));
  w = S.winding(c, 25); assert.equal(w.active, 1); assert.deepEqual(w.fills.slice(0, 3), [20, 5, 0]);
  w = S.winding(c, 140); assert.equal(w.active, 6); assert.ok(w.fills.every((f) => f === 20));
  w = S.winding(c, 999); assert.ok(w.fills.every((f) => f === 20), 'tidak melebihi target');
});

test('posisi kawat selalu di dalam alur aktif', () => {
  const c = { ...S.DEFAULTS, turnsPerSlot: 30 };
  for (let n = 0; n <= 210; n += 0.25) {
    const w = S.winding(c, n), [z0, z1] = S.MODEL.slots[w.active];
    assert.ok(w.layZ >= z0 && w.layZ <= z1, `n=${n} z=${w.layZ} alur ${w.active}`);
    assert.ok(w.radii.every((r) => r >= S.MODEL.coreR && r <= S.MODEL.flangeR + 1e-9), `n=${n} radius`);
  }
});

test('panjang kawat cocok dengan penjumlahan per lilitan', () => {
  const c = { ...S.DEFAULTS, turnsPerSlot: 20, wireD: 0.2 };
  for (const n of [0, 1, 6, 7, 20, 33.5, 140]) {
    let brute = 0;
    for (let i = 0; i < 7; i++) {
      const f = Math.max(0, Math.min(20, n - i * 20)), tpl = S.turnsPerLayer(c, i);
      const whole = Math.floor(f);
      for (let t = 0; t < whole; t++) brute += 2 * Math.PI * (S.MODEL.coreR + c.wireD * (Math.floor(t / tpl) + 0.5));
      if (f > whole) brute += (f - whole) * 2 * Math.PI * (S.MODEL.coreR + c.wireD * (Math.floor(whole / tpl) + 0.5));
    }
    near(S.winding(c, n).lengthM, brute / 1000, 1e-9, `n=${n}`);
  }
  // alur pertama penuh 20 lilitan: 6+6+6+2 per lapisan
  const one = [6, 6, 6, 2].reduce((a, t, k) => a + t * 2 * Math.PI * (5.89 + 0.2 * (k + 0.5)), 0);
  near(S.slotLength(c, 0, 20), one, 1e-9);
});

test('simulasi berhenti saat semua alur penuh', () => {
  const s = S.create({ turnsPerSlot: 10, rpmIn: 120 }); s.running = true;
  for (let i = 0; i < 200; i++) S.step(s, 0.5);
  const r = S.readout(s);
  assert.equal(s.done, true); near(r.bobbinTurns, 70, 1e-9);
  assert.ok(r.winding.fills.every((f) => Math.abs(f - 10) < 1e-9));
});
