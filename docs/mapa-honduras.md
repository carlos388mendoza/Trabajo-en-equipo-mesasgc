# Mapa de Honduras

El mapa general (`/mapa`) dibuja Honduras entero en SVG, sin llamar a ningún
servicio externo: todos los datos están dentro del repositorio.

## Fuente de los datos

**Natural Earth**, https://www.naturalearthdata.com. Es de **dominio público**:
se puede usar, cambiar y distribuir sin permiso ni atribución obligatoria.
Igual la citamos.

| Archivo de Natural Earth | Escala | Para qué |
|---|---|---|
| `ne_10m_admin_0_countries.geojson` | 1:10m | Silueta de Honduras (con las Islas de la Bahía, las del Cisne y los islotes del Golfo de Fonseca) y los vecinos: Guatemala, El Salvador, Nicaragua y Belice |
| `ne_10m_admin_1_states_provinces.geojson` | 1:10m | Los 18 departamentos, con su nombre y su punto de rótulo |

Se descargaron de https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
el 30 de septiembre de 2026. **No se suben al repo** (pesan unos 54 MB): solo
se sube el resultado.

## Qué hay en el repo

| Archivo | Qué es |
|---|---|
| `lib/map/projection.ts` | La proyección: latitud y longitud ↔ unidades del mapa. |
| `lib/map/honduras-geo.ts` | **Generado.** Silueta, departamentos y vecinos, ya proyectados (~39 KB). No se edita a mano. |
| `lib/map/world.ts` | Las 11 ciudades principales (latitud y longitud de su centro), los encuadres de la cámara y sus límites. |
| `scripts/map/generate-honduras.mts` | El script que genera `honduras-geo.ts`. |

### La proyección

- Es **equirectangular**, centrada en Honduras: la longitud se multiplica por
  el coseno de la latitud media (15,1°) para que el país no salga estirado.
- En un país de 5° de alto la deformación es mínima, y la cuenta es exacta en
  los dos sentidos (`project` / `unproject`).
- **Encuadre:** de 89,9° O a 82,9° O y de 12,6° N a 17,6° N, en un lienzo de
  **1000 × 740** unidades. Incluye las Islas del Cisne y deja ver las
  fronteras.
- Las mismas unidades que `restaurants.map_x` / `map_y`.

### Cómo se genera

1. Descarga los dos `.geojson` de arriba en una carpeta fuera del repo.
2. Corre:

   ```bash
   npx tsx scripts/map/generate-honduras.mts <carpeta>
   ```

El script:
- proyecta los datos con `lib/map/projection.ts`;
- recorta los vecinos al encuadre (Sutherland–Hodgman);
- simplifica con Douglas–Peucker (tolerancia de 0,55 unidades, unos 400 m);
- redondea a una décima;
- escribe `lib/map/honduras-geo.ts`.

Si cambias el encuadre en `projection.ts`, vuelve a generarlo.

## Ubicación de los restaurantes

- Cada restaurante tiene `latitude` y `longitude` (migración `0004`, solo
  aditiva). El mapa usa esas coordenadas, y `map_x`/`map_y` solo si faltan.
- Las de los 8 restaurantes están en `lib/layout/base-restaurants.ts`, de
  donde las toman el seed y `npm run db:restaurantes`.
- Son las de su barrio o su bulevar, con una precisión de unos cientos de
  metros. Si se conoce la dirección exacta de un local, basta con cambiar sus
  dos números.
- `db:restaurantes` **solo rellena** la ubicación de un restaurante que no
  tenga ninguna: nunca pisa una que ya exista.

## Quién ve el mapa

- Admin y analitica: `/mapa`, con todos los restaurantes (`mapa:ver`).
- El rol restaurante no entra en `/mapa`: ve el plano en vivo de los suyos en
  `/restaurante/[id]/mapa` (ver `docs/rbac.md`).

## Rendimiento (perf/mapa, 1 de octubre de 2026)

El mapa se sentía lagueado. Se midió con Chrome en modo headless (60 Hz
reales), contra la app compilada en producción y el seed de desarrollo, con
un script que en cada cuadro manda un `pointermove` (arrastre en círculo) o
un `wheel` (acercar y alejar) y cuenta los cuadros. «Tablet» es 768 × 1024
con la CPU 4 veces más lenta.

| Escenario | Antes | Después |
|---|---|---|
| Computadora 1280 × 800: reposo / arrastre / rueda | 60 / 24,3 / 14,8 fps | 60 / 60 / 60 fps |
| Tablet (CPU 4×): reposo / arrastre / rueda | 44,7 / 11 / 13 fps | 51,7 / 54 / 47,3 fps |
| Tiempo de pintado en la prueba de tablet | 2,9 s | 0,05 s |

Qué lo hacía lento (según la traza del navegador):

1. **Cada cuadro del gesto cambiaba el `viewBox` con `setState`**: React
   volvía a renderizar todo el componente (filtros, lista, ~165 nodos SVG y
   los grupos), y el navegador recalculaba estilos, layout y repintaba el SVG
   entero.
2. **Los rótulos cambiaban de `fontSize` en cada cuadro**, con su layout.
3. **El barrido del radar y los halos que pulsan eran elementos SVG
   animados**: el SVG no se compone en la GPU, así que se repintaba el mapa
   en cada cuadro aunque nadie lo tocara.
4. **`backdrop-blur` en los controles de encima**: había que desenfocar de
   nuevo lo de detrás en cada cuadro.

No había filtros SVG (`blur`, `drop-shadow`), las líneas ya usaban
`vector-effect="non-scaling-stroke"` y los polígonos son pocos (unos 3 300
puntos), así que no hizo falta simplificarlos por zoom ni pasar a canvas.

Qué se cambió (`components/map/world-map.tsx`):

- **Cámara en dos tiempos.** Durante el gesto (o una animación de los
  botones) solo cambia el `transform` CSS de una capa con
  `will-change: transform`, con `requestAnimationFrame`: lo mueve la GPU,
  sin React. Al soltar, o 150 ms después de la última rueda, se confirma la
  cámara: un render, con los rótulos a su tamaño y los grupos recalculados.
- **La capa mide el doble que la ventana del mapa**, para que al arrastrar no
  se vean bordes vacíos antes de confirmar.
- **`MapBase` está memoizado** y en su propia capa: los contadores en vivo
  solo redibujan los marcadores.
- **Barrido y halos son `div`** que animan solo `transform` y `opacity`
  (`RadarSweep`, `PulseLayer`): los anima el compositor. Se paran con
  «reducir movimiento» y el navegador los pausa con la pestaña oculta. De
  muy cerca (más de 4 000 px de diámetro) el barrido no se pinta.
- **Controles sin `backdrop-blur`**, con fondo al 95 %.
- **El minimapa se mueve en vivo** por `ref`, sin renderizar.

Mientras dura un gesto, los rótulos y marcadores se agrandan o achican con
el zoom y vuelven a su tamaño al soltar, como en los mapas de los teléfonos.
