// Antarmuka ala WebGIS: menu bar + sub menu, toolbar, alat ukur, pencarian koordinat, ekspor, dialog bantuan.
// Modul ini hanya mengurus UI; logika model tetap di app.js (dihubungkan lewat objek `ctx`).

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (html) e.innerHTML = html; return e; };
const ICON = (p) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const IC = {
  extent: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  pointer: '<path d="M5 3l14 7-6 2-2 6z"/>',
  ruler: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  area: '<path d="M5 6l10-2 5 8-4 8-11-3z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  full: '<path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><path d="M7 14h10v7H7z"/>',
  dl: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
};

export function initUI(ctx) {
  const { map } = ctx;
  const SW = { 'Sebaran polutan udara': '#f28a1f', 'Relief DEM (demo)': '#8a8a8a', 'Sumber emisi': '#d7261e', 'Titik sampling': '#ffffff', 'Permukiman (sintetis)': '#6b4fbb', 'Arah angin': '#16346b', 'Batas domain': '#16346b',
    'Sebaran kontaminan air tanah': '#2fbf71', 'Sumber kontaminan': '#6b3b1e', 'Sumur pantau': '#ffffff' };

  // ---------- util ----------
  let toastT;
  function toast(msg, ms = 3500) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }
  function download(name, text, type) { const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  const csv = (rows) => rows.map((r) => r.map((c) => { const s = String(c ?? '').replace(/\s+/g, ' ').trim(); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
  function dialog(html) { $('#dlg-body').innerHTML = html; const d = $('#dlg'); d.showModal ? d.showModal() : d.setAttribute('open', ''); }
  const fmtLen = (m) => (m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(2)} km`);
  const fmtArea = (m2) => (m2 < 1e4 ? `${m2.toFixed(0)} m²` : m2 < 1e6 ? `${(m2 / 1e4).toFixed(2)} ha` : `${(m2 / 1e6).toFixed(2)} km²`);

  // ---------- pengaturan peta dasar ----------
  const baseNames = () => Object.keys(ctx.bases);
  function refreshBaseUI() { const n = ctx.getBase(); const s = $('#tb-base'); if (s) s.value = n; $('#st-base').textContent = `Peta dasar: ${n}`; renderGallery(); }

  // ---------- sidebar ----------
  function sideTab(t) {
    $('#side').dataset.tab = t;
    document.querySelectorAll('.stabs button').forEach((b) => b.classList.toggle('on', b.dataset.st === t));
    if (t === 'layer') renderLayers();
    ctx.onTab?.(t);
  }
  document.querySelectorAll('.stabs button').forEach((b) => { b.onclick = () => sideTab(b.dataset.st); });
  function toggleSide(force) {
    const m = $('#main'); const hide = force ?? !m.classList.contains('noside'); m.classList.toggle('noside', hide);
    setTimeout(() => map.invalidateSize(), 50);
  }

  // ---------- layer (TOC) ----------
  function renderLayers() {
    const ov = ctx.overlays(), ul = $('#toc'); ul.innerHTML = '';
    for (const [name, lyr] of Object.entries(ov)) {
      const li = el('li'), lb = el('label'), cb = el('input', { type: 'checkbox' });
      cb.checked = map.hasLayer(lyr);
      cb.onchange = () => { cb.checked ? lyr.addTo(map) : map.removeLayer(lyr); };
      lb.append(cb, el('span', { class: 'sw', style: `background:${SW[name] || '#999'}` }), document.createTextNode(name));
      li.append(lb); ul.append(li);
    }
    renderGallery();
  }
  function renderGallery() {
    const ul = $('#basegal'); if (!ul) return; ul.innerHTML = '';
    for (const n of baseNames()) {
      const li = el('li'), lb = el('label'), r = el('input', { type: 'radio', name: 'base' });
      r.checked = n === ctx.getBase(); r.onchange = () => ctx.setBase(n);
      lb.append(r, document.createTextNode(n)); li.append(lb); ul.append(li);
    }
  }

  // ---------- alat ukur / identifikasi ----------
  let tool = 'identify', pts = [], mLayer = L.featureGroup().addTo(map), live = null, tip = null, pin = null;
  const hints = { identify: 'Identifikasi: klik peta untuk membaca nilai polutan di titik tersebut', dist: 'Ukur jarak: klik untuk menambah titik · klik dua kali atau Enter untuk selesai · Esc batal', area: 'Ukur luas: klik untuk menambah titik poligon · klik dua kali atau Enter untuk selesai · Esc batal' };
  const lenOf = (a) => a.reduce((s, p, i) => (i ? s + map.distance(a[i - 1], p) : 0), 0);
  function areaOf(a) {   // luas poligon (proyeksi ekuirektangular lokal, memadai untuk skala domain model)
    if (a.length < 3) return 0; const lat0 = a.reduce((s, p) => s + p.lat, 0) / a.length, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
    const q = a.map((p) => [p.lng * kx, p.lat * ky]); let s = 0; q.forEach((p, i) => { const r = q[(i + 1) % q.length]; s += p[0] * r[1] - r[0] * p[1]; }); return Math.abs(s) / 2;
  }
  const textOf = (a) => (tool === 'dist' ? `Jarak: ${fmtLen(lenOf(a))}` : `Luas: ${fmtArea(areaOf(a))} · keliling ${fmtLen(lenOf([...a, a[0]]))}`);
  function drawLive(extra) {
    const a = extra ? [...pts, extra] : pts; if (!a.length) return;
    if (live) mLayer.removeLayer(live); if (tip) mLayer.removeLayer(tip);
    live = tool === 'area' && a.length > 2 ? L.polygon(a, { color: '#d7261e', weight: 2, fillOpacity: .12 }) : L.polyline(a, { color: '#d7261e', weight: 2.5, dashArray: extra ? '6 4' : null });
    mLayer.addLayer(live);
    tip = L.tooltip({ permanent: true, direction: 'top', className: 'meas', offset: [0, -6] }).setLatLng(a[a.length - 1]).setContent(textOf(a)); mLayer.addLayer(tip);
  }
  function finishMeasure(keep = true) {
    if (live && (!keep || pts.length < (tool === 'area' ? 3 : 2))) { mLayer.removeLayer(live); if (tip) mLayer.removeLayer(tip); }
    else if (live) drawLive();          // gambar ulang tanpa titik karet (rubber-band)
    live = tip = null; pts = [];
  }
  function setTool(t) {
    finishMeasure(true); tool = t;
    map.getContainer().style.cursor = t === 'identify' ? '' : 'crosshair';
    t === 'identify' ? map.doubleClickZoom.enable() : map.doubleClickZoom.disable();
    document.querySelectorAll('.tb[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    $('#st-tool').textContent = hints[t];
  }
  map.on('click', (e) => {
    if (tool === 'identify') return;
    pts.push(e.latlng); L.circleMarker(e.latlng, { radius: 4, color: '#d7261e', fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(mLayer); drawLive();
  });
  map.on('dblclick', () => { if (tool === 'identify') return; pts.pop(); drawLive(); finishMeasure(true); });
  map.on('mousemove', (e) => {
    const { lat, lng } = e.latlng; $('#st-coord').textContent = `Lat ${lat.toFixed(5)}°  Lon ${lng.toFixed(5)}°`;
    const [E, N] = ctx.toEN(e.latlng); $('#st-en').textContent = `E ${E.toFixed(0)} m · N ${N.toFixed(0)} m (lokal)`;
    if (tool !== 'identify' && pts.length) drawLive(e.latlng);
  });
  map.on('zoomend', () => { $('#st-zoom').textContent = `Zoom ${map.getZoom()}`; });
  $('#st-zoom').textContent = `Zoom ${map.getZoom()}`;
  function clearMeasure() { finishMeasure(false); mLayer.clearLayers(); if (pin) { map.removeLayer(pin); pin = null; } toast('Hasil ukur dihapus'); }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (pts.length) { finishMeasure(false); mLayer.clearLayers(); } closeMenus(); }
    if (e.key === 'Enter' && tool !== 'identify' && pts.length) finishMeasure(true);
  });

  // ---------- pencarian koordinat ----------
  function goCoord(txt) {
    const n = (txt.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (n.length < 2 || Math.abs(n[0]) > 90 || Math.abs(n[1]) > 180) return toast('Format: lintang, bujur — mis. -6.749, 108.588');
    if (pin) map.removeLayer(pin);
    pin = L.marker([n[0], n[1]]).addTo(map).bindPopup(`Lat ${n[0]}, Lon ${n[1]}`).openPopup();
    map.flyTo([n[0], n[1]], Math.max(map.getZoom(), 13));
  }

  // ---------- ekspor ----------
  const ex = {
    tabel() {
      const rows = ctx.getMode() === 'air'
        ? [...document.querySelectorAll('#a-tbl tr')].map((tr) => [...tr.children].map((c) => c.textContent))
        : [['Hari', ...ctx.gwSeriesNames()], ...ctx.gwSeries()];
      if (rows.length < 2) return toast('Belum ada hasil simulasi untuk diekspor');
      const kp = [...document.querySelectorAll(ctx.getMode() === 'air' ? '#a-kpi .kpi' : '#g-kpi .kpi')].map((k) => [k.querySelector('span').textContent, k.querySelector('b').textContent]);
      download(`iepmp_${ctx.getMode()}_hasil.csv`, csv([['Ringkasan'], ...kp, [], ...rows]), 'text/csv'); toast('CSV diunduh');
    },
    geojson() { download(`iepmp_${ctx.getMode()}_fitur.geojson`, JSON.stringify(ctx.geojson(), null, 1), 'application/geo+json'); toast('GeoJSON diunduh'); },
  };

  // ---------- definisi menu ----------
  const mode = () => ctx.getMode(), isAir = () => mode() === 'air';
  const clickEl = (sel) => { const e = $(sel); if (e) e.click(); };
  const setSel = (sel, v) => { const e = $(sel); if (!e) return; e.value = v; e.dispatchEvent(new Event('change')); };
  const flip = (sel) => { const e = $(sel); if (!e) return; e.checked = !e.checked; e.dispatchEvent(new Event('change')); };
  const polItems = () => (isAir() ? [['PM25', 'PM2.5'], ['PM10', 'PM10'], ['SO2', 'SO₂'], ['NO2', 'NO₂']] : [['TDS', 'TDS'], ['Pb', 'Pb']])
    .map(([v, t]) => ({ t, radio: $(isAir() ? '#a-pol' : '#g-pol').value === v, fn: () => setSel(isAir() ? '#a-pol' : '#g-pol', v) }));
  const menus = [
    ['Berkas', () => [
      { t: 'Ekspor hasil (CSV)', fn: ex.tabel },
      { t: 'Ekspor fitur peta (GeoJSON)', fn: ex.geojson },
      '-',
      { t: 'Cetak peta…', kb: 'Ctrl+P', fn: () => { ctx.setView('map'); setTimeout(() => print(), 100); } },
      '-',
      { t: 'Atur ulang parameter', fn: ctx.resetParams },
    ]],
    ['Tampilan', () => [
      { t: 'Peta 2D', radio: ctx.getView() === 'map', fn: () => ctx.setView('map') },
      { t: 'Tampilan 3D', radio: ctx.getView() === '3d', fn: () => ctx.setView('3d') },
      { t: 'Profil & penampang', radio: ctx.getView() === 'sec', fn: () => ctx.setView('sec') },
      '-',
      { t: 'Panel samping', ck: !$('#main').classList.contains('noside'), fn: () => toggleSide() },
      { t: 'Buka panel', sub: [
        { t: 'Parameter', fn: () => { toggleSide(false); sideTab('param'); } },
        { t: 'Hasil & evaluasi', fn: () => { toggleSide(false); sideTab('hasil'); } },
        { t: 'Layer & peta dasar', fn: () => { toggleSide(false); sideTab('layer'); } }] },
      { t: 'Layar penuh', kb: 'F11', fn: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()) },
      '-',
      { t: 'Zoom ke domain model', fn: ctx.zoomDomain },
      { t: 'Zoom ke sumber', fn: ctx.zoomSource },
    ]],
    ['Peta Dasar', () => baseNames().map((n) => ({ t: n, radio: n === ctx.getBase(), fn: () => ctx.setBase(n) }))],
    ['Layer', () => {
      const ov = Object.entries(ctx.overlays());
      return [...ov.map(([n, l]) => ({ t: n, ck: map.hasLayer(l), fn: () => { map.hasLayer(l) ? map.removeLayer(l) : l.addTo(map); renderLayers(); } })),
        '-', { t: 'Tampilkan semua', fn: () => { ov.forEach(([, l]) => l.addTo(map)); renderLayers(); } },
        { t: 'Sembunyikan semua', fn: () => { ov.forEach(([, l]) => map.removeLayer(l)); renderLayers(); } },
        { t: 'Kelola layer…', fn: () => { toggleSide(false); sideTab('layer'); } }];
    }],
    ['Analisis', () => [
      { t: 'Pencemaran udara', radio: isAir(), fn: () => ctx.setMode('air') },
      { t: 'Tanah & air tanah', radio: !isAir(), fn: () => ctx.setMode('gw') },
      '-',
      { t: 'Jalankan simulasi', kb: 'Ctrl+Enter', fn: ctx.run },
      { t: isAir() ? 'Animasi 24 jam' : 'Putar waktu', fn: ctx.toggleAnim },
      '-',
      { t: isAir() ? 'Polutan' : 'Kontaminan', sub: polItems() },
      ...(isAir() ? [
        { t: 'Kelas stabilitas', sub: ['A', 'B', 'C', 'D', 'E', 'F'].map((c) => ({ t: `Kelas ${c}`, radio: $('#a-cls').value === c, fn: () => setSel('#a-cls', c) })) },
        { t: 'Topografi (DEM demo)', ck: $('#a-topo').checked, fn: () => flip('#a-topo') },
        { t: 'Hanya area di atas baku mutu', ck: $('#a-only').checked, fn: () => flip('#a-only') },
      ] : [
        { t: 'Horizon simulasi', sub: [['365', '1 tahun'], ['1825', '5 tahun'], ['3650', '10 tahun'], ['7300', '20 tahun']].map(([v, t]) => ({ t, radio: $('#g-days').value === v, fn: () => { setSel('#g-days', v); ctx.run(); } })) },
      ]),
      '-',
      { t: 'Lihat hasil & evaluasi baku mutu', fn: () => { toggleSide(false); sideTab('hasil'); } },
    ]],
    ['Alat', () => [
      { t: 'Identifikasi nilai', radio: tool === 'identify', fn: () => setTool('identify') },
      { t: 'Ukur jarak', radio: tool === 'dist', fn: () => setTool('dist') },
      { t: 'Ukur luas', radio: tool === 'area', fn: () => setTool('area') },
      { t: 'Hapus hasil ukur', fn: clearMeasure },
      '-',
      { t: 'Cari koordinat…', kb: 'Ctrl+K', fn: () => $('#tb-q').focus() },
    ]],
    ['Bantuan', () => [
      { t: 'Panduan singkat', fn: () => dialog(HELP.guide) },
      { t: 'Metodologi model', fn: () => dialog(HELP.method) },
      { t: 'Catatan peta dasar & lisensi', fn: () => dialog(HELP.base) },
      '-',
      { t: 'Tentang IEPMP', fn: () => dialog(HELP.about) },
    ]],
  ];
  const HELP = {
    guide: `<h2>Panduan singkat</h2><ol><li>Pilih mode <b>Udara</b> atau <b>Tanah &amp; air tanah</b> di panel kiri.</li><li>Atur parameter pada tab <b>Parameter</b>; hasil dihitung ulang otomatis (air tanah: tekan <i>Jalankan simulasi</i>).</li><li>Lihat ringkasan dan evaluasi baku mutu di tab <b>Hasil</b>; atur layer di tab <b>Layer</b> atau menu <b>Layer</b>.</li><li>Gunakan menu <b>Alat</b> untuk identifikasi nilai, ukur jarak/luas, dan cari koordinat.</li><li>Ganti tampilan <b>Peta / 3D / Profil &amp; penampang</b> di atas peta atau menu <b>Tampilan</b>.</li><li>Unduh hasil lewat menu <b>Berkas</b> (CSV, GeoJSON) atau cetak peta.</li></ol>`,
    method: `<h2>Metodologi model</h2><ul><li><b>Udara:</b> Gaussian plume (sigma Briggs/McElroy–Pooler), kenaikan plume Briggs, deposisi kering + basah, koreksi terrain bergaya ISC.</li><li><b>Tanah &amp; air tanah:</b> Darcy + adveksi–dispersi–reaksi 2D (beda hingga upwind), retardasi sorpsi, peluruhan orde-1.</li><li><b>Evaluasi:</b> konsentrasi dibandingkan baku mutu PP No. 22/2021; indeks bahaya relatif C/BM; populasi terpapar (sintetis).</li><li><b>Verifikasi:</b> <code>tests/verify.mjs</code> (Ogata–Banks, retardasi, kekekalan massa plume).</li></ul>`,
    base: `<h2>Peta dasar &amp; lisensi</h2><p>Tile Google diakses langsung tanpa API key sehingga <b>tidak sesuai ketentuan layanan Google</b> untuk publikasi. Untuk publikasi gunakan Google Maps JavaScript API (berkunci) atau pilih <b>OpenStreetMap</b> / <b>Esri Satelit</b>.</p><p>Bila tile Google gagal dimuat, aplikasi otomatis beralih ke OpenStreetMap.</p>`,
    about: `<h2>IEPMP</h2><p>Integrated Environmental Pollution Modeling Platform — digital twin simulasi sebaran polutan udara, tanah, dan air tanah. Seluruh data bersifat <b>sintetis</b> dan hanya untuk simulasi/penelitian.</p>`,
  };

  // ---------- render menu bar ----------
  const bar = $('#menubar');
  function closeMenus() { bar.querySelectorAll('.m.open').forEach((m) => m.classList.remove('open')); bar.querySelectorAll('.it.open').forEach((i) => i.classList.remove('open')); }
  function renderItems(items, parent) {
    items.forEach((it) => {
      if (it === '-') return parent.append(el('div', { class: 'sep', role: 'separator' }));
      const kind = it.radio !== undefined ? 'menuitemradio' : it.ck !== undefined ? 'menuitemcheckbox' : 'menuitem';
      const d = el('div', { class: `it${it.sub ? ' sub' : ''}${it.dis ? ' dis' : ''}`, role: kind, tabindex: '-1' });
      if (kind !== 'menuitem') d.setAttribute('aria-checked', String(!!(it.radio ?? it.ck)));
      d.innerHTML = `<span class="ck">${it.radio ? '●' : it.ck ? '✓' : ''}</span><span class="lb">${it.t}</span>${it.kb ? `<span class="kb">${it.kb}</span>` : ''}${it.sub ? '<span class="ar">▸</span>' : ''}`;
      if (it.sub) { const dd = el('div', { class: 'dd', role: 'menu' }); renderItems(it.sub, dd); d.append(dd); d.addEventListener('click', (e) => { e.stopPropagation(); d.classList.toggle('open'); }); }
      else if (!it.dis) d.addEventListener('click', (e) => { e.stopPropagation(); closeMenus(); it.fn?.(); });
      parent.append(d);
    });
  }
  function openMenu(m, build, focusFirst) {
    const wasOpen = m.classList.contains('open'); closeMenus(); if (wasOpen && !focusFirst) return;
    const old = m.querySelector('.dd'); old?.remove();
    const dd = el('div', { class: 'dd', role: 'menu' }); renderItems(build(), dd); m.append(dd); m.classList.add('open');
    if (focusFirst) dd.querySelector('.it:not(.dis)')?.focus();
  }
  menus.forEach(([name, build]) => {
    const m = el('div', { class: 'm' }), b = el('button', { role: 'menuitem', 'aria-haspopup': 'true' }, name);
    b.onclick = (e) => { e.stopPropagation(); openMenu(m, build); };
    b.onkeydown = (e) => { if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu(m, build, true); } };
    m.onmouseenter = () => { if (bar.querySelector('.m.open') && !m.classList.contains('open')) openMenu(m, build); };
    m.onkeydown = (e) => {
      const items = [...(e.target.closest('.dd')?.children || [])].filter((i) => i.classList.contains('it') && !i.classList.contains('dis')), i = items.indexOf(e.target);
      if (e.key === 'ArrowDown' && i >= 0) { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); e.target.click(); if (e.target.classList.contains('sub')) e.target.querySelector('.it')?.focus(); }
      else if (e.key === 'ArrowRight' && e.target.classList.contains('sub')) { e.preventDefault(); e.target.classList.add('open'); e.target.querySelector('.it')?.focus(); }
      else if (e.key === 'ArrowLeft' && e.target.closest('.it.sub') && e.target.closest('.dd')?.parentElement.classList.contains('it')) { const p = e.target.closest('.dd').parentElement; p.classList.remove('open'); p.focus(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const ms = [...bar.querySelectorAll('.m')], k = ms.indexOf(m), n = ms[(k + (e.key === 'ArrowRight' ? 1 : -1) + ms.length) % ms.length]; n.querySelector('button').click(); n.querySelector('.it:not(.dis)')?.focus(); }
      else if (e.key === 'Escape') { closeMenus(); b.focus(); }
    };
    m.append(b); bar.append(m);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#menubar')) closeMenus(); });

  // ---------- toolbar ----------
  const tbEl = $('#toolbar');
  const tb = (id, ic, title, fn, o = {}) => { const b = el('button', { class: `tb${o.primary ? ' primary' : ''}`, type: 'button', title, 'aria-label': title, ...(o.tool ? { 'data-tool': o.tool } : {}), id: `tb-${id}` }, ICON(IC[ic]) + (o.l ? `<span>${o.l}</span>` : '')); b.onclick = fn; tbEl.append(b); return b; };
  const sep = () => tbEl.append(el('span', { class: 'tbsep' }));
  tb('extent', 'extent', 'Zoom ke domain model', () => ctx.zoomDomain());
  sep();
  tb('identify', 'pointer', 'Identifikasi nilai (klik peta)', () => setTool('identify'), { tool: 'identify' });
  tb('dist', 'ruler', 'Ukur jarak', () => setTool('dist'), { tool: 'dist' });
  tb('area', 'area', 'Ukur luas', () => setTool('area'), { tool: 'area' });
  tb('clear', 'trash', 'Hapus hasil ukur', clearMeasure);
  sep();
  tb('run', 'bolt', 'Jalankan simulasi', () => ctx.run(), { primary: true, l: 'Jalankan' });
  tb('anim', 'clock', 'Animasi 24 jam / putar waktu', () => ctx.toggleAnim(), { l: 'Animasi' });
  sep();
  const sel = el('select', { id: 'tb-base', title: 'Peta dasar', 'aria-label': 'Peta dasar' });
  baseNames().forEach((n) => sel.add(new Option(n, n))); sel.onchange = () => ctx.setBase(sel.value); tbEl.append(sel);
  sep();
  const f = el('form', { role: 'search' }); f.innerHTML = '<input id="tb-q" type="search" placeholder="Cari lat, lon  (-6.749, 108.588)" aria-label="Cari koordinat"><button type="submit" title="Cari" aria-label="Cari">' + ICON(IC.search) + '</button>';
  f.onsubmit = (e) => { e.preventDefault(); goCoord($('#tb-q').value); }; tbEl.append(f);
  tbEl.append(el('span', { class: 'tbsp' }));
  tb('csv', 'dl', 'Ekspor hasil (CSV)', ex.tabel);
  tb('print', 'print', 'Cetak peta', () => { ctx.setView('map'); setTimeout(() => print(), 100); });
  tb('full', 'full', 'Layar penuh', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()));
  tb('side', 'panel', 'Tampilkan / sembunyikan panel samping', () => toggleSide());

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); ctx.run(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#tb-q').focus(); }
  });
  new ResizeObserver(() => { map.invalidateSize(); ctx.onResize?.(); }).observe($('.mapwrap'));

  setTool('identify'); sideTab('param'); refreshBaseUI();
  return { tool: () => tool, renderLayers, refreshBaseUI, toast, setTool };
}
