// Visualisasi 3D & penampang berbasis Canvas 2D (tanpa dependensi eksternal).
export const RAMP = [[27, 63, 166], [31, 160, 216], [47, 191, 113], [242, 213, 31], [242, 138, 31], [215, 38, 30]];
export function ramp(t) {
  t = Math.min(1, Math.max(0, t)); const x = t * (RAMP.length - 1), i = Math.min(Math.floor(x), RAMP.length - 2), f = x - i;
  return RAMP[i].map((v, k) => v + (RAMP[i + 1][k] - v) * f);
}
export const mix = (a, b, f) => a.map((v, k) => v + (b[k] - v) * f);
const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

function fit(cv) {
  const r = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  cv.width = w * r; cv.height = h * r;
  const x = cv.getContext('2d'); x.setTransform(r, 0, 0, r, 0, 0); return { x, w, h };
}

// ---------- Renderer 3D (painter's algorithm, proyeksi ortografis, putar dengan drag, zoom dengan roda) ----------
export class Scene3D {
  constructor(cv) {
    Object.assign(this, { cv, yaw: -0.6, pitch: 0.85, zoom: 1, ex: 2, items: [], extent: 1000, cz: 0, raf: 0 });
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; cv.setPointerCapture?.(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw += (e.clientX - drag[0]) * 0.008; this.pitch = Math.min(1.5, Math.max(0.08, this.pitch + (e.clientY - drag[1]) * 0.008));
      drag = [e.clientX, e.clientY]; this.draw();
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = Math.min(4, Math.max(0.4, this.zoom * Math.exp(-e.deltaY * 0.001))); this.draw(); }, { passive: false });
  }
  set(items, extent, cz = 0) { this.items = items; this.extent = extent; this.cz = cz; this.draw(); }
  proj([x, y, z]) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), zz = (z - this.cz) * this.ex;
    const X = x * cy - y * sy, Y = x * sy + y * cy;
    return [X, zz * cp + Y * sp, Y * cp - zz * sp];   // [layar-x, layar-atas, kedalaman (besar = jauh)]
  }
  draw() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const f = fit(this.cv); if (!f) return;
      const { x, w, h } = f, s = Math.min(w, h) / (this.extent * 2.3) * this.zoom, ox = w / 2, oy = h * 0.55;
      const P = (p) => { const q = this.proj(p); return [ox + q[0] * s, oy - q[1] * s, q[2]]; };
      x.clearRect(0, 0, w, h);
      const list = this.items.map((it) => {
        if (it.t === 'q') { const q = it.p.map(P); return { it, q, d: (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4 }; }
        if (it.t === 'l') { const q = it.p.map(P); return { it, q, d: (q[0][2] + q[1][2]) / 2 }; }
        const q = [P(it.p)]; return { it, q, d: q[0][2] };
      }).sort((a, b) => b.d - a.d);
      for (const { it, q } of list) {
        if (it.t === 'q') {
          x.fillStyle = x.strokeStyle = it.c; x.lineWidth = 0.7; x.beginPath(); x.moveTo(q[0][0], q[0][1]);
          for (let k = 1; k < 4; k++) x.lineTo(q[k][0], q[k][1]); x.closePath(); x.fill(); x.stroke();
        } else if (it.t === 'l') {
          x.strokeStyle = it.c; x.lineWidth = it.w || 2; x.beginPath(); x.moveTo(q[0][0], q[0][1]); x.lineTo(q[1][0], q[1][1]); x.stroke();
        } else if (it.t === 'p') {
          x.globalAlpha = it.a; x.fillStyle = it.c; x.beginPath(); x.arc(q[0][0], q[0][1], it.r, 0, 6.2832); x.fill(); x.globalAlpha = 1;
        } else if (it.t === 'x') {
          x.fillStyle = it.c; x.font = '600 12px sans-serif'; x.fillText(it.s, q[0][0] + 4, q[0][1] - 4);
        }
      }
    });
  }
}

// ---------- Peta panas penampang (baris 0 = atas) ----------
// fn(v) -> [t, alpha] atau [t, alpha, [r,g,b]] untuk warna tetap (mis. tanah)
export function heat(cv, grid, nx, ny, fn, annot, bg = '#fff') {
  const f = fit(cv); if (!f) return null;
  const { x, w, h } = f, pad = { l: 46, r: 10, t: 8, b: 26 };
  const tmp = document.createElement('canvas'); tmp.width = nx; tmp.height = ny;
  const tc = tmp.getContext('2d'), img = tc.createImageData(nx, ny);
  for (let k = 0; k < nx * ny; k++) { const [t, a, fix] = fn(grid[k]); const c = fix || ramp(t); img.data.set([c[0], c[1], c[2], a * 255], k * 4); }
  tc.putImageData(img, 0, 0);
  x.clearRect(0, 0, w, h); x.fillStyle = bg; x.fillRect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b);
  x.imageSmoothingEnabled = true; x.drawImage(tmp, pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b);
  const box = { l: pad.l, t: pad.t, w: w - pad.l - pad.r, h: h - pad.t - pad.b };
  x.strokeStyle = '#14223b'; x.lineWidth = 1; x.strokeRect(box.l, box.t, box.w, box.h);
  annot && annot(x, box);
  return { x, box };
}
export function ticks(x, box, x0, x1, y0, y1, xl, yl, fy = (v) => v.toFixed(0), fx = (v) => v.toFixed(0)) {   // y0 = nilai di bawah, y1 = nilai di atas
  x.fillStyle = '#5d6b82'; x.font = '10.5px sans-serif'; x.textAlign = 'center';
  for (let k = 0; k <= 4; k++) {
    const px = box.l + box.w * k / 4; x.fillText(fx(x0 + (x1 - x0) * k / 4), px, box.t + box.h + 12);
  }
  x.fillText(xl, box.l + box.w / 2, box.t + box.h + 23); x.textAlign = 'right';
  for (let k = 0; k <= 4; k++) { const py = box.t + box.h - box.h * k / 4; x.fillText(fy(y0 + (y1 - y0) * k / 4), box.l - 4, py + 3); }
  x.save(); x.translate(10, box.t + box.h / 2); x.rotate(-Math.PI / 2); x.textAlign = 'center'; x.fillText(yl, 0, 0); x.restore(); x.textAlign = 'left';
}

// ---------- Grafik XY (mis. konsentrasi di sumbu-x, tinggi/kedalaman di sumbu-y) ----------
export function xyChart(cv, curves, o) {
  const f = fit(cv); if (!f) return;
  const { x, w, h } = f, pad = { l: 46, r: 10, t: 8, b: 26 }, bw = w - pad.l - pad.r, bh = h - pad.t - pad.b;
  const X = (v) => pad.l + Math.min(v, o.xmax) / o.xmax * bw;
  const Y = (v) => o.down ? pad.t + v / o.ymax * bh : pad.t + bh - v / o.ymax * bh;
  x.clearRect(0, 0, w, h); x.strokeStyle = '#dbe2ec'; x.fillStyle = '#5d6b82'; x.font = '10.5px sans-serif'; x.textAlign = 'center';
  for (let k = 0; k <= 4; k++) { const gx = pad.l + bw * k / 4, gy = pad.t + bh * k / 4;
    x.beginPath(); x.moveTo(gx, pad.t); x.lineTo(gx, pad.t + bh); x.moveTo(pad.l, gy); x.lineTo(pad.l + bw, gy); x.stroke();
    x.fillText((o.xmax * k / 4).toPrecision(2), gx, pad.t + bh + 12); x.textAlign = 'right';
    x.fillText((o.down ? o.ymax * k / 4 : o.ymax * (1 - k / 4)).toFixed(0), pad.l - 4, gy + 3); x.textAlign = 'center'; }
  x.fillText(o.xlab, pad.l + bw / 2, h - 3); x.save(); x.translate(10, pad.t + bh / 2); x.rotate(-Math.PI / 2); x.fillText(o.ylab, 0, 0); x.restore();
  if (o.refX) { x.strokeStyle = '#d7261e'; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(X(o.refX), pad.t); x.lineTo(X(o.refX), pad.t + bh); x.stroke(); x.setLineDash([]); x.fillStyle = '#d7261e'; x.textAlign = 'left'; x.fillText('baku mutu', X(o.refX) + 3, pad.t + 10); }
  for (const c of curves) { x.strokeStyle = c.color; x.lineWidth = 2; x.beginPath(); c.pts.forEach(([v, y], k) => k ? x.lineTo(X(v), Y(y)) : x.moveTo(X(v), Y(y))); x.stroke(); }
}
