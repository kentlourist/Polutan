# IEPMP – Integrated Environmental Pollution Modeling Platform (versi GitHub Pages)

Simulasi sebaran polutan **udara** (Gaussian plume) dan **tanah/air tanah** (adveksi–dispersi–reaksi, beda hingga),
dievaluasi terhadap baku mutu **PP No. 22/2021**, divisualisasikan interaktif di **Leaflet** dengan basemap
**Google Street Map / Satelit / Terrain**, OpenStreetMap, dan Esri. Seluruh data bersifat **sintetis**.
Tanpa server: semua perhitungan berjalan di browser.

## Menjalankan di GitHub
1. Buat repositori, unggah seluruh isi folder ini ke branch `main`.
2. **Settings → Pages → Source: GitHub Actions**.
3. Push. Workflow `pages.yml` menjalankan uji verifikasi lalu men-deploy. Situs ada di `https://<user>.github.io/<repo>/`.

Lokal: `python3 -m http.server 8000` lalu buka `http://localhost:8000` (ES module butuh server, bukan klik ganda).
Uji solver: `node tests/verify.mjs`.

## Pemetaan ke metodologi 9 level
| Level | Implementasi |
|---|---|
| 1–2 Proses fisik & persamaan dasar | Adveksi–difusi, deposisi, Darcy, ADR, sorpsi (`js/engine.js`) |
| 3 Parameterisasi | Parameter sintetis di `js/config.js`, termasuk **DEM demo** `elevUdara(e,n)` (pengganti DEM/ERA5/SoilGrids dari GEE) |
| 4 Diskretisasi | Gaussian analitik (udara); FDM upwind dengan koreksi dispersi numerik (air tanah) |
| 5 Solver | `solveAir`, `solveGW` |
| 6 Verifikasi | `tests/verify.mjs` (Ogata–Banks, retardasi, kekekalan massa plume), dijalankan di GitHub Actions |
| 7 Kepatuhan | Tabel baku mutu, status, area melebihi |
| 8 Risiko | Indeks bahaya relatif (C/BM), populasi terpapar (permukiman sintetis) |
| 9 Visualisasi | Peta interaktif, animasi 24 jam / waktu, klik-baca nilai, **tampilan 3D** (medan + awan plume / blok akuifer, bisa diputar), **profil vertikal**, **penampang memanjang & melintang**, grafik konsentrasi–waktu |

## Mengganti data
Edit `js/config.js`: koordinat pusat, sumber emisi (H, d, vs, Ts, Q), permukiman, titik sampling, parameter akuifer, baku mutu.

## Catatan penting
- **Baku mutu**: nilai udara dari PP 22/2021 Lampiran VII; **verifikasi ulang** terhadap salinan resmi. Baku mutu air tanah di `BAKU_MUTU_AIRTANAH` hanyalah **placeholder**.
- **Tile Google** diakses langsung tanpa API key dan tidak sesuai ketentuan layanan Google untuk penggunaan produksi/publik. Untuk publikasi, pakai Google Maps JavaScript API (dengan key) atau basemap OSM/Esri.
- **Topografi**: tile Google Terrain hanya gambar peta berarsir, bukan data elevasi, jadi nilai ketinggiannya tidak bisa dibaca program. Karena itu efek topografi memakai DEM demo sintetis (`elevUdara` di `js/config.js`); Google Terrain tetap tersedia sebagai basemap visual. Untuk DEM nyata, ganti fungsi itu dengan pembacaan raster hasil ekspor GEE (SRTM/Copernicus) atau tile elevasi terbuka.
- **Koreksi terrain** bergaya ISC: tinggi plume di atas tanah dikurangi 0,5×(selisih elevasi) untuk kelas A–D dan 1,0× untuk E–F (minimum 10 m). Di kelas stabil, plume menghantam bukit sehingga nilai sangat tinggi; ini perilaku konservatif khas model skrining, bukan prediksi kejadian nyata.
- **Penampang air tanah** adalah solver 2D terpisah pada bidang vertikal (x–z) sepanjang arah aliran (arah 90°), dengan dispersi vertikal αV = αL/100 dan laju infiltrasi ke bawah 0,005 m/hari (ubah di `js/app.js`). Ini bukan model 3D penuh; sumber ada di x = −1100 m.
- Belum ada: kalibrasi dengan data lapangan, benchmark AERMOD/MODFLOW, data GEE nyata, laporan PDF otomatis, efek bangunan/wake, dan arah angin yang berubah terhadap topografi (aliran angin diasumsikan seragam).
- Gaussian plume bersifat steady-state, cocok untuk skala puluhan km; keluaran dibandingkan dengan baku mutu waktu pendek.
