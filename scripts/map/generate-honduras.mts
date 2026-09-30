// Genera `lib/map/honduras-geo.ts` (silueta de Honduras, sus 18 departamentos
// y los países vecinos) a partir de Natural Earth, que es de dominio público.
//
//   npx tsx scripts/map/generate-honduras.mts <carpeta-con-los-geojson>
//
// La carpeta tiene que tener, descargados de
// https://github.com/nvkelso/natural-earth-vector/tree/master/geojson :
//   - ne_10m_admin_0_countries.geojson        (países, escala 1:10m)
//   - ne_10m_admin_1_states_provinces.geojson (departamentos, escala 1:10m)
//
// Esos archivos pesan ~54 MB y NO se suben al repo: solo se sube el resultado,
// ya proyectado y simplificado. La app nunca llama a ningún servicio externo.
//
// Pasos: proyecta con `lib/map/projection.ts`, recorta los vecinos al encuadre
// del mapa (Sutherland–Hodgman), simplifica con Douglas–Peucker y redondea a
// una décima de unidad.

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { MAP_BOUNDS, MAP_HEIGHT, MAP_WIDTH, project } from "../../lib/map/projection";

type Ring = [number, number][];
type Geometry = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
type Feature = { properties: Record<string, unknown>; geometry: Geometry };

const dir = process.argv[2];
if (!dir) {
  console.error("Uso: npx tsx scripts/map/generate-honduras.mts <carpeta-con-los-geojson>");
  process.exit(1);
}
const read = (name: string) => JSON.parse(readFileSync(join(dir, name), "utf8")) as { features: Feature[] };
const countries = read("ne_10m_admin_0_countries.geojson").features;
const provinces = read("ne_10m_admin_1_states_provinces.geojson").features;

/** Tolerancia de la simplificación, en unidades del mapa (~0,4 km). */
const TOLERANCE = 0.55;

const polygons = (g: Geometry): Ring[][] => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

function toMap(ring: Ring): Ring {
  return ring.map(([lng, lat]) => {
    const { x, y } = project({ lat, lng });
    return [x, y];
  });
}

/** Recorta un anillo a un rectángulo (Sutherland–Hodgman), en unidades del mapa. */
function clip(ring: Ring, xmin: number, ymin: number, xmax: number, ymax: number): Ring {
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [(p) => p[0] >= xmin, (a, b) => [xmin, a[1] + ((b[1] - a[1]) * (xmin - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= xmax, (a, b) => [xmax, a[1] + ((b[1] - a[1]) * (xmax - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= ymin, (a, b) => [a[0] + ((b[0] - a[0]) * (ymin - a[1])) / (b[1] - a[1]), ymin]],
    [(p) => p[1] <= ymax, (a, b) => [a[0] + ((b[0] - a[0]) * (ymax - a[1])) / (b[1] - a[1]), ymax]],
  ];
  let out = ring;
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i];
      const previous = input[(i + input.length - 1) % input.length];
      if (inside(current)) {
        if (!inside(previous)) out.push(cross(previous, current));
        out.push(current);
      } else if (inside(previous)) {
        out.push(cross(previous, current));
      }
    }
    if (out.length === 0) break;
  }
  return out;
}

/**
 * Douglas–Peucker sobre un anillo cerrado. El primero y el último punto son el
 * mismo, así que la línea base mediría cero y se tiraría todo: se parte el
 * anillo por el punto más lejano al inicio y se simplifica cada mitad.
 */
function simplify(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4) return ring;
  const [x0, y0] = ring[0];
  let far = 1;
  for (let i = 1; i < ring.length - 1; i++) {
    if (Math.hypot(ring[i][0] - x0, ring[i][1] - y0) > Math.hypot(ring[far][0] - x0, ring[far][1] - y0)) far = i;
  }
  const first = simplifyLine(ring.slice(0, far + 1), tolerance);
  const second = simplifyLine(ring.slice(far), tolerance);
  return [...first, ...second.slice(1)];
}

/** Douglas–Peucker sobre una línea abierta. Conserva el primer y el último punto. */
function simplifyLine(points: Ring, tolerance: number): Ring {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy) || 1;
    let worst = -1;
    let worstDistance = 0;
    for (let i = a + 1; i < b; i++) {
      const distance = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / length;
      if (distance > worstDistance) {
        worstDistance = distance;
        worst = i;
      }
    }
    if (worst !== -1 && worstDistance > tolerance) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (v: number) => Math.round(v * 10) / 10;

function pathOf(rings: Ring[]): string {
  return rings
    .filter((r) => r.length >= 3)
    .map((r) => `M${r.map(([x, y]) => `${round(x)} ${round(y)}`).join("L")}Z`)
    .join("");
}

/** Anillos exteriores (los huecos no hacen falta a esta escala), ya proyectados. */
function outerRings(g: Geometry, clipTo?: [number, number, number, number]): Ring[] {
  return polygons(g)
    .map((polygon) => toMap(polygon[0]))
    .map((ring) => (clipTo ? clip(ring, ...clipTo) : ring))
    .map((ring) => simplify(ring, TOLERANCE))
    .filter((ring) => ring.length >= 3);
}

// Honduras y sus departamentos: completos, sin recortar.
const honduras = countries.find((f) => f.properties.ADM0_A3 === "HND");
if (!honduras) throw new Error("No está Honduras en ne_10m_admin_0_countries.geojson");
const departments = provinces
  .filter((f) => f.properties.adm0_a3 === "HND")
  .map((f) => {
    const label = project({ lat: Number(f.properties.latitude), lng: Number(f.properties.longitude) });
    return {
      id: String(f.properties.iso_3166_2),
      name: String(f.properties.name_es ?? f.properties.name),
      path: pathOf(outerRings(f.geometry)),
      label: [round(label.x), round(label.y)] as [number, number],
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name, "es"));
if (departments.length !== 18) throw new Error(`Se esperaban 18 departamentos y hay ${departments.length}`);

// Vecinos: recortados al encuadre, con un margen para que el borde no se vea.
const MARGIN = 40;
const frame: [number, number, number, number] = [-MARGIN, -MARGIN, MAP_WIDTH + MARGIN, MAP_HEIGHT + MARGIN];
const NEIGHBORS: { code: string; name: string; label: { lat: number; lng: number } }[] = [
  { code: "GTM", name: "Guatemala", label: { lat: 15.35, lng: -89.55 } },
  { code: "SLV", name: "El Salvador", label: { lat: 13.72, lng: -89.35 } },
  { code: "NIC", name: "Nicaragua", label: { lat: 13.15, lng: -85.6 } },
  { code: "BLZ", name: "Belice", label: { lat: 17.05, lng: -88.85 } },
];
const neighbors = NEIGHBORS.map(({ code, name, label }) => {
  const feature = countries.find((f) => f.properties.ADM0_A3 === code);
  if (!feature) throw new Error(`No está ${code} en Natural Earth`);
  const at = project(label);
  return { id: code, name, path: pathOf(outerRings(feature.geometry, frame)), label: [round(at.x), round(at.y)] as [number, number] };
}).filter((n) => n.path);

const out = `// ARCHIVO GENERADO por scripts/map/generate-honduras.mts. No lo edites a mano.
//
// Fuente: Natural Earth (https://www.naturalearthdata.com), dominio público.
// Escala 1:10m: ne_10m_admin_0_countries y ne_10m_admin_1_states_provinces.
// Proyectado con lib/map/projection.ts y simplificado (Douglas–Peucker,
// tolerancia ${TOLERANCE} unidades ≈ 0,4 km). Ver docs/mapa-honduras.md.

export type MapShape = { id: string; name: string; path: string; label: [number, number] };

/** Silueta de Honduras, con las Islas de la Bahía, las del Cisne y las del Golfo de Fonseca. */
export const HONDURAS_PATH = ${JSON.stringify(pathOf(outerRings(honduras.geometry)))};

/** Los 18 departamentos, por nombre. \`id\` es el código ISO 3166-2. */
export const DEPARTMENTS: MapShape[] = ${JSON.stringify(departments)};

/** Países vecinos, recortados al encuadre del mapa. */
export const NEIGHBORS: MapShape[] = ${JSON.stringify(neighbors)};
`;

const target = resolve(process.cwd(), "lib/map/honduras-geo.ts");
writeFileSync(target, out);
console.log(`lib/map/honduras-geo.ts: ${(out.length / 1024).toFixed(1)} KB, ${departments.length} departamentos, ${neighbors.length} vecinos (${neighbors.map((n) => n.name).join(", ")}). Lienzo ${MAP_WIDTH}×${MAP_HEIGHT}. Encuadre ${JSON.stringify(MAP_BOUNDS)}.`);
