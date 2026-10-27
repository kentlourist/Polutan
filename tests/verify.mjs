// Level 6 – Verifikasi: solver dibandingkan dengan solusi analitik.
import { solveGW, plumePoint, sigma, airField } from '../js/engine.js';

function erfc(x) { // Abramowitz–Stegun 7.1.26 (|err| < 1.5e-7)
  const s = x < 0 ? -1 : 1, z = Math.abs(x), t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return s > 0 ? 1 - y : 1 + y;
}
const ogataBanks = (x, t, v, D, R = 1) => { const vp = v / R, Dp = D / R, a = 2 * Math.sqrt(Dp * t);
  return 0.5 * (erfc((x - vp * t) / a) + Math.exp(vp * x / Dp) * erfc((x + vp * t) / a)); };

let gagal = 0;
const cek = (nama, ok, info) => { console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${nama}  ${info}`); if (!ok) gagal++; };

// 1) Transport 1D: sumber konsentrasi tetap di batas kiri, aliran ke timur.
{
  const K = 10, grad = 0.1, ne = 0.5, aL = 2.5, hari = 100;       // v = 2 m/hari, D = 5 m2/hari
  const n = 200, luasM = 400, dx = luasM / n;
  const r = solveGW({ n, luasM, K, grad, ne, aL, rhoB: 0, Kd: 0, lambda: 0, arah: 90, C0: 1, hari, nSnap: 2,
                      sourceMask: (i) => i <= 1 });
  const D = aL * r.v + 1e-4, g = r.snaps.at(-1).grid, j = n / 2;
  let maxErr = 0;
  for (let i = 5; i < n - 5; i++) {
    const x = (i + .5) * dx - 2 * dx;                              // jarak dari tepi sumber
    maxErr = Math.max(maxErr, Math.abs(g[j * n + i] - ogataBanks(x, hari, r.v, D)));
  }
  cek('Transport 1D vs Ogata–Banks', maxErr < 0.06, `galat maks = ${maxErr.toFixed(4)} (toleransi 0.06 C0)`);
}

// 2) Retardasi: front sorpsi bergerak R kali lebih lambat.
{
  const base = { n: 200, luasM: 400, K: 10, grad: 0.1, ne: 0.5, aL: 2.5, lambda: 0, arah: 90, C0: 1, hari: 100, nSnap: 2, sourceMask: (i) => i <= 1 };
  const a = solveGW({ ...base, rhoB: 0, Kd: 0 }), b = solveGW({ ...base, rhoB: 1.6, Kd: 0.3 });
  const front = (r) => { const g = r.snaps.at(-1).grid; let i = 2; while (i < 199 && g[100 * 200 + i] > 0.5) i++; return i * 2; };
  cek('Retardasi menggeser front 0.5 C0', front(b) < front(a) / 1.5, `tanpa sorpsi ${front(a)} m, dengan sorpsi ${front(b)} m (R = ${b.R.toFixed(2)})`);
}

// 3) Plume Gaussian: kekekalan massa terhadap fluks emisi (tanpa deposisi, tanpa pantulan batas).
{
  const Q = 100, H = 50, u = 5, x = 2000;
  const [sy, sz] = sigma('D', x, false);
  let sum = 0; const dy = 5;
  for (let y = -6 * sy; y <= 6 * sy; y += dy) sum += plumePoint(Q, H, u, 'D', false, x, y, 0) * 1e-6 * dy;
  // integral lateral * integral vertikal (refleksi tanah) * u = Q  -> cek integral lateral analitik
  const analitik = 2 * Q / (Math.sqrt(2 * Math.PI) * u * sz) * Math.exp(-H * H / (2 * sz * sz)); // faktor 2 = pantulan tanah
  cek('Plume: integral lateral = solusi analitik', Math.abs(sum - analitik) / analitik < 0.02, `numerik ${sum.toExponential(3)} vs analitik ${analitik.toExponential(3)}`);
}
// 4) Profil vertikal 3D: integral C(z) dz = Q / (sqrt(2 pi) u sy) (tanpa deposisi), dan koreksi terrain.
{
  const src = [{ e: 0, n: 0, H: 40, d: 0, vs: 0, Ts: 300, Q: { X: 10 } }];
  const par = { sumber: src, polutan: 'X', u: 4, dirFrom: 270, cls: 'D', urban: false, kLoss: 0 };
  const f = airField(par), x = 3000, [sy] = sigma('D', x, false);
  let sum = 0; for (let z = 0; z <= 3000; z += 2) sum += f.c(x, 0, z, 0) * 1e-6 * 2;
  const an = 10 / (Math.sqrt(2 * Math.PI) * 4 * sy);
  cek('Profil vertikal 3D terintegrasi = analitik', Math.abs(sum - an) / an < 0.01, `numerik ${sum.toExponential(3)} vs analitik ${an.toExponential(3)}`);
  const dem = (e) => e > 2000 ? 60 : 0;      // bukit datar setinggi 60 m di hilir
  const tinggi = [{ ...src[0], H: 150 }];
  const a = airField({ ...par, sumber: tinggi, dem, topo: true }), b = airField({ ...par, sumber: tinggi, dem, topo: false });
  cek('Terrain menaikkan konsentrasi permukaan di bukit', a.c(3000, 0, 0) > b.c(3000, 0, 0) * 1.5, `${a.c(3000, 0, 0).toFixed(1)} vs ${b.c(3000, 0, 0).toFixed(1)} ug/m3`);
}
process.exit(gagal ? 1 : 0);
