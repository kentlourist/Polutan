import { BAKU_MUTU_UDARA as BMU, BAKU_MUTU_AIRTANAH as BMG, SKENARIO_UDARA as SU, SKENARIO_TANAH as ST, BASEMAPS, elevUdara } from './config.js';
import { solveAir, solveGW, sampleGrid, luasPopulasi, evaluasi, sigma } from './engine.js';
import { Scene3D, heat, ticks, xyChart, ramp as vramp, mix } from './views.js';
import { initUI } from './ui.js';

const $ = (s) => document.querySelector(s);
const fmt = (x, d = 1) => (x >= 1000 ? x.toFixed(0) : x >= 10 ? x.toFixed(d) : x >= 0.1 ? x.toFixed(2) : x.toPrecision(2));
const toLL = (c, e, n) => [c[0] + n / 111320, c[1] + e / (111320 * Math.cos(c[0] * Math.PI / 180))];
const toEN = (c, ll) => [(ll.lng - c[1]) * 111320 * Math.cos(c[0] * Math.PI / 180), (ll.lat - c[0]) * 111320];
const boundsOf = (c, half) => [toLL(c, -half, -half), toLL(c, half, half)];

// ---------- Peta: Leaflet + Google Street Map / Satelit ----------
const map = L.map('map', { preferCanvas: true }).setView(SU.pusat, 12);
const bases = {}, tstat = {};
let curBase = 'Google Street Map', ui = null, mode = 'air';
for (const [k, v] of Object.entries(BASEMAPS)) {
  const t = bases[k] = L.tileLayer(v.url, { subdomains: v.sub, attribution: v.attr, maxZoom: 20 }); tstat[k] = { ok: 0, err: 0 };
  t.on('tileload', () => { tstat[k].ok++; });
  // Bila tile Google gagal dimuat (diblokir jaringan / dibatasi Google), otomatis pindah ke OpenStreetMap agar peta tidak kosong.
  t.on('tileerror', () => { if (curBase === k && ++tstat[k].err >= 3 && !tstat[k].ok && k.startsWith('Google')) { setBase('OpenStreetMap'); ui?.toast('Tile Google tidak dapat dimuat — beralih ke OpenStreetMap', 6000); } });
}
function setBase(n) {
  if (!bases[n]) return;
  if (map.hasLayer(bases[curBase])) map.removeLayer(bases[curBase]);
  curBase = n; bases[n].addTo(map); ui?.refreshBaseUI();
}
bases[curBase].addTo(map);
L.control.scale({ imperial: false }).addTo(map);
const legend = L.control({ position: 'bottomright' });
legend.onAdd = () => { const d = L.DomUtil.create('div', 'legend'); legend._d = d; return d; };
legend.addTo(map);
const setLegend = (title, a, b, bmTxt) => { legend._d.innerHTML = `<b>${title}</b><i></i><div><span>${a}</span><span>${b}</span></div>${bmTxt ? `<div style="color:#d7261e"><span>${bmTxt}</span></div>` : ''}`; };

const RAMP = [[27, 63, 166], [31, 160, 216], [47, 191, 113], [242, 213, 31], [242, 138, 31], [215, 38, 30]];
function ramp(t) {
  t = Math.min(1, Math.max(0, t)); const x = t * (RAMP.length - 1), i = Math.min(Math.floor(x), RAMP.length - 2), f = x - i;
  return RAMP[i].map((v, k) => v + (RAMP[i + 1][k] - v) * f);
}
function paint(grid, n, fn) {
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(n, n);
  for (let k = 0; k < n * n; k++) { const [t, a] = fn(grid[k]); const [r, g, b] = ramp(t); img.data.set([r, g, b, a * 255], k * 4); }
  ctx.putImageData(img, 0, 0); return cv.toDataURL();
}
const clickPop = (txt) => (e) => { const v = txt(e.latlng); if (v) L.popup().setLatLng(e.latlng).setContent(v).openOn(map); };

// =====================================================================
// UDARA
// =====================================================================
const A = { pol: 'SO2', u: 3, dir: 260, cls: 'C', urban: 0, em: 1, rain: 0, op: .75, only: false, topo: true, x: 3000 };
const airLayers = { relief: null, overlay: null, sumber: L.layerGroup(), titik: L.layerGroup(), perm: L.layerGroup(), angin: L.layerGroup(), domain: null };
let airRes = null, airVmax = 1;
const half = SU.luasKm * 500;
airLayers.domain = L.rectangle(boundsOf(SU.pusat, half), { color: '#16346b', weight: 1, fill: false, dashArray: '4 4' });
SU.sumber.forEach((s) => L.circleMarker(toLL(SU.pusat, s.e, s.n), { radius: 7, color: '#fff', weight: 2, fillColor: '#d7261e', fillOpacity: 1 }).bindTooltip(`${s.nama}<br>H=${s.H} m`).addTo(airLayers.sumber));
SU.sampling.forEach((s) => L.circleMarker(toLL(SU.pusat, s.e, s.n), { radius: 6, color: '#0d2547', weight: 2, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(s.nama).addTo(airLayers.titik));
SU.permukiman.forEach((p) => L.circle(toLL(SU.pusat, p.e, p.n), { radius: p.s, color: '#6b4fbb', weight: 1, fillColor: '#6b4fbb', fillOpacity: .12 }).bindTooltip(`${p.nama}: ±${p.pop.toLocaleString('id')} jiwa`).addTo(airLayers.perm));

const polSel = $('#a-pol');
for (const [k, v] of Object.entries(BMU)) polSel.add(new Option(`${v.label} (baku mutu ${v.bm} µg/m³ / ${v.avg})`, k, false, k === A.pol));

function runAir() {
  const kLoss = 1e-5 + 8e-5 * Math.pow(A.rain, .64);
  const sumber = SU.sumber.map((s) => ({ ...s, Q: Object.fromEntries(Object.entries(s.Q).map(([k, v]) => [k, v * A.em])) }));
  const base = { sumber, u: A.u, dirFrom: A.dir, cls: A.cls, urban: !!A.urban, kLoss, luasM: SU.luasKm * 1000, dem: elevUdara, topo: A.topo };
  const bm = BMU[A.pol].bm;
  airRes = solveAir({ ...base, polutan: A.pol, background: SU.background[A.pol], n: 200 });
  const rurl = hillshadeURL(airRes);
  if (airLayers.relief) airLayers.relief.setUrl(rurl);
  else { airLayers.relief = L.imageOverlay(rurl, boundsOf(SU.pusat, half), { opacity: .5, interactive: false, zIndex: 2 }); if (mode === 'air') airLayers.relief.addTo(map); }
  airVmax = Math.max(airRes.max, bm * 1.2);
  const bg = SU.background[A.pol];
  const url = paint(airRes.grid, airRes.n, (c) => {
    const ex = c - bg, t = Math.sqrt(Math.max(c, 0) / airVmax);
    let a = Math.min(1, Math.max(0, ex / (0.06 * airVmax)));
    if (A.only && c <= bm) a = 0;
    return [t, a];
  });
  const b = boundsOf(SU.pusat, half);
  if (airLayers.overlay) airLayers.overlay.setUrl(url).setOpacity(A.op);
  else { airLayers.overlay = L.imageOverlay(url, b, { opacity: A.op, interactive: false, zIndex: 5 }); if (mode === 'air') { airLayers.overlay.addTo(map); buildControl(); } }
  // arah angin: garis dari sumber pertama ke arah hilir
  airLayers.angin.clearLayers();
  const to = ((A.dir + 180) % 360) * Math.PI / 180, s0 = SU.sumber[0], len = 2500;
  const p1 = toLL(SU.pusat, s0.e, s0.n), p2 = toLL(SU.pusat, s0.e + len * Math.sin(to), s0.n + len * Math.cos(to));
  L.polyline([p1, p2], { color: '#16346b', weight: 2, dashArray: '6 6' }).addTo(airLayers.angin);
  L.circleMarker(p2, { radius: 4, color: '#16346b', fillOpacity: 1 }).bindTooltip(`Angin ${A.u.toFixed(1)} m/s dari ${A.dir}°`).addTo(airLayers.angin);

  const ev = evaluasi(airRes.max, bm), ex = luasPopulasi(airRes, bm, SU.permukiman);
  $('#a-kpi').innerHTML = kpi(`${fmt(airRes.max)} µg/m³`, 'Konsentrasi maksimum') + kpi(`${bm} µg/m³`, `Baku mutu (${BMU[A.pol].avg})`)
    + kpi(`<span class="${ev.status === 'Melebihi' ? 'bad' : 'ok'}">${ev.status}</span>`, 'Status mutu')
    + kpi(ev.rasio.toFixed(2), 'Indeks bahaya relatif (C/BM)')
    + kpi(`${ex.areaKm2.toFixed(2)} km²`, 'Area melebihi baku mutu') + kpi(`${ex.pop.toLocaleString('id')} jiwa`, 'Populasi terpapar (sintetis)');
  // tabel semua polutan
  let rows = '<tr><th>Parameter</th><th>Maks</th><th>BM</th><th>Status</th></tr>';
  for (const [k, v] of Object.entries(BMU)) {
    const r = k === A.pol ? airRes : solveAir({ ...base, polutan: k, background: SU.background[k], n: 100 });
    const e = evaluasi(r.max, v.bm);
    rows += `<tr><td>${v.label} <small>(${v.avg})</small></td><td>${fmt(r.max)}</td><td>${v.bm}</td><td class="${e.status === 'Melebihi' ? 'bad' : 'ok'}">${e.status}</td></tr>`;
  }
  $('#a-tbl').innerHTML = rows;
  setLegend(`${BMU[A.pol].label} (µg/m³)`, '0', fmt(airVmax), `Baku mutu ${bm}`);
  $('#hud').innerHTML = `<span>Angin ${A.u.toFixed(1)} m/s dari ${A.dir}°</span><span>Stabilitas ${A.cls}</span><span>Tinggi efektif plume ${airRes.plume[0].toFixed(0)} m</span><span>Topografi: ${A.topo ? 'aktif' : 'nonaktif'}</span>`;
  refreshView();
}
function hillshadeURL(res) {
  const n = res.n, d = res.dem, cv = document.createElement('canvas'); cv.width = cv.height = n;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const gx = 4 * (d[j * n + Math.min(i + 1, n - 1)] - d[j * n + Math.max(i - 1, 0)]) / (2 * res.dx), gy = 4 * (d[Math.max(j - 1, 0) * n + i] - d[Math.min(j + 1, n - 1) * n + i]) / (2 * res.dx);
    const dot = (.5 * gx - .5 * gy + .7) / (Math.hypot(gx, gy, 1) * 1.02);   // cahaya dari barat laut
    const g = Math.min(1, Math.max(0, dot)) * 255; img.data.set([g, g, g, 150], (j * n + i) * 4);
  }
  ctx.putImageData(img, 0, 0); return cv.toDataURL();
}
const kpi = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;

// =====================================================================
// TANAH & AIR TANAH
// =====================================================================
const GP = { pol: 'TDS', K: ST.param.K, grad: ST.param.grad, dir: ST.param.arah, Kd: ST.param.Kd, lam: ST.param.lambda, days: 3650, op: .8, idx: 0, x: -620 };
const gwLayers = { overlay: null, sumber: L.layerGroup(), titik: L.layerGroup(), domain: L.rectangle(boundsOf(ST.pusat, ST.luasM / 2), { color: '#16346b', weight: 1, fill: false, dashArray: '4 4' }) };
L.rectangle([toLL(ST.pusat, ST.sumber.e - ST.sumber.lebar / 2, ST.sumber.n - ST.sumber.panjang / 2), toLL(ST.pusat, ST.sumber.e + ST.sumber.lebar / 2, ST.sumber.n + ST.sumber.panjang / 2)], { color: '#fff', weight: 2, fillColor: '#6b3b1e', fillOpacity: .9 }).bindTooltip('Sumber kontaminan (timbunan)').addTo(gwLayers.sumber);
ST.sumur.forEach((s) => L.circleMarker(toLL(ST.pusat, s.e, s.n), { radius: 6, color: '#0d2547', weight: 2, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(s.nama).addTo(gwLayers.titik));
const gSel = $('#g-pol'); for (const [k, v] of Object.entries(BMG)) gSel.add(new Option(`${v.label} (baku mutu contoh ${v.bm} ${v.unit})`, k));
let gwRes = null, secRes = null, playTimer = null;

function runGW() {
  const n = 150, dx = ST.luasM / n, S = ST.sumber, c = BMG[GP.pol];
  $('#g-run').textContent = 'Menghitung…';
  setTimeout(() => {
    gwRes = solveGW({ n, luasM: ST.luasM, ...ST.param, K: GP.K, grad: GP.grad, arah: GP.dir, Kd: GP.Kd, lambda: GP.lam, C0: c.c0, hari: GP.days, probes: ST.sumur,
      sourceMask: (i, j) => Math.abs(-ST.luasM / 2 + (i + .5) * dx - S.e) < S.lebar / 2 && Math.abs(ST.luasM / 2 - (j + .5) * dx - S.n) < S.panjang / 2 });
    secRes = solveGW({ n, ny: 40, dy: 1, luasM: ST.luasM, ...ST.param, K: GP.K, grad: GP.grad, arah: 90, Kd: GP.Kd, lambda: GP.lam, aT: ST.param.aL / 100, vDown: 0.005, C0: c.c0, hari: GP.days,
      sourceMask: (i, j) => j <= 2 && Math.abs(-ST.luasM / 2 + (i + .5) * dx - S.e) < S.lebar / 2 });
    const t = $('#g-t'); t.max = gwRes.snaps.length - 1; t.value = gwRes.snaps.length - 1; GP.idx = +t.value;
    $('#g-run').textContent = 'Jalankan simulasi';
    showGW(); drawChart();
  }, 20);
}
function showGW() {
  if (!gwRes) return;
  const c = BMG[GP.pol], snap = gwRes.snaps[GP.idx], vmin = c.bm / 100, vmax = c.c0, lg = Math.log10;
  const url = paint(snap.grid, gwRes.n, (v) => v < vmin ? [0, 0] : [(lg(v) - lg(vmin)) / (lg(vmax) - lg(vmin)), .92]);
  if (gwLayers.overlay) gwLayers.overlay.setUrl(url).setOpacity(GP.op);
  else gwLayers.overlay = L.imageOverlay(url, boundsOf(ST.pusat, ST.luasM / 2), { opacity: GP.op, interactive: false });
  if (mode === 'gw' && !map.hasLayer(gwLayers.overlay)) { gwLayers.overlay.addTo(map); buildControl(); }
  let cnt = 0, reach = 0; const h = ST.luasM / 2;
  for (let j = 0; j < gwRes.n; j++) for (let i = 0; i < gwRes.n; i++) if (snap.grid[j * gwRes.n + i] > c.bm) {
    cnt++; reach = Math.max(reach, Math.hypot(-h + (i + .5) * gwRes.dx - ST.sumber.e, h - (j + .5) * gwRes.dx - ST.sumber.n));
  }
  const tahun = snap.t / 365;
  $('#o-t').textContent = tahun < 2 ? `${snap.t.toFixed(0)} hari` : `${tahun.toFixed(1)} tahun`;
  const maxWell = Math.max(...gwRes.series.map((s) => s[GP.idx]));
  $('#g-kpi').innerHTML = kpi(`${gwRes.v.toFixed(2)} m/hari`, 'Kecepatan pori (v = K·i/nₑ)') + kpi(gwRes.R.toFixed(2), 'Faktor retardasi R')
    + kpi(`${(cnt * gwRes.dx * gwRes.dx / 1e4).toFixed(1)} ha`, 'Area di atas baku mutu') + kpi(`${reach.toFixed(0)} m`, 'Jangkauan dari pusat sumber')
    + kpi(`${fmt(maxWell)} ${c.unit}`, 'Maks. di sumur pantau') + kpi(`<span class="${maxWell > c.bm ? 'bad' : 'ok'}">${maxWell > c.bm ? 'Melebihi' : 'Memenuhi'}</span>`, 'Status sumur pantau');
  setLegend(`${c.label} (${c.unit}, skala log)`, fmt(vmin), fmt(vmax), `Baku mutu ${c.bm}`);
  $('#hud').innerHTML = `<span>Arah aliran ${GP.dir}°</span><span>K = ${GP.K} m/hari</span><span>t = ${$('#o-t').textContent}</span>`;
  drawChart(); refreshView();
}
function drawChart() {
  const cv = $('#chart'); if (!cv.offsetWidth || !gwRes) return;
  const r = devicePixelRatio || 1, W = cv.width = cv.offsetWidth * r, H = cv.height = 150 * r, x = cv.getContext('2d'); x.scale(r, r);
  const w = W / r, h = H / r, c = BMG[GP.pol], pad = { l: 38, r: 8, t: 8, b: 20 }, T = gwRes.snaps.map((s) => s.t), tm = T.at(-1) || 1;
  const ymax = c.c0, X = (t) => pad.l + t / tm * (w - pad.l - pad.r), Y = (v) => h - pad.b - Math.min(v, ymax) / ymax * (h - pad.t - pad.b);
  x.clearRect(0, 0, w, h); x.font = '10px sans-serif'; x.fillStyle = '#5d6b82'; x.strokeStyle = '#dbe2ec';
  [0, .5, 1].forEach((f) => { x.beginPath(); x.moveTo(pad.l, Y(f * ymax)); x.lineTo(w - pad.r, Y(f * ymax)); x.stroke(); x.fillText(fmt(f * ymax), 2, Y(f * ymax) + 3); });
  x.fillText('0', pad.l, h - 6); x.fillText(`${(tm / 365).toFixed(0)} th`, w - 30, h - 6);
  x.strokeStyle = '#d7261e'; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(pad.l, Y(c.bm)); x.lineTo(w - pad.r, Y(c.bm)); x.stroke(); x.setLineDash([]);
  ['#1f6feb', '#2e9e6b', '#f28a1f'].forEach((col, q) => { x.strokeStyle = col; x.lineWidth = 2; x.beginPath(); gwRes.series[q].forEach((v, k) => k ? x.lineTo(X(T[k]), Y(v)) : x.moveTo(X(T[k]), Y(v))); x.stroke(); });
  x.strokeStyle = '#14223b'; x.lineWidth = 1; x.beginPath(); x.moveTo(X(T[GP.idx]), pad.t); x.lineTo(X(T[GP.idx]), h - pad.b); x.stroke();
}

// =====================================================================
// Kontrol, tab, interaksi
// =====================================================================
const overlays = () => {
  const ov = mode === 'air'
    ? { 'Sebaran polutan udara': airLayers.overlay, 'Relief DEM (demo)': airLayers.relief, 'Sumber emisi': airLayers.sumber, 'Titik sampling': airLayers.titik, 'Permukiman (sintetis)': airLayers.perm, 'Arah angin': airLayers.angin, 'Batas domain': airLayers.domain }
    : { 'Sebaran kontaminan air tanah': gwLayers.overlay, 'Sumber kontaminan': gwLayers.sumber, 'Sumur pantau': gwLayers.titik, 'Batas domain': gwLayers.domain };
  for (const k of Object.keys(ov)) if (!ov[k]) delete ov[k];
  return ov;
};
function buildControl() { ui?.renderLayers(); }
function setMode(m) {
  mode = m; stopAll();
  const groups = [airLayers.relief, airLayers.overlay, airLayers.sumber, airLayers.titik, airLayers.perm, airLayers.angin, airLayers.domain, gwLayers.overlay, gwLayers.sumber, gwLayers.titik, gwLayers.domain];
  groups.forEach((g) => g && map.hasLayer(g) && map.removeLayer(g));
  const on = m === 'air' ? [airLayers.relief, airLayers.overlay, airLayers.sumber, airLayers.titik, airLayers.perm, airLayers.angin, airLayers.domain] : [gwLayers.overlay, gwLayers.sumber, gwLayers.titik, gwLayers.domain];
  on.forEach((g) => g && g.addTo(map));
  $('#tab-air').classList.toggle('on', m === 'air'); $('#tab-gw').classList.toggle('on', m === 'gw');
  $('#panel-air').hidden = m !== 'air'; $('#panel-gw').hidden = m !== 'gw';
  scene.ex = m === 'air' ? 2 : 12; $('#v-ex').value = scene.ex; $('#o-ex').textContent = `×${scene.ex}`; $('#sec').classList.toggle('gw', m === 'gw');
  if (m === 'air') { map.fitBounds(boundsOf(SU.pusat, half * .6)); runAir(); } else { map.fitBounds(boundsOf(ST.pusat, ST.luasM * .42)); gwRes ? showGW() : runGW(); }
  buildControl(); refreshView();
}
$('#tab-air').onclick = () => setMode('air'); $('#tab-gw').onclick = () => setMode('gw');

let deb; const later = (f) => { clearTimeout(deb); deb = setTimeout(f, 60); };
function bind(id, key, obj, out, f = (v) => v, label = (v) => v) {
  const el = $(id), o = out && $(out);
  const upd = () => { obj[key] = f(el.value); if (o) o.textContent = label(obj[key]); };
  el.addEventListener('input', () => { upd(); if (obj === A) later(runAir); else if (key === 'op') showGW(); else if (key === 'x') refreshView(); }); upd();
}
bind('#a-u', 'u', A, '#o-u', Number, (v) => `${v.toFixed(1)} m/s`);
bind('#a-dir', 'dir', A, '#o-dir', Number, (v) => `${v}°`);
bind('#a-em', 'em', A, '#o-em', Number, (v) => `×${v.toFixed(1)}`);
bind('#a-rain', 'rain', A, '#o-rain', Number, (v) => `${v} mm/jam`);
bind('#a-op', 'op', A, '#o-op', Number, (v) => `${Math.round(v * 100)}%`);
['#a-pol:pol', '#a-cls:cls', '#a-urb:urban'].forEach((s) => { const [id, k] = s.split(':'); $(id).addEventListener('change', (e) => { A[k] = k === 'urban' ? +e.target.value : e.target.value; runAir(); }); });
$('#a-only').addEventListener('change', (e) => { A.only = e.target.checked; runAir(); });
$('#a-topo').addEventListener('change', (e) => { A.topo = e.target.checked; runAir(); });
bind('#a-x', 'x', A, '#o-x', Number, (v) => `${v} m`);
bind('#g-x', 'x', GP, '#o-gx', Number, (v) => `${v} m`);

bind('#g-K', 'K', GP, '#o-K', Number, (v) => `${v} m/hari`);
bind('#g-i', 'grad', GP, '#o-i', Number, (v) => v.toFixed(3));
bind('#g-dir', 'dir', GP, '#o-gdir', Number, (v) => `${v}°`);
bind('#g-Kd', 'Kd', GP, '#o-Kd', Number, (v) => `${v} L/kg`);
bind('#g-lam', 'lam', GP, '#o-lam', Number, (v) => `${v}/hari`);
bind('#g-op', 'op', GP, '#o-gop', Number, (v) => `${Math.round(v * 100)}%`);
$('#g-t').addEventListener('input', (e) => { GP.idx = +e.target.value; showGW(); });
$('#g-pol').addEventListener('change', (e) => { GP.pol = e.target.value; gwRes = null; runGW(); });
$('#g-days').addEventListener('change', (e) => { GP.days = +e.target.value; });
$('#g-run').onclick = runGW;
$('#g-play').onclick = () => {
  if (playTimer) return stopAll();
  $('#g-play').textContent = 'Berhenti'; if (GP.idx >= gwRes.snaps.length - 1) GP.idx = 0;
  playTimer = setInterval(() => { GP.idx++; $('#g-t').value = GP.idx; showGW(); if (GP.idx >= gwRes.snaps.length - 1) stopAll(); }, 250);
};
// Animasi 24 jam: meteorologi sintetis harian (stabilitas, angin, arah berubah)
let animTimer = null;
const STAB = 'FFFFFEDCBBAAABBCCDEEFFFF'.split('');
$('#a-run').onclick = runAir;
$('#a-anim').onclick = () => {
  if (animTimer) return stopAll();
  let h = 0; $('#a-anim').textContent = 'Berhenti';
  animTimer = setInterval(() => {
    A.cls = STAB[h % 24]; A.u = Math.max(1.5, 2.8 + 1.8 * Math.sin(Math.PI * (h - 6) / 12)); A.dir = Math.round((260 + 40 * Math.sin(2 * Math.PI * h / 24) + 360) % 360);
    $('#a-cls').value = A.cls; $('#a-u').value = A.u; $('#a-dir').value = A.dir; $('#o-u').textContent = `${A.u.toFixed(1)} m/s`; $('#o-dir').textContent = `${A.dir}°`;
    runAir(); $('#hud').insertAdjacentHTML('beforeend', `<span><b>Pukul ${String(h % 24).padStart(2, '0')}:00</b></span>`); h++;
  }, 900);
};
function stopAll() { clearInterval(playTimer); clearInterval(animTimer); playTimer = animTimer = null; $('#g-play').textContent = 'Putar'; $('#a-anim').textContent = 'Animasi 24 jam'; }

map.on('click', (e) => {
  if (ui && ui.tool() !== 'identify') return;       // alat ukur aktif: jangan buka popup nilai
  const [E, N] = toEN(mode === 'air' ? SU.pusat : ST.pusat, e.latlng); let html = '';
  if (mode === 'air' && airRes) { const v = sampleGrid(airRes, E, N); if (!isNaN(v)) html = `<b>${BMU[A.pol].label}</b>: ${fmt(v)} µg/m³<br>Baku mutu ${BMU[A.pol].bm} → <b class="${v > BMU[A.pol].bm ? 'bad' : 'ok'}">${v > BMU[A.pol].bm ? 'Melebihi' : 'Memenuhi'}</b>`; }
  if (mode === 'gw' && gwRes) { const h = ST.luasM / 2, i = Math.floor((E + h) / gwRes.dx), j = Math.floor((h - N) / gwRes.dx);
    if (i >= 0 && j >= 0 && i < gwRes.n && j < gwRes.n) { const v = gwRes.snaps[GP.idx].grid[j * gwRes.n + i], c = BMG[GP.pol]; html = `<b>${c.label}</b>: ${fmt(v)} ${c.unit}<br>Baku mutu ${c.bm} → <b class="${v > c.bm ? 'bad' : 'ok'}">${v > c.bm ? 'Melebihi' : 'Memenuhi'}</b>`; } }
  if (html) L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
});
addEventListener('resize', () => { gwRes && drawChart(); refreshView(); });

// =====================================================================
// 3D, profil vertikal, penampang
// =====================================================================
const scene = new Scene3D($('#c3d'));
let view = 'map';
const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const nearest = (snaps, t) => snaps.reduce((b, s, k) => Math.abs(s.t - t) < Math.abs(snaps[b].t - t) ? k : b, 0);
document.querySelectorAll('.viewbar button').forEach((b) => { b.onclick = () => setView(b.dataset.v); });
function setView(v) {
  view = v; document.querySelector('.mapwrap').dataset.view = v;
  document.querySelectorAll('.viewbar button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('#v3d').hidden = v !== '3d'; $('#sec').hidden = v !== 'sec'; $('#hud').style.display = v === 'map' ? '' : 'none';
  if (v === 'map') map.invalidateSize(); refreshView();
}
function refreshView() {
  if (view === '3d') mode === 'air' ? air3D() : gw3D();
  else if (view === 'sec') mode === 'air' ? airSections() : gwSections();
}
$('#v-ex').addEventListener('input', (e) => { scene.ex = +e.target.value; $('#o-ex').textContent = `×${scene.ex}`; scene.draw(); });

function air3D() {
  if (!airRes) return;
  const res = airRes, n = res.n, m = 64, st = n / m, h = res.luasM / 2, d = res.luasM / m, bg = SU.background[A.pol], items = [];
  const hz = (i, j) => res.dem[Math.min(n - 1, Math.round(j * st)) * n + Math.min(n - 1, Math.round(i * st))];
  for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
    const X0 = -h + a * d, Y0 = h - b * d, z00 = hz(a, b), z10 = hz(a + 1, b), z11 = hz(a + 1, b + 1), z01 = hz(a, b + 1);
    const gx = 3 * (z10 + z11 - z00 - z01) / (2 * d), gy = 3 * (z00 + z10 - z01 - z11) / (2 * d);
    const sh = clamp(.62 + .55 * ((gx * .5 - gy * .5 + .7) / (Math.hypot(gx, gy, 1) * 1.02) - .6), .35, 1.05);
    let col = mix([112, 160, 104], [176, 146, 100], clamp((z00 + z11) / 2 / 250, 0, 1)).map((v) => v * sh);
    const c = res.grid[Math.min(n - 1, Math.floor((b + .5) * st)) * n + Math.min(n - 1, Math.floor((a + .5) * st))];
    const f = clamp((c - bg) / (.06 * airVmax), 0, 1) * .92;
    if (f > 0) col = mix(col, vramp(Math.sqrt(c / airVmax)), f);
    items.push({ t: 'q', p: [[X0, Y0, z00], [X0 + d, Y0, z10], [X0 + d, Y0 - d, z11], [X0, Y0 - d, z01]], c: css(col) });
  }
  SU.sumber.forEach((s) => { const z = elevUdara(s.e, s.n); items.push({ t: 'l', p: [[s.e, s.n, z], [s.e, s.n, z + s.H]], c: '#14223b', w: 3 }); });
  const s0 = SU.sumber[0], z0 = elevUdara(s0.e, s0.n), f = res.field, Hc = f.eff[0].H;
  items.push({ t: 'x', p: [s0.e, s0.n, z0 + s0.H], c: '#14223b', s: 'Cerobong' }, { t: 'x', p: [0, h, 0], c: '#14223b', s: 'U ↑' });
  for (let k = 0; k < 34; k++) {
    const xd = 120 * Math.pow(1.14, k), [sy, sz] = sigma(A.cls, xd, !!A.urban);
    for (let a = -4; a <= 4; a++) {
      const y = a * sy * .55;
      for (let q = 0; q <= 10; q++) {
        const z = q / 10 * (Hc + 2.5 * sz), E = s0.e + xd * f.sx + y * f.cy, N = s0.n + xd * f.cy - y * f.sx;
        if (Math.abs(E) > h || Math.abs(N) > h) continue;
        const zt = elevUdara(E, N), cc = f.c(E, N, z, zt);
        if (cc < .04 * airVmax) continue;
        const t = Math.sqrt(cc / airVmax); items.push({ t: 'p', p: [E, N, zt + z], c: css(vramp(t)), r: 1.4 + 3 * t, a: .15 + .5 * t });
      }
    }
  }
  scene.set(items, h, 60);
}

function gw3D() {
  if (!gwRes || !secRes) return;
  const c = BMG[GP.pol], snap = gwRes.snaps[GP.idx], sg = secRes.snaps[nearest(secRes.snaps, snap.t)].grid;
  const vmin = c.bm / 100, vmax = c.c0, lg = Math.log10, n = gwRes.n, h = ST.luasM / 2, m = 50, st = n / m, d = ST.luasM / m, items = [];
  const col = (v, base) => v < vmin ? base : mix(base, vramp((lg(v) - lg(vmin)) / (lg(vmax) - lg(vmin))), .9);
  const ground = [160, 140, 102], soil = [122, 94, 68], depth = secRes.ny * secRes.dy;
  for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
    const X0 = -h + a * d, Y0 = h - b * d, v = snap.grid[Math.floor((b + .5) * st) * n + Math.floor((a + .5) * st)];
    items.push({ t: 'q', p: [[X0, Y0, 0], [X0 + d, Y0, 0], [X0 + d, Y0 - d, 0], [X0, Y0 - d, 0]], c: css(col(v, ground)) });
  }
  const rows = 20, dz = depth / rows, mx = secRes.nx / m;
  for (let r = 0; r < rows; r++) for (let a = 0; a < m; a++) {
    const X0 = -h + a * d, v = sg[Math.floor((r + .5) * secRes.ny / rows) * secRes.nx + Math.floor((a + .5) * mx)];
    items.push({ t: 'q', p: [[X0, 0, -r * dz], [X0 + d, 0, -r * dz], [X0 + d, 0, -(r + 1) * dz], [X0, 0, -(r + 1) * dz]], c: css(col(v, [226, 214, 188])) });
  }
  const fr = 8, fz = depth / fr, fa = 25, fd = ST.luasM / fa;
  for (let r = 0; r < fr; r++) for (let a = 0; a < fa; a++) {
    const t0 = -h + a * fd, cs = css(soil.map((q) => q * (1 - r * .03)));
    items.push({ t: 'q', p: [[t0, -h, -r * fz], [t0 + fd, -h, -r * fz], [t0 + fd, -h, -(r + 1) * fz], [t0, -h, -(r + 1) * fz]], c: cs },
      { t: 'q', p: [[t0, h, -r * fz], [t0 + fd, h, -r * fz], [t0 + fd, h, -(r + 1) * fz], [t0, h, -(r + 1) * fz]], c: cs },
      { t: 'q', p: [[-h, t0, -r * fz], [-h, t0 + fd, -r * fz], [-h, t0 + fd, -(r + 1) * fz], [-h, t0, -(r + 1) * fz]], c: cs },
      { t: 'q', p: [[h, t0, -r * fz], [h, t0 + fd, -r * fz], [h, t0 + fd, -(r + 1) * fz], [h, t0, -(r + 1) * fz]], c: cs });
  }
  const S = ST.sumber;
  items.push({ t: 'q', p: [[S.e - S.lebar / 2, S.n + S.panjang / 2, 3], [S.e + S.lebar / 2, S.n + S.panjang / 2, 3], [S.e + S.lebar / 2, S.n - S.panjang / 2, 3], [S.e - S.lebar / 2, S.n - S.panjang / 2, 3]], c: '#6b3b1e' });
  ST.sumur.forEach((w) => items.push({ t: 'l', p: [[w.e, w.n, 4], [w.e, w.n, -depth]], c: '#14223b', w: 2.5 }, { t: 'x', p: [w.e, w.n, 4], c: '#14223b', s: w.nama.split(' ')[0] }));
  items.push({ t: 'x', p: [0, h, 0], c: '#14223b', s: 'U ↑' });
  scene.set(items, h, -depth / 2);
}

function airSections() {
  if (!airRes) return;
  const f = airRes.field, s0 = SU.sumber[0], X = A.x, bm = BMU[A.pol].bm, bg = SU.background[A.pol], L0 = 10000, zTop = 700;
  const E0 = s0.e + X * f.sx, N0 = s0.n + X * f.cy, zt0 = elevUdara(E0, N0), pts = []; let cm = bm;
  for (let z = 0; z <= 800; z += 10) { const v = f.c(E0, N0, z, zt0) + bg; pts.push([v, z]); cm = Math.max(cm, v); }
  xyChart($('#s-prof'), [{ color: '#1f6feb', pts }], { xmax: cm * 1.1, ymax: 800, xlab: `${BMU[A.pol].label} (µg/m³)`, ylab: 'Tinggi di atas tanah (m)', refX: bm });
  $('#cap-prof').textContent = `Profil vertikal ${BMU[A.pol].label} di sumbu plume, ${X} m dari sumber`;
  const fn = (v) => v < 0 ? [0, 1, [128, 108, 84]] : [Math.sqrt(v / airVmax), clamp((v - bg) / (.06 * airVmax), 0, 1)];
  const nx = 200, ny = 60, g1 = new Float32Array(nx * ny);
  for (let i = 0; i < nx; i++) {
    const xd = (i + .5) / nx * L0, E = s0.e + xd * f.sx, N = s0.n + xd * f.cy, zg = elevUdara(E, N);
    for (let j = 0; j < ny; j++) { const zz = zTop * (1 - (j + .5) / ny); g1[j * nx + i] = zz < zg ? -1 : f.c(E, N, zz - zg, zg) + bg; }
  }
  const px = (box) => box.l + box.w * X / L0;
  const r1 = heat($('#s-long'), g1, nx, ny, fn, (x, box) => { x.strokeStyle = '#14223b'; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(px(box), box.t); x.lineTo(px(box), box.t + box.h); x.stroke(); x.setLineDash([]);
    const zs = elevUdara(s0.e, s0.n); x.lineWidth = 3; x.beginPath(); x.moveTo(box.l + 1, box.t + box.h * (1 - zs / zTop)); x.lineTo(box.l + 1, box.t + box.h * (1 - (zs + s0.H) / zTop)); x.stroke(); x.lineWidth = 1; });
  r1 && ticks(r1.x, r1.box, 0, L0 / 1000, 0, zTop, 'Jarak hilir dari sumber (km)', 'Elevasi (m MSL)', (v) => v.toFixed(0), (v) => v.toFixed(1));
  $('#cap-long').textContent = `Penampang memanjang sepanjang sumbu plume · garis putus-putus = jarak ${X} m · coklat = tanah (DEM demo)`;
  const cx = 120, g2 = new Float32Array(cx * ny), W = 3000;
  for (let i = 0; i < cx; i++) {
    const y = -W + (i + .5) / cx * 2 * W, E = s0.e + X * f.sx + y * f.cy, N = s0.n + X * f.cy - y * f.sx, zg = elevUdara(E, N);
    for (let j = 0; j < ny; j++) { const zz = zTop * (1 - (j + .5) / ny); g2[j * cx + i] = zz < zg ? -1 : f.c(E, N, zz - zg, zg) + bg; }
  }
  const r2 = heat($('#s-cross'), g2, cx, ny, fn);
  r2 && ticks(r2.x, r2.box, -W / 1000, W / 1000, 0, zTop, 'Jarak lateral dari sumbu (km)', 'Elevasi (m MSL)', (v) => v.toFixed(0), (v) => v.toFixed(1));
  $('#cap-cross').textContent = `Penampang melintang tegak lurus arah angin pada ${X} m dari sumber`;
}

function gwSections() {
  if (!gwRes || !secRes) return;
  const c = BMG[GP.pol], snap = gwRes.snaps[GP.idx], sg = secRes.snaps[nearest(secRes.snaps, snap.t)].grid, nx = secRes.nx, ny = secRes.ny, h = ST.luasM / 2;
  const vmin = c.bm / 100, vmax = c.c0, lg = Math.log10, depth = ny * secRes.dy, S = ST.sumber, X = (e, box) => box.l + (e + h) / ST.luasM * box.w;
  const r = heat($('#s-long'), sg, nx, ny, (v) => v < vmin ? [0, 0] : [(lg(v) - lg(vmin)) / (lg(vmax) - lg(vmin)), .95], (x, box) => {
    x.fillStyle = '#6b3b1e'; x.fillRect(X(S.e - S.lebar / 2, box), box.t - 2, S.lebar / ST.luasM * box.w, 6);
    ST.sumur.forEach((w) => { x.fillStyle = '#14223b'; x.beginPath(); x.moveTo(X(w.e, box), box.t + 2); x.lineTo(X(w.e, box) - 5, box.t - 6); x.lineTo(X(w.e, box) + 5, box.t - 6); x.fill(); });
    x.strokeStyle = '#14223b'; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(X(GP.x, box), box.t); x.lineTo(X(GP.x, box), box.t + box.h); x.stroke(); x.setLineDash([]);
  }, '#e8dcc6');
  r && ticks(r.x, r.box, -h, h, depth, 0, 'Jarak sepanjang arah aliran (m)', 'Kedalaman dari muka air tanah (m)');
  $('#cap-long').textContent = `Penampang vertikal akuifer 2D (x–z) pada t = ${(snap.t / 365).toFixed(1)} tahun · segitiga = sumur · garis putus-putus = posisi profil`;
  const i = clamp(Math.floor((GP.x + h) / secRes.dx), 0, nx - 1), pts = [];
  for (let j = 0; j < ny; j++) pts.push([sg[j * nx + i], (j + .5) * secRes.dy]);
  xyChart($('#s-prof'), [{ color: '#1f6feb', pts }], { xmax: c.c0 * 1.05, ymax: depth, down: true, xlab: `${c.label} (${c.unit})`, ylab: 'Kedalaman (m)', refX: c.bm });
  $('#cap-prof').textContent = `Profil vertikal di x = ${GP.x} m`;
}

// =====================================================================
// Hubungan ke antarmuka WebGIS (menu, toolbar, panel)
// =====================================================================
const zoomDomain = () => map.fitBounds(mode === 'air' ? boundsOf(SU.pusat, half) : boundsOf(ST.pusat, ST.luasM / 2));
const zoomSource = () => (mode === 'air' ? map.setView(toLL(SU.pusat, SU.sumber[0].e, SU.sumber[0].n), 14) : map.setView(toLL(ST.pusat, ST.sumber.e, ST.sumber.n), 15));
const DEF = [...document.querySelectorAll('#panel-air [id], #panel-gw [id]')].filter((e) => /^(INPUT|SELECT)$/.test(e.tagName) && e.id !== 'g-t').map((e) => [e, e.type === 'checkbox' ? e.checked : e.value]);
function resetParams() {
  stopAll(); const root = $(mode === 'air' ? '#panel-air' : '#panel-gw');
  for (const [e, v] of DEF) {
    if (!root.contains(e)) continue;
    const cur = e.type === 'checkbox' ? e.checked : e.value; if (cur === v) continue;
    e.type === 'checkbox' ? (e.checked = v) : (e.value = v);
    e.dispatchEvent(new Event(e.type === 'range' ? 'input' : 'change'));
  }
  mode === 'gw' ? runGW() : runAir(); ui.toast('Parameter dikembalikan ke nilai awal');
}
function geojson() {
  const F = [], pt = (c, e, n, props) => { const [la, lo] = toLL(c, e, n); F.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lo, la] } }); };
  const rect = (c, e0, n0, w, h, props) => { const a = toLL(c, e0 - w / 2, n0 - h / 2), b = toLL(c, e0 + w / 2, n0 + h / 2); F.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [[[a[1], a[0]], [b[1], a[0]], [b[1], b[0]], [a[1], b[0]], [a[1], a[0]]]] } }); };
  if (mode === 'air') {
    SU.sumber.forEach((s) => pt(SU.pusat, s.e, s.n, { jenis: 'sumber emisi', nama: s.nama, tinggi_m: s.H }));
    SU.sampling.forEach((s) => pt(SU.pusat, s.e, s.n, { jenis: 'titik sampling', nama: s.nama }));
    SU.permukiman.forEach((p) => pt(SU.pusat, p.e, p.n, { jenis: 'permukiman (sintetis)', nama: p.nama, populasi: p.pop, sigma_m: p.s }));
    rect(SU.pusat, 0, 0, half * 2, half * 2, { jenis: 'batas domain' });
  } else {
    rect(ST.pusat, ST.sumber.e, ST.sumber.n, ST.sumber.lebar, ST.sumber.panjang, { jenis: 'sumber kontaminan' });
    ST.sumur.forEach((s) => pt(ST.pusat, s.e, s.n, { jenis: 'sumur pantau', nama: s.nama }));
    rect(ST.pusat, 0, 0, ST.luasM, ST.luasM, { jenis: 'batas domain' });
  }
  return { type: 'FeatureCollection', features: F };
}
ui = initUI({
  map, bases, getBase: () => curBase, setBase, overlays, getMode: () => mode, setMode, getView: () => view, setView,
  run: () => (mode === 'air' ? runAir() : runGW()),
  toggleAnim: () => (mode === 'air' ? $('#a-anim').click() : gwRes && $('#g-play').click()),
  zoomDomain, zoomSource, resetParams, geojson,
  toEN: (ll) => toEN(mode === 'air' ? SU.pusat : ST.pusat, ll),
  gwSeriesNames: () => ST.sumur.map((s) => s.nama),
  gwSeries: () => (gwRes ? gwRes.snaps.map((s, k) => [s.t.toFixed(1), ...gwRes.series.map((sr) => sr[k])]) : []),
  onTab: (t) => { if (t === 'hasil' && mode === 'gw') drawChart(); },
  onResize: () => { gwRes && drawChart(); refreshView(); },
});
setMode('air');
