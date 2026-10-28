/* Simulasi winding jig JI9G CMG21 — murni angka, tanpa three.js.
 * Angka gear diukur dari model SketchUp CMG21-22-25-20_WINDING_JIG.dae:
 *   gear bawah (group_28) 10 gigi, pusat y = 108,12 mm, di poros handwheel
 *   gear atas  (group_30) 10 gigi, pusat y = 119,02 mm
 *   gear bobbin (group_33, di dalam drum group_32) 10 gigi, pusat y = 129,46 mm
 *   jarak sumbu bawah–atas 10,90 mm → modul 1,09 mm; semua rasio 1 : 1
 *   rantai: handwheel → gear bawah → gear atas → bobbin
 *   dua kawat dililit bersamaan di alur 1 dan 7 (ujung kiri dan kanan bobbin)
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
    axisC: { x: 29.62, y: 129.46 },   // drum bobbin + gear 10T-nya
    hinge: { x: 56.5, y: 123.2 },     // pin engsel klem (group_65)
    coreR: 5.89,                      // inti bobbin (raycast group_33)
    flangeR: 8.39,                    // tepi flens
    // alur lilitan di antara flens, z dalam mm (urut dari belakang ke depan)
    slots: [[-9.51, -8.31], [-7.81, -6.01], [-5.51, -3.71], [-3.21, -2.31], [-1.91, -1.01], [-0.51, 1.29], [1.79, 3.59]],
    // dua kawat dililit bersamaan, masing-masing di alur ujung bobbin (seperti foto jig)
    wires: [{ name: 'kiri', slots: [0] }, { name: 'kanan', slots: [6] }],
    zA: 10, zB: 10, zC: 10,
    outerR: 6.3,                      // radius kepala gigi terukur
    handwheelD: 60                    // diameter piringan handwheel
  };

  var DEFAULTS = {
    zA: MODEL.zA,
    zB: MODEL.zB,
    zC: MODEL.zC,
    centerDist: MODEL.axisB.y - MODEL.axisA.y,   // 10,90 mm
    efficiency: 0.98,
    rpmIn: 30,
    targetTurns: 100,                 // putaran handwheel (diturunkan dari lilitan per alur)
    wireD: 0.2,
    turnsPerSlot: 20,
    clampOpenRad: Math.PI / 2          // klem toggle membuka 90°
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
  function ratioC(cfg) { return cfg.zA / cfg.zC; }           // putaran bobbin per putaran A (zB batal)

  /* Model sudah dalam posisi mesh pada sudut 0, jadi gear B cukup berputar
   * berlawanan arah dengan kecepatan sudut rasio × A. */
  function angleB(cfg, thetaA) { return -ratio(cfg) * thetaA; }
  /* Bobbin digerakkan gear atas: berlawanan arah dengan B, jadi searah dengan A. */
  function angleC(cfg, thetaA) { return -(cfg.zB / cfg.zC) * angleB(cfg, thetaA); }

  // ---------- lilitan kawat ke bobbin ----------
  function slotWidth(i) { return MODEL.slots[i][1] - MODEL.slots[i][0]; }
  function turnsPerLayer(cfg, i) { return Math.max(1, Math.floor(slotWidth(i) / cfg.wireD + 1e-9)); }
  function maxLayers(cfg) { return Math.max(1, Math.floor((MODEL.flangeR - MODEL.coreR) / cfg.wireD + 1e-9)); }
  function slotCapacity(cfg, i) { return turnsPerLayer(cfg, i) * maxLayers(cfg); }
  function usedSlots() { var u = []; MODEL.wires.forEach(function(w){ w.slots.forEach(function(i){ u.push(i); }); }); return u; }
  /* lilitan per alur dibatasi alur terpakai yang paling kecil kapasitasnya */
  function maxTurnsPerSlot(cfg) { var m = Infinity; usedSlots().forEach(function(i){ m = Math.min(m, slotCapacity(cfg, i)); }); return m; }
  /* putaran bobbin sampai selesai: kawat berjalan bersamaan, jadi ditentukan kawat dengan alur terbanyak */
  function totalTurns(cfg) { var k = 0; MODEL.wires.forEach(function(w){ k = Math.max(k, w.slots.length); }); return cfg.turnsPerSlot * k; }

  /* Panjang kawat (mm) untuk f lilitan di alur i: lapisan k punya radius garis tengah coreR + d(k + 1/2). */
  function slotLength(cfg, i, f) {
    var tpl = turnsPerLayer(cfg, i), len = 0, k = 0, left = Math.max(0, f);
    while (left > 1e-12) { var t = Math.min(tpl, left); len += t * TAU * (MODEL.coreR + cfg.wireD * (k + 0.5)); left -= t; k++; }
    return len;
  }

  /* Kondisi lilitan setelah bobbin berputar nb kali. Semua kawat berjalan bersamaan;
   * tiap kawat mengisi alurnya sendiri secara berurutan. */
  function winding(cfg, nb) {
    var tps = cfg.turnsPerSlot, d = cfg.wireD, total = totalTurns(cfg);
    var n = Math.max(0, Math.min(nb, total)), fills = MODEL.slots.map(function(){ return 0; }), len = 0;
    var wires = MODEL.wires.map(function(w){
      var k = w.slots.length;
      w.slots.forEach(function(si, j){ fills[si] = Math.max(0, Math.min(tps, n - j * tps)); });
      var j = n >= tps * k ? k - 1 : Math.min(k - 1, Math.floor(n / tps + 1e-12)), si = w.slots[j];
      var fa = fills[si], tpl = turnsPerLayer(cfg, si);
      var layer = fa <= 0 ? 0 : Math.ceil(fa / tpl - 1e-9);
      var li = Math.floor(fa / tpl), inLayer = fa - li * tpl;
      if (inLayer === 0 && li > 0) { li -= 1; inLayer = tpl; }
      var span = tpl * d, x = Math.min(span, inLayer * d);
      var pos = (li % 2 === 0) ? x : span - x;                            // bolak-balik tiap lapisan
      return { name: w.name, slot: si, layer: layer, turnsPerLayer: tpl,
               layZ: MODEL.slots[si][0] + Math.min(slotWidth(si) - d / 2, Math.max(d / 2, pos)) };
    });
    fills.forEach(function(f, i){ len += slotLength(cfg, i, f); });
    var layer = 0; wires.forEach(function(w){ layer = Math.max(layer, w.layer); });
    return {
      fills: fills,
      radii: fills.map(function(f, i){ return MODEL.coreR + d * Math.min(maxLayers(cfg), f / turnsPerLayer(cfg, i)); }),
      wires: wires, layer: layer,
      buildD: 2 * (MODEL.coreR + d * layer),
      lengthM: len / 1000
    };
  }

  function create(opts) {
    var cfg = merge(DEFAULTS, opts);
    cfg.turnsPerSlot = Math.max(1, Math.min(cfg.turnsPerSlot, maxTurnsPerSlot(cfg)));
    if (!opts || opts.targetTurns === undefined) cfg.targetTurns = totalTurns(cfg) / ratioC(cfg);
    return { cfg: cfg, t: 0, thetaIn: 0, running: false, clampClosed: true, done: false };
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
      rpmC: moving ? c.rpmIn * ratioC(c) : 0,
      meshHz: moving ? c.rpmIn / 60 * c.zA : 0,
      pitchVel: w * pitchRadius(c, c.zA),                 // mm/s di lingkaran pitch
      rimVel: w * MODEL.handwheelD / 2,                   // mm/s di tepi handwheel
      thetaA: s.thetaIn,
      thetaB: angleB(c, s.thetaIn),
      thetaC: angleC(c, s.thetaIn),
      bobbinTurns: n * ratioC(c),
      winding: winding(c, n * ratioC(c)),
      turns: n,
      turnsInt: Math.floor(n + 1e-9),
      progress: n / c.targetTurns,
      torqueGain: c.efficiency / r,
      done: s.done
    };
  }

  return {
    MODEL: MODEL, DEFAULTS: DEFAULTS, TAU: TAU,
    moduleOf: moduleOf, pitchRadius: pitchRadius, ratio: ratio, ratioC: ratioC, angleB: angleB, angleC: angleC,
    slotWidth: slotWidth, turnsPerLayer: turnsPerLayer, maxLayers: maxLayers, slotCapacity: slotCapacity,
    usedSlots: usedSlots, maxTurnsPerSlot: maxTurnsPerSlot, totalTurns: totalTurns, slotLength: slotLength, winding: winding,
    create: create, step: step, turns: turns, reset: reset, readout: readout
  };
});
