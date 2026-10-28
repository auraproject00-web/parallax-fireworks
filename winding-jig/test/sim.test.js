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
