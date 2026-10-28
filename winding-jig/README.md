# Winding Jig JI9G CMG21

Simulasi 3D interaktif jig winding JI9G CMG21 dengan three.js (r128). Semua model dibuat prosedural tanpa aset, dan suaranya disintesis dengan Web Audio.

- Rangkaian gear modul 1,5, involute 20°: A 48T (handwheel) → B 16T (spindle bobbin, rasio 1:3) dan C 24T (penghitung).
- Lilitan 4 alur yang menumpuk per lapisan, dengan sisir pemandu yang bergeser bolak-balik.
- Klem bisa dibuka/ditutup dengan mengetuk gagang knurling; spindle terkunci saat klem terbuka.

## File

| File | Isi |
|---|---|
| `index.html` | Halaman 3D, HUD, dan audio |
| `sim.js` | Modul simulasi murni (dipakai halaman dan tes) |
| `test/sim.test.js` | Tes angka simulasi (`node:test`) |
| `test/shoot.js` | Screenshot Playwright + cek angka HUD vs `sim.js` |
| `vendor/` | Salinan three.js r128 untuk tes offline |

## Menjalankan

```bash
npm test            # 14 tes simulasi
npm run shoot       # butuh playwright + chromium; hasil di shots/
```

Buka `index.html` lewat server statis (misalnya `npx serve .`). Halaman memuat three.js dari jsDelivr.
