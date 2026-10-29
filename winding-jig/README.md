# Winding Jig JI9G CMG21

Simulasi 3D interaktif jig winding JI9G CMG21. Model 3D dimuat langsung dari export SketchUp `CMG21-22-25-20_WINDING_JIG` tanpa mengubah geometrinya; halaman hanya menambahkan poros putar, garis tepi gaya SketchUp, dan suara sintesis Web Audio.

- Handwheel kaca Ø60, hub, poros, dan gear bawah 10T (group_28) berputar di sumbu y = 108,12 mm.
- Gear atas 10T (group_30) di y = 119,02 mm berputar berlawanan arah, rasio 1:1, modul 1,09 mm (dari jarak sumbu 10,90 mm).
- Gear bobbin 10T (group_33) di y = 129,46 mm digerakkan gear atas, jadi bobbin berputar searah handwheel. Braket group_41 tetap diam.
- Dua kawat dililit bersamaan: kawat kiri alur 1 → 2 → 3, kawat kanan alur 7 → 6 → 5, dengan jumlah lilitan sama per alur (alur per kawat bisa 1–3). Keduanya datang mendatar dari sisi depan. Batas 7 alur dan 8 flens diukur dari group_33 beserta piringan group_40/42/43.
- Setelah satu alur penuh, kawat ikut berputar di atas gulungan sampai coakan lewat, lalu bergeser ke tepi flens, masuk lewat coakan, dan turun ke inti alur berikutnya. Coakan (±9°, sampai ke inti) ditambahkan di flens 1|2, 2|3, 5|6, 6|7 lewat shader yang membuang bagian flens di daerah itu, plus dinding dan dasar coakan. Ini satu-satunya perubahan tampilan pada model; geometri file tidak diubah.
- Klem toggle krem dan gagang knurling (group_62) membuka 90° di pin group_65; poros terkunci saat klem terbuka.
- Garis tepi tidak digambar pada bobbin supaya tidak berkedip saat berputar.
- Kawat tergulung digambar sebagai tabung Ø kawat yang mengikuti jalur spiral sebenarnya (`wirePath` di `sim.js`): tiap lilitan maju satu diameter, naik satu lapis di ujung alur lalu berbalik arah, dan ujungnya selalu tersambung dengan kawat yang datang.

## File

| File | Isi |
|---|---|
| `index.html` | Halaman 3D, HUD, dan audio |
| `model/jig.xml` | File COLLADA asli dari SketchUp (isi identik dengan `.dae`, hanya ekstensinya diganti agar bisa disajikan) |
| `sim.js` | Modul simulasi murni (dipakai halaman dan tes) |
| `test/sim.test.js` | Tes angka simulasi (`node:test`) |
| `test/shoot.js` | Screenshot Playwright + cek model dan angka HUD vs `sim.js` |
| `vendor/` | Salinan three.js r128 dan loader-nya untuk tes offline |
| `tools/record.js` | Rekam simulasi jadi video MP4 1080p/30 fps dengan suara sintesis |

Tekstur `material_3`, `material_18`, `material_19`, dan dua material `Translucent_Glass_Tinted` belum ada; selama foldernya belum ditambahkan, part tersebut memakai warna pengganti. Taruh folder `CMG21-22-25-20 WINDING JIG/` hasil export di dalam `model/`.

## Menjalankan

```bash
npm test            # tes simulasi
npm run shoot       # butuh playwright + chromium; hasil di shots/
npm run video       # render video/winding-jig.mp4 (butuh playwright + ffmpeg; bisa dilanjutkan bila terputus)
```

Buka `index.html` lewat server statis (misalnya `npx serve .`).
