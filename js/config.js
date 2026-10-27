// Konfigurasi IEPMP – semua data bersifat SINTETIS (simulasi).
// Koordinat, laju emisi, dan parameter tanah dapat diubah bebas.

// Baku mutu udara ambien: PP No. 22/2021 Lampiran VII (ug/m3).
// Mohon verifikasi ulang terhadap salinan resmi sebelum dipakai di laporan.
export const BAKU_MUTU_UDARA = {
  PM25: { label: 'PM2.5', avg: '24 jam', bm: 55, bmTahunan: 15 },
  PM10: { label: 'PM10',  avg: '24 jam', bm: 75, bmTahunan: 40 },
  SO2:  { label: 'SO₂',   avg: '1 jam',  bm: 150, bm24: 75, bmTahunan: 45 },
  NO2:  { label: 'NO₂',   avg: '1 jam',  bm: 200, bm24: 65, bmTahunan: 50 },
};

// Baku mutu kontaminan air tanah: NILAI PLACEHOLDER, ganti dengan lampiran
// PP 22/2021 (baku mutu air) atau standar yang Anda pakai dalam penelitian.
export const BAKU_MUTU_AIRTANAH = {
  TDS: { label: 'TDS', unit: 'mg/L', bm: 1000, c0: 5000 },
  Pb:  { label: 'Pb',  unit: 'mg/L', bm: 0.03, c0: 0.5 },
};

// Skenario udara: PLTU hipotetis. Offset sumber dalam meter (E,N) dari pusat.
export const SKENARIO_UDARA = {
  nama: 'PLTU (hipotetis)',
  pusat: [-6.7490, 108.5880],
  luasKm: 16,                       // sisi domain (km)
  sumber: [
    { id: 'S1', nama: 'Cerobong Unit 1', e: 0,   n: 0,   H: 60, d: 3.0, vs: 10, Ts: 350,
      Q: { PM25: 12, PM10: 14, SO2: 50, NO2: 35 } },          // g/s
    { id: 'S2', nama: 'Cerobong Unit 2', e: 150, n: 80,  H: 60, d: 3.0, vs: 10, Ts: 350,
      Q: { PM25: 12, PM10: 14, SO2: 50, NO2: 35 } },
  ],
  background: { PM25: 12, PM10: 28, SO2: 8, NO2: 14 },          // ug/m3
  sampling: [
    { nama: 'T1 Desa Timur', e: 2500, n: 400 },
    { nama: 'T2 Permukiman Selatan', e: 800, n: -3300 },
    { nama: 'T3 Sekolah Barat', e: -3000, n: 1800 },
  ],
  // Permukiman sintetis: populasi, sebaran (sigma, m)
  permukiman: [
    { nama: 'Desa A', e: 2200, n: 500,  pop: 5200, s: 700 },
    { nama: 'Desa B', e: 4800, n: -900, pop: 3800, s: 900 },
    { nama: 'Kel. C', e: -3000, n: 1900, pop: 7400, s: 800 },
    { nama: 'Desa D', e: 900, n: -3400, pop: 4100, s: 750 },
    { nama: 'Kota E', e: 6500, n: 2200, pop: 11000, s: 1200 },
  ],
};

// Skenario tanah & air tanah: TPA hipotetis.
export const SKENARIO_TANAH = {
  nama: 'TPA Regional (hipotetis)',
  pusat: [-6.7930, 108.5400],
  luasM: 3000,                      // sisi domain (m)
  sumber: { e: -1100, n: 0, lebar: 160, panjang: 240 },
  sumur: [
    { nama: 'SW-1 (100 m)', e: -920, n: 0 },
    { nama: 'SW-2 (400 m)', e: -620, n: 40 },
    { nama: 'SW-3 (800 m)', e: -220, n: -60 },
  ],
  param: { K: 5, grad: 0.02, ne: 0.3, aL: 15, rhoB: 1.6, Kd: 0.1, lambda: 0.0003, arah: 90 },
};

export const KELAS_STABILITAS = ['A', 'B', 'C', 'D', 'E', 'F'];

export const BASEMAPS = {
  'Google Street Map': { url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', sub: '0123', attr: '© Google' },
  'Google Satelit (hibrida)': { url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', sub: '0123', attr: '© Google' },
  'Google Terrain': { url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', sub: '0123', attr: '© Google' },
  'OpenStreetMap': { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', sub: 'abc', attr: '© OpenStreetMap' },
  'Esri Satelit': { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', sub: 'abc', attr: '© Esri' },
};

// DEM DEMO (sintetis) untuk efek topografi. Elevasi (m) pada koordinat lokal (e, n) dalam meter dari pusat.
// Ganti fungsi ini dengan pembacaan DEM nyata (mis. hasil ekspor GEE atau tile Terrarium) bila diperlukan.
// Catatan: tile Google Terrain hanyalah gambar peta berarsir, bukan data elevasi, sehingga tidak dapat dibaca nilainya.
const BUKIT = [
  { e: 3600, n: 500, h: 220, s: 900 }, { e: 6200, n: -1200, h: 300, s: 1200 },
  { e: -3500, n: -1500, h: 150, s: 1100 }, { e: 1800, n: -2800, h: 90, s: 700 }, { e: -1500, n: 3500, h: 120, s: 900 },
];
export function elevUdara(e, n) {
  let z = 12 + 0.0006 * e;
  for (const b of BUKIT) z += b.h * Math.exp(-((e - b.e) ** 2 + (n - b.n) ** 2) / (2 * b.s * b.s));
  return z;
}
