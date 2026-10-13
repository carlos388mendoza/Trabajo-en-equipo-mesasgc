// Lámina de la paleta de meseros: cada color en el fondo claro y en el
// oscuro, y cómo se ve con los tres tipos de daltonismo (protanopía,
// deuteranopía y tritanopía, matrices de Machado et al. 2009, severidad 1).
//
// Además MIDE: la diferencia de color (ΔE 2000) entre cada par de meseros,
// con visión normal y con cada simulación, y la de cada mesero contra los
// colores de estado de las mesas (libre, ocupada, reservada). Un ΔE por
// encima de ~20 se distingue de un vistazo; por debajo de ~10 cuesta.
//
//   npx tsx scripts/waiters/lamina-paleta.mts
//
// Escribe `.lamina-paleta/paleta.html` (ignorado por git) y un resumen en la
// consola. No toca la base de datos.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { WAITER_PALETTE } from "../../lib/waiters/palette";

type RGB = [number, number, number];

const STATUS = [
  { name: "Libre (claro)", hex: "#16a34a" },
  { name: "Ocupada (claro)", hex: "#dc2626" },
  { name: "Reservada (claro)", hex: "#64748b" },
  { name: "Libre (oscuro)", hex: "#4ade80" },
  { name: "Ocupada (oscuro)", hex: "#f87171" },
  { name: "Reservada (oscuro)", hex: "#94a3b8" },
];

const CVD: Record<string, number[][]> = {
  protanopía: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopía: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopía: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const hexToRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function simulate(hex: string, kind: string | null): string {
  if (!kind) return hex;
  const lin = hexToRgb(hex).map(toLinear);
  const m = CVD[kind];
  const out = m.map((row) => clamp01(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]));
  return "#" + out.map((c) => Math.round(toGamma(c) * 255).toString(16).padStart(2, "0")).join("");
}

function lab(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** ΔE 2000 (CIEDE2000). */
function deltaE(h1: string, h2: string): number {
  const [L1, a1, b1] = lab(h1);
  const [L2, a2, b2] = lab(h2);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (a: number, b: number) => {
    const v = Math.atan2(b, a) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1p = h(a1p, b1);
  const h2p = h(a2p, b2);
  const dL = L2 - L1;
  const dC = C2p - C1p;
  let dh = h2p - h1p;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hm += h1p + h2p < 360 ? 360 : -360;
    hm /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp;
  const Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

const visions: (string | null)[] = [null, ...Object.keys(CVD)];
const resumen: string[] = [];
const minimos: Record<string, { d: number; par: string }> = {};
for (const v of visions) {
  let best = { d: Infinity, par: "" };
  for (let i = 0; i < WAITER_PALETTE.length; i += 1) {
    for (let j = i + 1; j < WAITER_PALETTE.length; j += 1) {
      const d = deltaE(simulate(WAITER_PALETTE[i].hex, v), simulate(WAITER_PALETTE[j].hex, v));
      if (d < best.d) best = { d, par: `${WAITER_PALETTE[i].name} / ${WAITER_PALETTE[j].name}` };
    }
  }
  minimos[v ?? "visión normal"] = best;
  resumen.push(`${(v ?? "visión normal").padEnd(14)} par más parecido: ${best.par.padEnd(22)} ΔE ${best.d.toFixed(1)}`);
}
let contraEstado = { d: Infinity, par: "" };
for (const c of WAITER_PALETTE) {
  for (const s of STATUS) {
    const d = deltaE(c.hex, s.hex);
    if (d < contraEstado.d) contraEstado = { d, par: `${c.name} / ${s.name}` };
  }
}
resumen.push(`contra los estados: el más parecido es ${contraEstado.par} (ΔE ${contraEstado.d.toFixed(1)})`);

const swatch = (hex: string, name: string, bg: string, fg: string) =>
  `<div class="sw" style="background:${bg};color:${fg}"><span class="dot" style="background:${hex}"></span><span class="ring" style="border-color:${hex}"></span><b>${name}</b><small>${hex}</small></div>`;
const row = (title: string, v: string | null, bg: string, fg: string) =>
  `<section><h2>${title}</h2><div class="grid">${WAITER_PALETTE.map((c) => swatch(simulate(c.hex, v), c.name, bg, fg)).join("")}</div></section>`;
const html = `<!doctype html><meta charset="utf-8"><title>Paleta de meseros</title>
<style>
body{font-family:system-ui,Segoe UI,Roboto,sans-serif;margin:24px;background:#f1f5f9;color:#0f172a}
h1{font-size:22px;margin:0 0 4px}p{margin:0 0 16px;color:#475569;font-size:13px}
section{margin:0 0 14px}h2{font-size:14px;margin:0 0 6px}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:6px}
.sw{border-radius:12px;padding:10px 6px;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:12px;position:relative}
.dot{width:34px;height:34px;border-radius:50%}
.ring{width:40px;height:40px;border-radius:12px;border:6px solid;box-sizing:border-box}
small{opacity:.7;font-size:10px}
pre{background:#fff;border-radius:12px;padding:12px;font-size:12px;border:1px solid #e2e8f0}
.st{display:flex;gap:10px;margin:0 0 14px;font-size:12px;flex-wrap:wrap}.st span{display:flex;align-items:center;gap:6px}.st i{width:18px;height:18px;border-radius:50%;display:inline-block}
</style>
<h1>Paleta de meseros</h1>
<p>Cada mesero se reconoce solo por su color: círculo (leyendas, Ver clientes) y borde grueso alrededor de la mesa (plano). En orden: mesero 1 a 12 (lima y lavanda solo con 11 o 12 meseros).</p>
<div class="st">Colores de estado de las mesas, para comparar: ${STATUS.map((s) => `<span><i style="background:${s.hex}"></i>${s.name}</span>`).join("")}</div>
${row("Fondo claro", null, "#f8fafc", "#0f172a")}
${row("Fondo oscuro", null, "#0a1428", "#e2e8f0")}
${row("Protanopía (no ve el rojo)", "protanopía", "#f8fafc", "#0f172a")}
${row("Deuteranopía (no ve el verde)", "deuteranopía", "#f8fafc", "#0f172a")}
${row("Tritanopía (no ve el azul)", "tritanopía", "#f8fafc", "#0f172a")}
<pre>${resumen.join("\n")}</pre>`;

const dir = resolve(process.cwd(), ".lamina-paleta");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "paleta.html"), html);
console.log(resumen.join("\n"));
console.log(`\nLámina: ${join(dir, "paleta.html")}`);
export { minimos };
