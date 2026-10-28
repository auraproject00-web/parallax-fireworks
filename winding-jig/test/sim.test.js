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
  assert.deepEqual(w, [1.01, 1.61, 1.61, 0.71, 0.9, 1.8, 1.8]);
  for (let i = 0; i < 7; i++) {
    near(S.MODEL.slots[i][0], S.MODEL.flanges[i][1], 1e-12, `alur ${i + 1} mulai di muka flens ${i}`);
    near(S.MODEL.slots[i][1], S.MODEL.flanges[i + 1][0], 1e-12, `alur ${i + 1} berakhir di muka flens ${i + 1}`);
  }
});

test('panjang kawat = jumlah kedua kawat', () => {
  const c = { ...S.DEFAULTS, turnsPerSlot: 20, wireD: 0.2 };
  const per = (tpl, f) => { let a = 0; const whole = Math.floor(f);
    for (let t = 0; t < whole; t++) a += 2 * Math.PI * (S.MODEL.coreR + c.wireD * (Math.floor(t / tpl) + 0.5));
    if (f > whole) a += (f - whole) * 2 * Math.PI * (S.MODEL.coreR + c.wireD * (Math.floor(whole / tpl) + 0.5));
    return a; };
  for (const n of [0, 1, 6, 7, 9.5, 20]) {
    const f = Math.min(20, n);
    near(S.winding(c, n).lengthM, (per(5, f) + per(9, f)) / 1000, 1e-9, `n=${n}`);
  }
  const one = [5, 5, 5, 5].reduce((a, t, k) => a + t * 2 * Math.PI * (5.89 + 0.2 * (k + 0.5)), 0);
  near(S.slotLength(c, 0, 20), one, 1e-9);
});

test('klem toggle membuka 90°', () => {
  near(S.DEFAULTS.clampOpenRad, Math.PI / 2, 1e-12);
});

// ---------- arah putaran ----------
// ω (rad/s, + = berlawanan jarum jam dilihat dari +z) tiap poros saat berjalan
const omegas = (c) => { const wA = c.driveDir * c.rpmIn * 2 * Math.PI / 60; return { A: wA, B: S.angleB(c, wA), C: S.angleC(c, wA) }; };
const vel = (w, rx, ry) => [-w * ry, w * rx];          // v = ω ẑ × r

test('kecepatan di titik kontak tiap pasang gear sama (tidak saling melawan)', () => {
  const c = S.DEFAULTS, w = omegas(c), M = S.MODEL;
  const pair = (P, wP, Q, wQ) => {      // titik kontak di garis sumbu, pada pembagian radius pitch (gigi sama → tengah)
    const k = { x: (P.x + Q.x) / 2, y: (P.y + Q.y) / 2 };
    const vP = vel(wP, k.x - P.x, k.y - P.y), vQ = vel(wQ, k.x - Q.x, k.y - Q.y);
    near(vP[0], vQ[0], 1e-9); near(vP[1], vQ[1], 1e-9);
  };
  pair(M.axisA, w.A, M.axisB, w.B);
  pair(M.axisB, w.B, M.axisC, w.C);
});

test('bobbin menggulung kawat, bukan mengurai', () => {
  const c = S.DEFAULTS, w = omegas(c);
  for (const R of [S.MODEL.coreR, 7, S.MODEL.flangeR]) {
    const T = S.wireTangent(R), F = { x: S.MODEL.feed.dx, y: S.MODEL.feed.dy };
    const u = [T.x - F.x, T.y - F.y], L = Math.hypot(u[0], u[1]);
    const v = vel(w.C, T.x, T.y);
    // permukaan di titik singgung harus bergerak searah kawat (menjauhi titik datang) → kawat tertarik ke bobbin
    const along = (v[0] * u[0] + v[1] * u[1]) / L;
    assert.ok(along > 0, `R=${R} kecepatan sepanjang kawat ${along}`);
    near(Math.abs(along), Math.abs(w.C) * R, 1e-6, 'kawat menyinggung (tanpa komponen radial)');
    assert.ok(T.y > 0, 'singgung di sisi atas');
  }
});

test('arah readout mengikuti arah penggerak', () => {
  const s = S.create(); s.running = true; S.step(s, 1);
  const r = S.readout(s);
  assert.ok(r.thetaA < 0 && r.thetaB > 0 && r.thetaC < 0, JSON.stringify([r.thetaA, r.thetaB, r.thetaC]));
  near(r.thetaC, r.thetaA, 1e-12);
});

// ---------- jalur kawat tergulung ----------
test('jalur kawat kontinu (tidak melompat)', () => {
  const c = S.DEFAULTS;
  for (const si of [0, 6]) {
    const cap = S.slotCapacity(c, si); let prev = S.wirePath(c, si, 0);
    for (let s = 0.01; s <= cap; s += 0.01) {
      const p = S.wirePath(c, si, s);
      assert.ok(Math.abs(p.z - prev.z) <= c.wireD * 0.0101 + 1e-12, `alur ${si} s=${s.toFixed(2)} Δz=${p.z - prev.z}`);
      assert.ok(Math.abs(p.r - prev.r) <= c.wireD * 0.016, `alur ${si} s=${s.toFixed(2)} Δr=${p.r - prev.r}`);
      prev = p;
    }
  }
});

test('lilitan bersebelahan berjarak tepat satu diameter kawat', () => {
  const c = S.DEFAULTS, d = c.wireD;
  for (const si of [0, 6]) {
    const tpl = S.turnsPerLayer(c, si);
    for (let li = 0; li < 3; li++) for (let i = 0; i < tpl - 2; i++) {
      const a = S.wirePath(c, si, li * tpl + i), b = S.wirePath(c, si, li * tpl + i + 1);
      near(Math.abs(b.z - a.z), d, 1e-9, `alur ${si} lapis ${li} lilitan ${i}`);
      near(b.r, a.r, 1e-12, 'satu lapis = radius sama');
    }
  }
});

test('lapisan berganti arah dan naik satu diameter', () => {
  const c = S.DEFAULTS, d = c.wireD, tpl = S.turnsPerLayer(c, 0);
  const l0a = S.wirePath(c, 0, 0.5), l0b = S.wirePath(c, 0, tpl - 1.5);
  const l1a = S.wirePath(c, 0, tpl + 0.5), l1b = S.wirePath(c, 0, 2 * tpl - 1.5);
  assert.ok(l0b.z > l0a.z, 'lapis 1 maju'); assert.ok(l1b.z < l1a.z, 'lapis 2 mundur');
  near(l1a.r - l0a.r, d, 1e-9);
});

test('kawat tidak keluar alur dan tidak melewati flens', () => {
  const c = S.DEFAULTS, d = c.wireD;
  for (const si of [0, 6]) {
    const [z0, z1] = S.MODEL.slots[si], cap = S.slotCapacity(c, si);
    for (let s = 0; s <= cap; s += 0.05) {
      const p = S.wirePath(c, si, s);
      assert.ok(p.z - d / 2 >= z0 - 1e-9 && p.z + d / 2 <= z1 + 1e-9, `z ${p.z}`);
      assert.ok(p.r - d / 2 >= S.MODEL.coreR - 1e-9 && p.r + d / 2 <= S.MODEL.flangeR + 1e-9, `r ${p.r}`);
    }
  }
});

test('ujung gulungan tepat di titik singgung kawat masuk', () => {
  const c = S.DEFAULTS;
  for (const s of [0, 3.3, 12.7, 20]) {
    const p = S.wirePath(c, 6, s), world = p.phi + c.driveDir * 2 * Math.PI * s;   // bobbin sudah berputar s kali
    const T = S.wireTangent(p.r);
    near(Math.cos(world), T.x / p.r, 1e-12); near(Math.sin(world), T.y / p.r, 1e-12);
  }
});

// ---------- pindah alur lewat coakan ----------
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

test('kapasitas alur @ kawat 0,2 mm', () => {
  const c = { ...S.DEFAULTS, wireD: 0.2 };
  assert.equal(S.maxLayers(c), 12);                 // (8,39 − 5,89) / 0,2
  assert.equal(S.turnsPerLayer(c, 0), 5);           // alur 1: 1,01 / 0,2
  assert.equal(S.turnsPerLayer(c, 6), 9);           // alur 7: 1,8 / 0,2
  assert.equal(S.turnsPerLayer(c, 4), 4);           // alur 5: 0,9 / 0,2
  assert.deepEqual(S.usedSlots(c), [0, 1, 2, 6, 5, 4]);
  assert.equal(S.maxTurnsPerSlot(c), 48);           // alur 5 tersempit: 4 × 12
  assert.equal(S.create({ turnsPerSlot: 999 }).cfg.turnsPerSlot, 48);
  assert.equal(S.maxTurnsPerSlot({ ...c, slotsPerWire: 1 }), 60);   // alur 1: 5 × 12
});

test('urutan alur: kiri 1→2→3, kanan 7→6→5, lilitan sama tiap alur', () => {
  const c = S.create({ turnsPerSlot: 20 }).cfg;
  for (const [wi, exp] of [[0, [0, 1, 2]], [1, [6, 5, 4]]]) {
    const sg = S.schedule(c, wi), slots = sg.filter((g) => g.type === 'slot');
    assert.deepEqual(slots.map((g) => g.si), exp);
    slots.forEach((g) => near(g.s1 - g.s0, 20, 1e-12));
    sg.filter((g) => g.type === 'cross').forEach((g, k) => {
      assert.equal(g.from, exp[k]); assert.equal(g.to, exp[k + 1]);
      assert.ok(g.ws >= g.s0 - 1e-12 && g.ws - g.s0 < 1, 'menunggu coakan kurang dari 1 putaran');
      near(g.s1 - g.ws, S.CROSS.w, 1e-12);
    });
    for (let i = 1; i < sg.length; i++) near(sg[i].s0, sg[i - 1].s1, 1e-12, 'segmen bersambung');
  }
});

test('jalur kawat lengkap kontinu, termasuk saat pindah alur', () => {
  const c = S.create({ turnsPerSlot: 20 }).cfg;
  for (const wi of [0, 1]) {
    const end = S.wireTurns(c, wi); let prev = S.wirePathW(c, wi, 0);
    for (let s = 0.005; s <= end; s += 0.005) {
      const p = S.wirePathW(c, wi, s);
      assert.ok(Math.abs(p.z - prev.z) < 0.25, `kawat ${wi} s=${s.toFixed(3)} Δz=${(p.z - prev.z).toFixed(3)}`);   // lompatan sungguhan ≥ 1 alur
      assert.ok(Math.abs(p.r - prev.r) < 0.12, `kawat ${wi} s=${s.toFixed(3)} Δr=${(p.r - prev.r).toFixed(3)}`);
      assert.ok(Math.abs(wrapA(p.phi - prev.phi)) < 0.06, `kawat ${wi} s=${s.toFixed(3)} Δφ`);
      prev = p;
    }
  }
});

test('kawat hanya menembus flens lewat coakan', () => {
  for (const opts of [{ turnsPerSlot: 20 }, { turnsPerSlot: 7, wireD: 0.3 }, { turnsPerSlot: 33, wireD: 0.15 }, { turnsPerSlot: 1 }]) {
    const c = S.create(opts).cfg, d = c.wireD, hw = S.notchHalfAngle();
    for (const wi of [0, 1]) {
      const end = S.wireTurns(c, wi); let passed = 0;
      for (let s = 0; s <= end; s += 0.002) {
        const p = S.wirePathW(c, wi, s);
        S.MODEL.flanges.forEach(([f0, f1], k) => {
          const inBand = p.z + d / 2 > f0 + 1e-9 && p.z - d / 2 < f1 - 1e-9;
          if (!inBand || p.r - d / 2 >= S.MODEL.flangeR) return;
          const off = Math.abs(wrapA(p.phi - S.MODEL.notchAngle));
          assert.ok(off <= hw + 1e-9, `${JSON.stringify(opts)} kawat ${wi} s=${s.toFixed(3)} menembus flens ${k} di luar coakan (${(off * 180 / Math.PI).toFixed(1)}°)`);
          assert.ok(p.seg === 'cross' && p.flange === k, `hanya saat pindah, lewat flens ${k}`);
          assert.ok(p.r - d / 2 >= S.MODEL.coreR - 1e-9, 'di atas inti');
          passed++;
        });
      }
      assert.ok(passed > 0 || wi < 0, 'kawat memang melewati coakan');
    }
  }
});

test('kawat tetap di alurnya selama melilit', () => {
  const c = S.create({ turnsPerSlot: 30 }).cfg, d = c.wireD;
  for (const wi of [0, 1]) for (const g of S.schedule(c, wi).filter((g) => g.type === 'slot')) {
    const [z0, z1] = S.MODEL.slots[g.si];
    for (let s = g.s0; s <= g.s1; s += 0.05) {
      const p = S.wirePathW(c, wi, s);
      assert.ok(p.z - d / 2 >= z0 - 1e-9 && p.z + d / 2 <= z1 + 1e-9, `alur ${g.si + 1} z=${p.z}`);
      assert.ok(p.r - d / 2 >= S.MODEL.coreR - 1e-9 && p.r + d / 2 <= S.MODEL.flangeR + 1e-9);
    }
  }
});

test('alur berikut mulai dari sisi flens yang dilewati', () => {
  const c = S.create().cfg;
  for (const wi of [0, 1]) {
    const sg = S.schedule(c, wi);
    sg.forEach((g, i) => { if (g.type !== 'cross') return;
      const nxt = sg[i + 1], p = S.wirePathW(c, wi, nxt.s0 + 0.01);
      const fl = S.MODEL.flanges[g.flange], dist = Math.min(Math.abs(p.z - fl[0]), Math.abs(p.z - fl[1]));
      assert.ok(dist < c.wireD, `lilitan pertama alur ${nxt.si + 1} menempel flens (${dist.toFixed(3)} mm)`);
    });
  }
});

test('ketiga alur tiap kawat terisi sama, lalu berhenti', () => {
  const s = S.create({ turnsPerSlot: 10, rpmIn: 120 }); s.running = true;
  for (let i = 0; i < 400; i++) S.step(s, 0.5);
  const r = S.readout(s);
  assert.equal(s.done, true);
  assert.deepEqual(r.winding.fills.map((f) => +f.toFixed(9)), [10, 10, 10, 0, 10, 10, 10]);
  near(r.bobbinTurns, S.totalTurns(s.cfg), 1e-9);
  assert.ok(r.winding.wires.every((w) => w.done));
});

test('urutan pengisian: alur berikut baru terisi setelah alur sebelumnya penuh', () => {
  const c = S.create({ turnsPerSlot: 20 }).cfg;
  let w = S.winding(c, 10); assert.deepEqual(w.fills, [10, 0, 0, 0, 0, 0, 10]);
  w = S.winding(c, 20.5); assert.deepEqual(w.fills, [20, 0, 0, 0, 0, 0, 20]);
  assert.equal(w.wires[0].crossing, 1); assert.equal(w.wires[1].crossing, 5);
  const s2 = S.schedule(c, 0)[2].s0;
  w = S.winding(c, s2 + 5); assert.deepEqual(w.fills.map((f) => +f.toFixed(9)), [20, 5, 0, 0, 0, 0, 20].map((v, i) => i === 5 ? +Math.max(0, s2 + 5 - S.schedule(c, 1)[2].s0).toFixed(9) : v));
});

test('satu alur per kawat tetap berfungsi', () => {
  const c = S.create({ slotsPerWire: 1, turnsPerSlot: 20 }).cfg;
  near(S.totalTurns(c), 20, 1e-12);
  assert.deepEqual(S.winding(c, 99).fills, [20, 0, 0, 0, 0, 0, 20]);
});

test('panjang kawat ≈ panjang jalur 3D yang digambar', () => {
  const c = S.create({ turnsPerSlot: 20 }).cfg;
  for (const nb of [7.3, 20.6, 45, S.totalTurns(c)]) {
    let L = 0;
    for (const wi of [0, 1]) {
      const end = Math.min(nb, S.wireTurns(c, wi)), N = Math.ceil(end * 400);
      let pp = null;
      for (let i = 0; i <= N; i++) { const p = S.wirePathW(c, wi, end * i / N), q = [p.r * Math.cos(p.phi), p.r * Math.sin(p.phi), p.z];
        if (pp) L += Math.hypot(q[0] - pp[0], q[1] - pp[1], q[2] - pp[2]); pp = q; }
    }
    const est = S.winding(c, nb).lengthM * 1000;
    assert.ok(Math.abs(est - L) / L < 0.004, `nb=${nb}: HUD ${est.toFixed(1)} mm vs jalur ${L.toFixed(1)} mm`);
  }
});
