/* Simulasi winding jig JI9G CMG21 — murni angka, tanpa three.js.
 * Angka gear diukur dari model SketchUp CMG21-22-25-20_WINDING_JIG.dae:
 *   gear bawah (group_28) 10 gigi, pusat y = 108,12 mm, di poros handwheel
 *   gear atas  (group_30) 10 gigi, pusat y = 119,02 mm
 *   gear bobbin (group_33, di dalam drum group_32) 10 gigi, pusat y = 129,46 mm
 *   jarak sumbu bawah–atas 10,90 mm → modul 1,09 mm; semua rasio 1 : 1
 *   rantai: handwheel → gear bawah → gear atas → bobbin
 *   dua kawat dililit bersamaan: kiri alur 1→2→3, kanan alur 7→6→5, pindah alur lewat coakan flens
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
    // (group_33 + piringan group_40/42/43 yang ikut membentuk flens)
    slots: [[-9.32, -8.31], [-7.62, -6.01], [-5.32, -3.71], [-3.02, -2.31], [-1.91, -1.01], [-0.51, 1.29], [1.79, 3.59]],
    // dua kawat dililit bersamaan dari alur ujung bobbin ke arah tengah, pindah alur lewat coakan flens
    wires: [{ name: 'kiri', slots: [0, 1, 2] }, { name: 'kanan', slots: [6, 5, 4] }],
    // flens (z mm): flens k memisahkan alur k−1 dan k
    flanges: [[-9.91, -9.32], [-8.31, -7.62], [-6.01, -5.32], [-3.71, -3.02], [-2.31, -1.91], [-1.01, -0.51], [1.29, 1.79], [3.59, 4.09]],
    notchAngle: Math.PI / 2,          // sudut coakan di kerangka bobbin (atas saat diam)
    // titik datang kawat relatif sumbu bobbin: dari depan (−x), sedikit di atas flens
    feed: { dx: -45, dy: 8.39 + 0.6 },
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
    slotsPerWire: 3,
    clampOpenRad: Math.PI / 2,         // klem toggle membuka 90°
    driveDir: -1                       // arah putar handwheel (−1 = searah jarum jam dilihat dari +z) agar kawat tergulung
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
  /* alur yang dililit kawat wi, sesuai jumlah alur per kawat */
  function wireSlots(cfg, wi) { return MODEL.wires[wi].slots.slice(0, Math.max(1, Math.min(cfg.slotsPerWire, MODEL.wires[wi].slots.length))); }
  function usedSlots(cfg) { var u = []; MODEL.wires.forEach(function(w, wi){ wireSlots(cfg || DEFAULTS, wi).forEach(function(i){ u.push(i); }); }); return u; }
  /* lilitan per alur dibatasi alur terpakai yang paling kecil kapasitasnya */
  function maxTurnsPerSlot(cfg) { var m = Infinity; usedSlots(cfg).forEach(function(i){ m = Math.min(m, slotCapacity(cfg, i)); }); return m; }

  /* Panjang kawat (mm) untuk f lilitan di alur i: lapisan k punya radius garis tengah coreR + d(k + 1/2). */
  function slotLength(cfg, i, f) {
    var tpl = turnsPerLayer(cfg, i), len = 0, k = 0, left = Math.max(0, f);
    while (left > 1e-12) { var t = Math.min(tpl, left); len += t * TAU * (MODEL.coreR + cfg.wireD * (k + 0.5)); left -= t; k++; }
    return len;
  }

  /* Titik singgung kawat di sisi atas kumparan berjari-jari R (relatif sumbu bobbin). */
  function wireTangent(R) {
    var f = MODEL.feed, D = Math.hypot(f.dx, f.dy), base = Math.atan2(f.dy, f.dx), da = Math.acos(Math.min(1, R / D));
    var ang = Math.sin(base + da) > Math.sin(base - da) ? base + da : base - da;
    return { x: R * Math.cos(ang), y: R * Math.sin(ang) };
  }
  function phiAt(cfg, r, s) { var T = wireTangent(r); return Math.atan2(T.y, T.x) - cfg.driveDir * TAU * s; }
  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

  /* Posisi (z, r) kawat di dalam satu alur setelah u lilitan.
   * dir = +1: lapisan pertama mulai dari sisi z kecil; −1: mulai dari sisi z besar.
   * Tiap lilitan maju tepat satu diameter. Lilitan terakhir tiap lapisan tidak bergeser,
   * melainkan naik satu lapisan, lalu lapisan berikutnya berjalan berlawanan arah. */
  function slotPos(cfg, si, u, dir) {
    var tpl = turnsPerLayer(cfg, si), d = cfg.wireD, ml = maxLayers(cfg);
    u = Math.max(0, Math.min(u, tpl * ml));
    var li = Math.min(ml - 1, Math.floor(u / tpl)), v = u - li * tpl;          // v ∈ [0, tpl]
    var x = Math.min(v, tpl - 1) * d;
    var pos = li % 2 === 0 ? x : (tpl - 1) * d - x;                            // 0 … (tpl−1)d dari sisi awal
    var off = (slotWidth(si) - (tpl - 1) * d) / 2;
    var z = dir > 0 ? MODEL.slots[si][0] + off + pos : MODEL.slots[si][1] - off - pos;
    var c = li < ml - 1 ? smooth(v - (tpl - 1)) : 0;
    return { z: z, r: MODEL.coreR + d * (li + 0.5 + c), layer: u <= 0 ? 0 : Math.ceil(u / tpl - 1e-9) };
  }
  /* z lilitan di tepi alur yang menempel ke sisi zSide (+1 = sisi z besar) */
  function slotEdge(cfg, si, side) { var off = (slotWidth(si) - (turnsPerLayer(cfg, si) - 1) * cfg.wireD) / 2; return side > 0 ? MODEL.slots[si][1] - off : MODEL.slots[si][0] + off; }

  /* Jalur kawat di satu alur saja (alur pertama, mulai sisi z kecil). Dipertahankan untuk tes. */
  function wirePath(cfg, si, s) { var p = slotPos(cfg, si, s, +1); return { z: p.z, r: p.r, phi: phiAt(cfg, p.r, s) }; }

  /* Perpindahan antar alur lewat coakan flens (dalam satuan putaran bobbin):
   *   sesudah alur penuh, kawat ikut berputar di atas gulungan sampai coakan datang;
   *   jendela CROSS.w: geser ke tepi flens → lewat coakan → turun ke inti alur berikut. */
  var CROSS = { w: 0.2, slide: 0.35, pass: 0.5, drop: 0.9, notch: [0.3, 0.55] };
  function flangeBetween(a, b) { return Math.max(a, b); }                    // flens k memisahkan alur k−1 dan k
  /* setengah lebar sudut coakan: sudut yang ditempuh bobbin selama jendela coakan */
  function notchHalfAngle() { return Math.PI * CROSS.w * (CROSS.notch[1] - CROSS.notch[0]); }

  /* Jadwal kawat wi: urutan segmen 'slot' dan 'cross' dengan batas putaran bobbin (s0, s1). */
  function schedule(cfg, wi) {
    var slots = wireSlots(cfg, wi), tps = cfg.turnsPerSlot, d = cfg.wireD, segs = [], s = 0, dir = +1;
    for (var j = 0; j < slots.length; j++) {
      var si = slots[j];
      segs.push({ type: 'slot', si: si, dir: dir, s0: s, s1: s + tps });
      s += tps;
      if (j === slots.length - 1) break;
      var to = slots[j + 1], side = to > si ? +1 : -1, end = slotPos(cfg, si, tps, dir);
      // pusat lintasan coakan harus jatuh di sudut coakan (kerangka bobbin)
      var tc = (CROSS.slide + CROSS.pass) / 2, T = wireTangent(end.r);
      var base = (Math.atan2(T.y, T.x) - MODEL.notchAngle) / (cfg.driveDir * TAU);
      var sc = base + Math.ceil(s + tc * CROSS.w - base - 1e-9), ws = sc - tc * CROSS.w;
      segs.push({ type: 'cross', from: si, to: to, flange: flangeBetween(si, to), s0: s, ws: ws, s1: ws + CROSS.w,
                  zLast: end.z, rEnd: end.r, zA: slotEdge(cfg, si, side), zB: slotEdge(cfg, to, -side), rCore: MODEL.coreR + d / 2 });
      s = ws + CROSS.w; dir = side;                                           // alur berikut mulai dari sisi flens yang dilewati
    }
    return segs;
  }
  function wireTurns(cfg, wi) { var sg = schedule(cfg, wi); return sg[sg.length - 1].s1; }
  /* putaran bobbin sampai semua kawat selesai */
  function totalTurns(cfg) { var k = 0; MODEL.wires.forEach(function(w, wi){ k = Math.max(k, wireTurns(cfg, wi)); }); return k; }

  /* Titik garis tengah kawat wi setelah bobbin berputar s kali (kerangka bobbin, kontinu). */
  function wirePathW(cfg, wi, s, segs) {
    segs = segs || schedule(cfg, wi);
    var g = segs[segs.length - 1];
    s = Math.max(0, Math.min(s, g.s1));
    for (var i = 0; i < segs.length; i++) if (s <= segs[i].s1 + 1e-12) { g = segs[i]; break; }
    var z, r, info = { seg: g.type, slot: g.type === 'slot' ? g.si : g.from };
    if (g.type === 'slot') { var p = slotPos(cfg, g.si, s - g.s0, g.dir); z = p.z; r = p.r; info.layer = p.layer; info.fill = s - g.s0; }
    else {
      r = g.rEnd; z = g.zLast;
      var t = (s - g.ws) / CROSS.w;
      if (t > 0) {
        if (t < CROSS.slide) z = g.zLast + (g.zA - g.zLast) * smooth(t / CROSS.slide);
        else if (t < CROSS.pass) z = g.zA + (g.zB - g.zA) * smooth((t - CROSS.slide) / (CROSS.pass - CROSS.slide));
        else { z = g.zB; r = g.rEnd + (g.rCore - g.rEnd) * smooth((t - CROSS.pass) / (CROSS.drop - CROSS.pass)); }
      }
      info.to = g.to; info.flange = g.flange; info.t = t;
    }
    info.z = z; info.r = r; info.phi = phiAt(cfg, r, s);
    return info;
  }

  /* Kondisi lilitan setelah bobbin berputar nb kali. Semua kawat berjalan bersamaan. */
  function winding(cfg, nb) {
    var tps = cfg.turnsPerSlot, d = cfg.wireD, fills = MODEL.slots.map(function(){ return 0; }), len = 0;
    var wires = MODEL.wires.map(function(w, wi){
      var segs = schedule(cfg, wi), n = Math.max(0, Math.min(nb, segs[segs.length - 1].s1));
      segs.forEach(function(g){
        if (g.type === 'slot') fills[g.si] = Math.max(0, Math.min(tps, n - g.s0));
        else if (n > g.s0) len += TAU * g.rEnd * (Math.min(n, g.s1) - g.s0);    // kawat lintasan pindah (perkiraan keliling)
      });
      var p = wirePathW(cfg, wi, n, segs), si = p.slot, fa = fills[si];
      return { name: w.name, slot: si, crossing: p.seg === 'cross' ? p.to : null, layer: fa <= 0 ? 0 : Math.ceil(fa / turnsPerLayer(cfg, si) - 1e-9),
               turnsPerLayer: turnsPerLayer(cfg, si), fill: fa, layZ: p.z, r: p.r, done: n >= segs[segs.length - 1].s1 - 1e-9 };
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
      thetaA: c.driveDir * s.thetaIn,
      thetaB: angleB(c, c.driveDir * s.thetaIn),
      thetaC: angleC(c, c.driveDir * s.thetaIn),
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
    wireTangent: wireTangent, wirePath: wirePath, usedSlots: usedSlots, wireSlots: wireSlots, CROSS: CROSS,
    schedule: schedule, wireTurns: wireTurns, notchHalfAngle: notchHalfAngle, wirePathW: wirePathW, slotPos: slotPos, maxTurnsPerSlot: maxTurnsPerSlot, totalTurns: totalTurns, slotLength: slotLength, winding: winding,
    create: create, step: step, turns: turns, reset: reset, readout: readout
  };
});
