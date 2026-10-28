/* Simulasi winding jig JI9G CMG21 — murni angka, tanpa three.js.
 * Dipakai bersama oleh halaman (window.JigSim) dan tes Node (require).
 * Satuan: mm, detik, radian, rpm.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JigSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TAU = Math.PI * 2;

  var DEFAULTS = {
    module: 1.5,        // modul gear (mm)
    zIn: 48,            // gear A, poros handwheel (input)
    zSpindle: 16,       // gear B, poros spindle bobbin
    zCounter: 24,       // gear C, penghitung putaran (digerakkan A)
    pressureAngleDeg: 20,
    efficiency: 0.98,   // efisiensi per pasang gear
    coreD: 14,          // diameter inti bobbin
    flangeD: 30,        // diameter flens bobbin
    slotWidth: 6,       // lebar satu alur lilitan
    slots: 4,           // jumlah alur (dililit bersamaan lewat sisir 4 gigi)
    wireD: 0.5,         // diameter kawat email
    rpmIn: 40,          // putaran handwheel
    targetTurns: 150    // target lilitan per alur
  };

  function merge(a, b) {
    var o = {}, k;
    for (k in a) o[k] = a[k];
    if (b) for (k in b) if (b[k] !== undefined) o[k] = b[k];
    return o;
  }

  // ---------- geometri gear ----------
  function pitchRadius(m, z) { return m * z / 2; }
  function centerDistance(m, z1, z2) { return m * (z1 + z2) / 2; }
  function ratio(cfg) { return cfg.zIn / cfg.zSpindle; }           // spindle : input
  function counterRatio(cfg) { return cfg.zIn / cfg.zCounter; }     // counter : input
  function inv(a) { return Math.tan(a) - a; }

  /* Sudut gear yang digerakkan agar gigi masuk tepat ke celah lawan.
   * phi = arah dari pusat penggerak ke pusat yang digerakkan.
   * Gigi gear berada di theta + 2πk/z, celah di theta + π/z + 2πk/z. */
  function meshAngle(thetaDriver, zDriver, zDriven, phi) {
    return phi + Math.PI - Math.PI / zDriven - (zDriver / zDriven) * (thetaDriver - phi);
  }

  // ---------- geometri lilitan ----------
  function turnsPerLayer(cfg) { return Math.max(1, Math.floor(cfg.slotWidth / cfg.wireD + 1e-9)); }
  function maxLayers(cfg) { return Math.max(1, Math.floor((cfg.flangeD - cfg.coreD) / 2 / cfg.wireD + 1e-9)); }
  function capacity(cfg) { return turnsPerLayer(cfg) * maxLayers(cfg); }

  /* Panjang kawat satu alur setelah n lilitan (boleh pecahan).
   * Lapisan ke-k (mulai 0) punya diameter garis tengah kawat coreD + wireD(2k+1). */
  function wireLengthPerSlot(cfg, n) {
    var tpl = turnsPerLayer(cfg), len = 0, k = 0, left = Math.max(0, n);
    while (left > 1e-12) {
      var t = Math.min(tpl, left);
      len += t * Math.PI * (cfg.coreD + cfg.wireD * (2 * k + 1));
      left -= t; k++;
    }
    return len;
  }
  function layerOf(cfg, n) { return n <= 0 ? 0 : Math.ceil(n / turnsPerLayer(cfg) - 1e-9); }
  function buildDiameter(cfg, n) { return cfg.coreD + 2 * cfg.wireD * layerOf(cfg, n); }

  /* Posisi sisir pemandu di dalam alur (0..slotWidth), bolak-balik tiap lapisan. */
  function traverse(cfg, n) {
    var tpl = turnsPerLayer(cfg);
    if (n <= 0) return 0;
    var layer = Math.floor(n / tpl), inLayer = n - layer * tpl;
    if (inLayer === 0 && layer > 0) { layer -= 1; inLayer = tpl; }
    var span = tpl * cfg.wireD;
    var x = Math.min(span, inLayer * cfg.wireD);
    var pos = (layer % 2 === 0) ? x : span - x;
    return Math.min(cfg.slotWidth, Math.max(0, pos));
  }

  // ---------- state & langkah ----------
  function create(opts) {
    var cfg = merge(DEFAULTS, opts);
    cfg.targetTurns = Math.min(cfg.targetTurns, capacity(cfg));
    return { cfg: cfg, t: 0, thetaIn: 0, running: false, clampClosed: true, done: false };
  }

  function thetaLimit(cfg) { return cfg.targetTurns * TAU / ratio(cfg); }

  /* Majukan simulasi dt detik. Mengembalikan jumlah lilitan utuh yang baru selesai. */
  function step(s, dt) {
    var before = Math.floor(turns(s) + 1e-9);
    s.t += dt;
    if (s.running && s.clampClosed && !s.done && dt > 0) {
      s.thetaIn += s.cfg.rpmIn * TAU / 60 * dt;
      var lim = thetaLimit(s.cfg);
      if (s.thetaIn >= lim - 1e-9) { s.thetaIn = lim; s.done = true; s.running = false; }
    }
    return Math.floor(turns(s) + 1e-9) - before;
  }

  function turns(s) { return s.thetaIn * ratio(s.cfg) / TAU; }

  function reset(s) { s.t = 0; s.thetaIn = 0; s.running = false; s.done = false; }

  function readout(s) {
    var c = s.cfg, r = ratio(c), n = turns(s);
    var wIn = c.rpmIn * TAU / 60;
    var moving = s.running && s.clampClosed && !s.done;
    var phiAB = Math.PI / 2; // B tepat di atas A
    var phiAC = Math.atan2(gearLayout(c).C.v - gearLayout(c).A.v, gearLayout(c).C.u - gearLayout(c).A.u);
    return {
      ratio: r,
      rpmIn: moving ? c.rpmIn : 0,
      rpmSpindle: moving ? c.rpmIn * r : 0,
      rpmCounter: moving ? c.rpmIn * counterRatio(c) : 0,
      meshHz: moving ? c.rpmIn / 60 * c.zIn : 0,
      pitchVel: moving ? wIn * pitchRadius(c.module, c.zIn) : 0,   // mm/s
      thetaA: s.thetaIn,
      thetaB: meshAngle(s.thetaIn, c.zIn, c.zSpindle, phiAB),
      thetaC: meshAngle(s.thetaIn, c.zIn, c.zCounter, phiAC),
      turns: n,
      turnsInt: Math.floor(n + 1e-9),
      layer: layerOf(c, n),
      turnsPerLayer: turnsPerLayer(c),
      buildD: buildDiameter(c, n),
      wireLenM: wireLengthPerSlot(c, n) * c.slots / 1000,
      traverse: traverse(c, n),
      progress: n / c.targetTurns,
      torqueGain: (1 / r) * c.efficiency,    // torsi spindle per torsi input
      done: s.done
    };
  }

  /* Tata letak pusat gear di bidang (u,v) = (z, y) dunia, relatif sumbu input. */
  function gearLayout(cfg) {
    var dAB = centerDistance(cfg.module, cfg.zIn, cfg.zSpindle);
    var dAC = centerDistance(cfg.module, cfg.zIn, cfg.zCounter);
    var uC = -dAC * Math.cos(Math.PI * 22 / 180); // C di belakang-atas A, 22° di atas horizontal
    var vC = dAC * Math.sin(Math.PI * 22 / 180);
    return { A: { u: 0, v: 0 }, B: { u: 0, v: dAB }, C: { u: uC, v: vC }, dAB: dAB, dAC: dAC };
  }

  return {
    DEFAULTS: DEFAULTS, TAU: TAU,
    pitchRadius: pitchRadius, centerDistance: centerDistance, ratio: ratio, counterRatio: counterRatio,
    inv: inv, meshAngle: meshAngle, gearLayout: gearLayout,
    turnsPerLayer: turnsPerLayer, maxLayers: maxLayers, capacity: capacity,
    wireLengthPerSlot: wireLengthPerSlot, layerOf: layerOf, buildDiameter: buildDiameter, traverse: traverse,
    create: create, step: step, turns: turns, reset: reset, readout: readout
  };
});
