# Winding Jig JI9G CMG21

Simulasi 3D interaktif jig winding JI9G CMG21. Model 3D dimuat langsung dari export SketchUp `CMG21-22-25-20_WINDING_JIG` tanpa mengubah geometrinya; halaman hanya menambahkan poros putar, garis tepi gaya SketchUp, dan suara sintesis Web Audio.

- Handwheel kaca Ø60, hub, poros, dan gear bawah 10T (group_28) berputar di sumbu y = 108,12 mm.
- Gear atas 10T (group_30) di y = 119,02 mm berputar berlawanan arah, rasio 1:1, modul 1,09 mm (dari jarak sumbu 10,90 mm).
- Klem krem dan gagang knurling (group_62) berengsel di pin group_65; poros terkunci saat klem terbuka.

## File

| File | Isi |
|---|---|
| `index.html` | Halaman 3D, HUD, dan audio |
| `model/jig.xml` | File COLLADA asli dari SketchUp (isi identik dengan `.dae`, hanya ekstensinya diganti agar bisa disajikan) |
| `sim.js` | Modul simulasi murni (dipakai halaman dan tes) |
| `test/sim.test.js` | Tes angka simulasi (`node:test`) |
| `test/shoot.js` | Screenshot Playwright + cek model dan angka HUD vs `sim.js` |
| `vendor/` | Salinan three.js r128 dan loader-nya untuk tes offline |

Tekstur `material_3`, `material_18`, `material_19`, dan dua material `Translucent_Glass_Tinted` belum ada; selama foldernya belum ditambahkan, part tersebut memakai warna pengganti. Taruh folder `CMG21-22-25-20 WINDING JIG/` hasil export di dalam `model/`.

## Menjalankan

```bash
npm test            # tes simulasi
npm run shoot       # butuh playwright + chromium; hasil di shots/
```

Buka `index.html` lewat server statis (misalnya `npx serve .`).
