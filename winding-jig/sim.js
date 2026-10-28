/* Simulasi winding jig JI9G CMG21 — murni angka, tanpa three.js.
 * Angka gear diukur dari model SketchUp CMG21-22-25-20_WINDING_JIG.dae:
 *   gear bawah (group_28) 10 gigi, pusat y = 108,12 mm, di poros handwheel
 *   gear atas  (group_30) 10 gigi, pusat y = 119,02 mm
 *   jarak sumbu 10,90 mm → modul 1,09 mm, rasio 1 : 1
 * Satuan: mm, detik, radian, rpm.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JigSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TAU = Math.PI * 2;

  var MODEL = {
    axisA: { x: 29.67, y: 108.12 },   // poros handwheel + gear bawah
    axisB: { x: 29.67, y: 119.02 },   // gear atas
    hinge: { x: 56.5, y: 123.2 },     // pin engsel klem (group_65)
    zA: 10, zB: 10,
    outerR: 6.3,                      // radius kepala gigi terukur
    handwheelD: 60                    // diameter piringan handwheel
  };

  var DEFAULTS = {
    zA: MODEL.zA,
    zB: MODEL.zB,
    centerDist: MODEL.axisB.y - MODEL.axisA.y,   // 10,90 mm
    efficiency: 0.98,
    rpmIn: 30,
    targetTurns: 100,
    clampOpenRad: 0.35
  };

  function merge(a, b) {
    var o = {}, k;
    for (k in a) o[k] = a[k];
    if (b) for (k in b) if (b[k] !== undefined) o[k] = b[k];
    return o;
  }

  // modul dari jarak sumbu: a = m (z1 + z2) / 2
  function moduleOf(cfg) { return 2 * cfg.centerDist / (cfg.zA + cfg.zB); }
  function pitchRadius(cfg, z) { return moduleOf(cfg) * z / 2; }
  function ratio(cfg) { return cfg.zA / cfg.zB; }            // putaran B per putaran A

  /* Model sudah dalam posisi mesh pada sudut 0, jadi gear B cukup berputar
   * berlawanan arah dengan kecepatan sudut rasio × A. */
  function angleB(cfg, thetaA) { return -ratio(cfg) * thetaA; }

  function create(opts) {
    return { cfg: merge(DEFAULTS, opts), t: 0, thetaIn: 0, running: false, clampClosed: true, done: false };
  }
  function thetaLimit(cfg) { return cfg.targetTurns * TAU; }
  function turns(s) { return s.thetaIn / TAU; }

  /* Majukan dt detik. Mengembalikan jumlah putaran utuh yang baru selesai. */
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
  function reset(s) { s.t = 0; s.thetaIn = 0; s.running = false; s.done = false; }

  function readout(s) {
    var c = s.cfg, r = ratio(c), n = turns(s);
    var moving = s.running && s.clampClosed && !s.done;
    var w = moving ? c.rpmIn * TAU / 60 : 0;
    return {
      ratio: r,
      module: moduleOf(c),
      rpmA: moving ? c.rpmIn : 0,
      rpmB: moving ? c.rpmIn * r : 0,
      meshHz: moving ? c.rpmIn / 60 * c.zA : 0,
      pitchVel: w * pitchRadius(c, c.zA),                 // mm/s di lingkaran pitch
      rimVel: w * MODEL.handwheelD / 2,                   // mm/s di tepi handwheel
      thetaA: s.thetaIn,
      thetaB: angleB(c, s.thetaIn),
      turns: n,
      turnsInt: Math.floor(n + 1e-9),
      progress: n / c.targetTurns,
      torqueGain: c.efficiency / r,
      done: s.done
    };
  }

  return {
    MODEL: MODEL, DEFAULTS: DEFAULTS, TAU: TAU,
    moduleOf: moduleOf, pitchRadius: pitchRadius, ratio: ratio, angleB: angleB,
    create: create, step: step, turns: turns, reset: reset, readout: readout
  };
});
