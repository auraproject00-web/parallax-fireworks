// Tes angka simulasi: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../sim.js');

const near = (a, b, eps = 1e-6, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a} (eps ${eps})`);
const wrap = (a) => { a = a % S.TAU; return a < 0 ? a + S.TAU : a; };

test('rasio gear dan jarak sumbu', () => {
  const c = S.DEFAULTS;
  assert.equal(S.ratio(c), 3);
  assert.equal(S.counterRatio(c), 2);
  assert.equal(S.centerDistance(1.5, 48, 16), 48);
  assert.equal(S.centerDistance(1.5, 48, 24), 54);
  const L = S.gearLayout(c);
  near(Math.hypot(L.B.u - L.A.u, L.B.v - L.A.v), 48, 1e-9, 'A-B');
  near(Math.hypot(L.C.u - L.A.u, L.C.v - L.A.v), 54, 1e-9, 'A-C');
  // B dan C tidak boleh bertabrakan: jarak > jumlah radius kepala
  const dBC = Math.hypot(L.B.u - L.C.u, L.B.v - L.C.v);
  assert.ok(dBC > (S.pitchRadius(1.5, 16) + 1.5) + (S.pitchRadius(1.5, 24) + 1.5), 'B-C clearance');
});

test('40 rpm input → 120 rpm spindle, 80 rpm counter, mesh 32 Hz', () => {
  const s = S.create({ rpmIn: 40 });
  s.running = true;
  S.step(s, 0.1);
  const r = S.readout(s);
  near(r.rpmSpindle, 120); near(r.rpmCounter, 80); near(r.meshHz, 32);
});

test('kecepatan garis pitch sama di semua pasangan gear', () => {
  const c = S.DEFAULTS, w = c.rpmIn * S.TAU / 60;
  const vA = w * S.pitchRadius(c.module, c.zIn);
  const vB = w * S.ratio(c) * S.pitchRadius(c.module, c.zSpindle);
  const vC = w * S.counterRatio(c) * S.pitchRadius(c.module, c.zCounter);
  near(vA, vB, 1e-9); near(vA, vC, 1e-9);
  const s = S.create(); s.running = true; S.step(s, 0.01);
  near(S.readout(s).pitchVel, vA, 1e-9);
});

test('10 detik pada 40 rpm = 20 lilitan', () => {
  const s = S.create({ rpmIn: 40 }); s.running = true;
  let ticks = 0;
  for (let i = 0; i < 1000; i++) ticks += S.step(s, 0.01);
  near(S.turns(s), 20, 1e-6); assert.equal(ticks, 20);
});

test('satu langkah besar = banyak langkah kecil', () => {
  const a = S.create(), b = S.create(); a.running = b.running = true;
  S.step(a, 7.3);
  for (let i = 0; i < 730; i++) S.step(b, 0.01);
  near(a.thetaIn, b.thetaIn, 1e-7);
});

test('berhenti tepat di target', () => {
  const s = S.create({ targetTurns: 50, rpmIn: 120 }); s.running = true;
  for (let i = 0; i < 100; i++) S.step(s, 0.37);
  assert.equal(s.done, true); assert.equal(s.running, false);
  near(S.turns(s), 50, 1e-9);
  assert.equal(S.readout(s).rpmSpindle, 0);
});

test('klem terbuka = spindle tidak berputar (interlock)', () => {
  const s = S.create(); s.running = true; s.clampClosed = false;
  S.step(s, 5);
  assert.equal(S.turns(s), 0);
  assert.equal(S.readout(s).rpmSpindle, 0);
});

test('target dibatasi kapasitas bobbin', () => {
  const c = { ...S.DEFAULTS, wireD: 0.5 };
  assert.equal(S.turnsPerLayer(c), 12);
  assert.equal(S.maxLayers(c), 16);
  assert.equal(S.capacity(c), 192);
  assert.equal(S.create({ targetTurns: 999 }).cfg.targetTurns, 192);
  assert.equal(S.capacity({ ...c, wireD: 0.3 }), 20 * 26);
});

test('panjang kawat cocok dengan penjumlahan per lilitan', () => {
  const c = S.DEFAULTS;
  for (const n of [0, 1, 11, 12, 13, 100, 150, 191.5]) {
    let brute = 0;
    const whole = Math.floor(n);
    for (let i = 0; i < whole; i++) {
      const k = Math.floor(i / 12);
      brute += Math.PI * (c.coreD + c.wireD * (2 * k + 1));
    }
    if (n > whole) brute += (n - whole) * Math.PI * (c.coreD + c.wireD * (2 * Math.floor(whole / 12) + 1));
    near(S.wireLengthPerSlot(c, n), brute, 1e-9, `n=${n}`);
  }
  // lapisan pertama: 12 × π × 14.5
  near(S.wireLengthPerSlot(c, 12), 12 * Math.PI * 14.5, 1e-9);
});

test('lapisan dan diameter tumpukan', () => {
  const c = S.DEFAULTS;
  assert.equal(S.layerOf(c, 0), 0);
  assert.equal(S.layerOf(c, 1), 1);
  assert.equal(S.layerOf(c, 12), 1);
  assert.equal(S.layerOf(c, 12.01), 2);
  near(S.buildDiameter(c, 150), 14 + 2 * 0.5 * 13);
  assert.ok(S.buildDiameter(c, S.capacity(c)) <= c.flangeD + 1e-9);
});

test('sisir pemandu bolak-balik di dalam alur', () => {
  const c = S.DEFAULTS;
  near(S.traverse(c, 0), 0); near(S.traverse(c, 6), 3); near(S.traverse(c, 12), 6);
  near(S.traverse(c, 18), 3); near(S.traverse(c, 24), 0); near(S.traverse(c, 30), 3);
  for (let n = 0; n <= 192; n += 0.25) {
    const x = S.traverse(c, n);
    assert.ok(x >= 0 && x <= c.slotWidth, `n=${n} x=${x}`);
  }
});

test('gigi gear selalu masuk celah pasangannya', () => {
  const c = S.DEFAULTS, L = S.gearLayout(c);
  const pairs = [
    ['B', c.zSpindle, Math.atan2(L.B.v, L.B.u)],
    ['C', c.zCounter, Math.atan2(L.C.v, L.C.u)]
  ];
  for (let i = 0; i < 400; i++) {
    const tA = i * 0.0731;
    for (const [, z2, phi] of pairs) {
      const t2 = S.meshAngle(tA, c.zIn, z2, phi);
      // titik gigi A terdekat ke garis sumbu (arah phi)
      const kA = Math.round((phi - tA) / (S.TAU / c.zIn));
      const dA = (tA + kA * S.TAU / c.zIn) - phi;       // offset sudut gigi A dari garis sumbu
      // celah B terdekat ke arah phi+π
      const gap0 = t2 + Math.PI / z2;
      const kB = Math.round((phi + Math.PI - gap0) / (S.TAU / z2));
      const dB = (gap0 + kB * S.TAU / z2) - (phi + Math.PI); // offset celah B
      // busur di lingkaran pitch harus sama besar dan berlawanan arah (rol tanpa slip)
      near(dA * c.zIn, -dB * z2, 1e-6, `tA=${tA}`);
    }
  }
  // tA = 0 → sudut absolut terdefinisi
  near(wrap(S.meshAngle(0, 48, 16, Math.PI / 2)), wrap(Math.PI / 2 + Math.PI - Math.PI / 16 + 3 * Math.PI / 2));
});

test('arah putar: spindle berlawanan arah dengan input', () => {
  const c = S.DEFAULTS;
  const a = S.meshAngle(0, c.zIn, c.zSpindle, Math.PI / 2);
  const b = S.meshAngle(0.1, c.zIn, c.zSpindle, Math.PI / 2);
  near(b - a, -0.3, 1e-12);
});

test('reset mengembalikan ke nol', () => {
  const s = S.create(); s.running = true; S.step(s, 3); S.reset(s);
  assert.equal(S.turns(s), 0); assert.equal(s.running, false); assert.equal(S.readout(s).wireLenM, 0);
});
