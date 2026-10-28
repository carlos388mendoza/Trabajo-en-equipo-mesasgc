# Estado del proyecto

_Actualizado el 28 de octubre de 2026: **todo terminado y publicado**. Sin pendientes._

**Table Waitlist:** listas de espera en tiempo real para los restaurantes de
Grupo Comidas.
- Stack: Next.js 16, React 19, Drizzle y Turso, Better Auth, TypeScript.
  Tiempo real por HTTP con sondeo. Despliegue en Vercel.
- Equipo: Miembro A (editor, tiempo real, conflictos y auth) y Miembro B (modo
  rápido, estadísticas e IA).

## En producción

- **App:** https://mesasgc-demo.vercel.app (rama `main`, Vercel + Turso `mesasgc-prod`).
- **Última publicación (28 de octubre de 2026):** contraseñas fuera del repositorio
  (`SEED_PASSWORD`), «Eliminar cuenta» y «Eliminar contraseña» en /admin, sin aviso rojo al entrar,
  prueba de `verify:realtime` estable, y los **ahorros del sondeo** (usuario una vez por pregunta,
  `cookieCache` de 60 s, pausa con la pantalla oculta y espaciado sin actividad).
- **Issues:** los 9 están cerrados y comprobados en el código (#58 a #61, #86 a #89 y #107).
- **Documentos de entrega:** `docs/entrega-empresa.md` (qué es, servicios, variables, publicar,
  respaldos, usuarios, límites y transferencia de cuentas) y `docs/consumo-turso-sondeo.md` (consumo y planes).
- **Plan de Vercel:** Hobby es solo para uso no comercial y no alcanza para el uso real
  (ver `docs/consumo-turso-sondeo.md`): pasar a **Vercel Pro** a nombre de la empresa.
- La historia detallada (decisiones, listas de pendientes anteriores y la etapa de hosting anterior)
  está en el historial de git de este archivo.

## Lo que ya está hecho

Todo esto está en `testing` y en `main` (desplegado el 6 de octubre de 2026,
PR #66).

| Área | Qué hay | Dónde está | PR |
|---|---|---|---|
| Esquema y seed | Restaurantes, marcas, zonas, elementos, lista de espera y catálogo de 8 tipos. Seed idempotente (solo desarrollo; con `NODE_ENV=production` se niega a correr): 8 restaurantes, 11 usuarios de prueba (un host por restaurante) y 8 semanas de historial (~12 000 grupos) para las estadísticas. | `lib/db/`, `scripts/seed.ts`, README §15 | varios, #20 |
| Catálogo en producción | `npm run db:catalog` carga los 8 tipos de elemento sin tocar nada más. Va en el Pre-deploy. | `lib/layout/catalog.ts`, `scripts/db-catalog.mts` | #21 |
| Editor de mesas | Plano con Konva para tablet: arrastrar, redimensionar, girar elementos, deshacer y copiar a otro restaurante. | `components/editor/`, README §8–9, §12 | #3, #7 |
| Editor fluido en tablet y celular | 57-60 FPS con la CPU 4× más lenta al arrastrar, mover el plano y pellizcar; panel lateral o barra abajo que no tapa el plano; mesas nuevas dentro del recuadro y nada se sale de la zona. | `components/editor/`, `lib/layout/placement.ts`, README §12 | `perf/editor-fluido` |
| Plano en vivo a pantalla completa en la tablet | Con la tablet en horizontal (Opera), el plano ocupa toda la pantalla sin cabecera ni menú, se encuadra solo (también al cambiar de tamaño) y lleva controles flotantes: meseros [−] N [+], **Lista** (el modo sencillo en un panel lateral) y volver a la vista normal. En vertical, celular y computadora no cambia nada. Solo el propio sitio puede meter la app en un iframe. | `components/map/live-plan.tsx`, `lib/layout/immersive.ts`, README §16 | `feat/plano-inmersivo` |
| «Ver clientes» y colores de los meseros | «Ver todas las cartas» del modo sencillo pasa a llamarse **Ver clientes**. Arriba, la leyenda de los meseros activos (punto de color y nombre, los colores del plano en vivo); tocar uno filtra sus clientes. Cada cliente sentado lleva la franja y el nombre de su mesero; los demás, «Sin mesero». Se pone al día en vivo con el [−] [+] de los meseros. | `components/quick-mode/all-cards-view.tsx`, `lib/waiters/legend.ts`, README §11 | `feat/ver-clientes-meseros` |
| «Lista de espera» en todas las vistas del plano | El botón con el número de clientes en espera abre la lista (el modo sencillo) en computadora, tablet y celular; se cierra con X o Esc. | `components/map/live-plan.tsx`, README §16, `verify:browser` | #73 |
| Listas ligeras (rendimiento) | El modo sencillo baja solo lo activo (1–11 KB en vez de hasta 1,7 MB); «Ver clientes» paginado de 50 en 50 con «Ver más» y filtros en el servidor; índices compuestos (migración `0011`, solo aditiva); estadísticas agregadas en la base (462 → 39 ms). Cada pantalla abre en menos de 1 s en tablet con la CPU 4× más lenta. | `lib/waitlist/active.ts`, `lib/waitlist/cards.ts`, `lib/analytics/data.ts`, README §11 | #77 |
| Liberar mesas y limpiar clientes viejos | «Ver clientes»: 30 días y Todos, filtro «Ocupando mesa», casillas con Liberar mesas / Marcar ausente / Eliminar seleccionados, eliminar a un sentado (libera y elimina) y «Limpiar pendientes antiguos» (12 h, 24 h, 7 días) con vista previa y deshacer. Plano en vivo: tocar una mesa ocupada → Liberar mesa, y «Liberar todas las mesas» escribiendo LIBERAR. Restaurante en los suyos, admin en todos, analítica no. | `lib/waitlist/batch.ts`, `lib/realtime/server.ts`, `components/quick-mode/all-cards-view.tsx`, `components/map/live-plan.tsx`, README §11 y §16 | `fix/liberar-y-limpiar` |
| Primero liberar, luego eliminar | Un cliente en una mesa no se elimina hasta liberar la mesa: aviso con «Liberar mesa» / «Cancelar», «Eliminar» atenuado («Libera la mesa primero»), y en grupo «Liberar sus mesas» / «Eliminar solo los N sin mesa». El servidor lo exige (socket, grupo y cola sin conexión). Liberar una mesa se puede deshacer, y Deshacer sobrevive 10 minutos a un reinicio (tabla `waitlist_undo`, migración 0012). | `lib/waitlist/delete-rule.ts`, `lib/waitlist/batch.ts`, `lib/waitlist/quick-actions.ts`, README §11 | `fix/primero-liberar` |
| Plano en vivo: diseño de siempre con las funciones nuevas | El diseño de #80 («menos saturado») no gustó: el plano vuelve al de `testing` 8d2da2d (mesas con sillas, píldoras, leyenda y minimapa), con el panel de cada mesa (Sentar, Liberar mesa, Eliminar cliente después de liberar), tiempos legibles y dos arreglos que no cambian el aspecto: el cliente dentro del sitio de su mesa (sin encimarse con la de abajo) y los controles del celular en una fila. | `components/map/live-plan.tsx`, `components/map/table-sheet.tsx`, `components/editor/element-node.tsx`, README §16, `verify:browser` | `feat/plano-diseno-anterior` |
| Sin zonas de demostración | Se borraron los 8 «Comedor (demostración)» (producción y local) con `deleteZone`: mesas liberadas antes, clientes y cifras conservados, mesas fuera del reparto de meseros, «Comedor principal» por defecto donde hacía falta. `db:demo` ya no crea zonas ni mesas. | `lib/layout/delete-zone.ts`, `scripts/db-borrar-zonas-demo.mts`, `lib/demo/`, README §17 | `feat/plano-diseno-anterior` |
| Meseros solo por color | Sin nombres de meseros en ninguna pantalla: círculo de color (con nombre oculto para lectores de pantalla y globo al mantener presionado), «Mesero azul» en avisos, estadísticas y la IA. Paleta nueva de 12 colores muy distintos (también con daltonismo), aplicada a las configuraciones existentes. | `lib/waiters/palette.ts`, `lib/waiters/colors.ts`, `components/waiters/`, `scripts/db-meseros-paleta.mts`, README §18 | `feat/plano-diseno-anterior` |
| Configuración de privacidad y retención | /admin → Configuración (solo admin): IA con alias, nombres del top 10 para analítica y cuánto se guarda el historial; la retención anonimiza sin borrar cifras. | `lib/settings/`, `docs/configuracion.md`, README §14 | #74 |
| Preparación del piloto | Respaldo de producción en solo lectura (`npm run db:respaldo`), guion de FPS (`npm run perf:editor`), lista de verificación, manuales del host y del admin, plantilla de reporte. | `docs/piloto.md`, `docs/manual-*.md`, `docs/respaldos.md`, `scripts/` | `chore/preparar-piloto` |
| Giro guardado y estructura | El giro del plano completo se guarda (`table_layouts.rotation`), se avisa en vivo, se copia y lo respetan el plano en vivo y el minimapa. Tipos barra, puerta y pared. | `components/editor/`, `lib/layout/`, README §12 | #14 |
| Tiempo real | Avisos por HTTP con sondeo sobre Turso (sin servidor propio), con una room por restaurante y la sala `overview` del mapa. | `lib/realtime/`, README §10, §16 | #5, #11 |
| Conflictos | Asignación de mesa con bloqueo optimista: gana el primero y el otro recibe «Esta mesa ya fue asignada». | `lib/tables/assign.ts` | #5 |
| Autenticación y roles | Better Auth con correo y contraseña. Roles admin, restaurante y analitica. `/login`, `/inicio`, `/admin`, `/sin-acceso`, y encabezado con sesión y favicon. | `lib/auth/`, `proxy.ts`, README §14–15, `docs/rbac.md` | #8 |
| Modo rápido (Miembro B) | En vivo por tiempo real (`waitlist:add`, `waitlist:resolve` y `waitlist:undo`, con `canModifyWaitlist`), tarjetas tipo Tinder con `motion` y Deshacer (botón y Ctrl+Z). | `components/quick-mode/`, `lib/waitlist/`, README §11 | #9 |
| Estadísticas e IA (Miembro B) | Últimos 14 días en hora de Honduras, «tiempo hasta avisar» con `called_at`, top 10 de clientes y asistente. | `components/analytics/`, `lib/analytics/`, `app/api/` | #9 |
| Marcas en estadísticas y privacidad del asistente (Miembro B) | Filtros por marca real (`restaurants.brand_id`) y por ciudad. El top de clientes viaja a OpenRouter con alias («Cliente 1»…) y sin teléfonos ni notas; los nombres se restauran solo en pantalla. La anonimización busca los datos sensibles sobre el texto original y solo como palabra entera: conserva fechas, días, cantidades, restaurantes y marcas. | `lib/analytics/`, README | #17, #19 |
| Mapa general y marcas | Tabla `brands` (4 marcas). `/mapa`, en estilo radar, con **todo Honduras**: silueta real, 18 departamentos, vecinos, Islas de la Bahía, Golfo de Fonseca y 11 ciudades principales (Natural Earth, dominio público, dentro del repo). Restaurantes en su ubicación real (`latitude`/`longitude`, migración `0004`). Rueda, pellizco, arrastre, botones «Ver todo Honduras» / Tegucigalpa / San Pedro Sula, minimapa y grupos por ciudad vistos de lejos. En vivo (solo contadores), con filtros, lista por espera y zoom al plano. `/restaurante/[id]/mapa` para el host. Analitica no ve nombres. | `lib/map/`, `components/map/`, README §16, `docs/mapa-honduras.md`, `docs/rbac.md` | #11, #28 |
| Marcas y restaurantes desde /admin | Crear, editar y desactivar marcas (nombre y color) y restaurantes (nombre, marca, ciudad, latitud y longitud, o una ciudad del mapa). Un restaurante nuevo nace con una zona vacía y sale de inmediato en el mapa, las estadísticas y los accesos. Desactivar no borra nada (migración `0005`, `active`): sale de la operación, pero conserva su historial y sus asignaciones. Permiso `catalogo:gestionar` (solo admin). | `lib/layout/catalog-admin.ts`, `app/admin/catalog-actions.ts`, `components/admin/admin-catalog.tsx`, README §16 | #35 |
| Usuarios desde la terminal | `npm run create-user`: crea o actualiza un usuario por argumentos (correo, nombre, roles, restaurantes por slug o por marca), con la contraseña dos veces oculta en la terminal y confirmación «si»; si existe, no toca la contraseña. Mismas validaciones que `/admin`. Piloto con 2 usuarios (`dennys@` y `pizzahut@`). | `scripts/create-user.mts`, `lib/auth/user-upsert.ts`, README §15 | #42 |
| Un usuario para varios restaurantes | Selector de restaurante en la cabecera (color e inicial de la marca) que lleva al mismo modo, y `/inicio` con una tarjeta por restaurante (cuántos esperan y espera media, se refresca sola). Al cambiar, la pantalla sale de la room anterior y entra en la nueva. En `/admin`, restaurantes agrupados por marca, con «Marcar todos» y buscador. | `components/layout/restaurant-switcher.tsx`, `app/inicio/page.tsx`, `components/admin/admin-users.tsx` | #36, #37 |
| Cartas del modo rápido | Montón a todo el ancho. Tocar la carta (o «+ Agregar cliente») abre el formulario en un panel que sube desde abajo o en ventana; tocar una esquina abre la fila en abanico (hasta 7 y «+N»). Pestaña **Varios** para agregar hasta 30 de una vez (filas o «Pegar lista»), todos o ninguno, con deshacer en grupo. «Ver todas las cartas» (hoy o 7 días, filtros y buscador) con volver a la espera. Migración `0006` (`resolved_at`, `resolved_by_user_id`). | `components/quick-mode/`, `lib/waitlist/`, `app/api/restaurante/[id]/cartas`, README §11, `docs/salida-a-produccion.md` §4 | #40 |
| Mapa más rápido | Cámara por `transform` CSS durante el gesto (sin React) y confirmada al soltar; base memoizada; radar y halos animados por el compositor; controles sin `backdrop-blur`. Arrastre 24 → 60 fps y rueda 15 → 60 en computadora; 11 → 54 y 13 → 47 en tablet (CPU 4×). | `components/map/world-map.tsx`, `docs/mapa-honduras.md` | #41 |
| Aspecto | Estilo de mapa «radar», minimapa, íconos de lucide y temas Claro, Oscuro, Sistema y Personalizado, sin parpadeo. | `lib/theme/`, `/ajustes`, README §13 | #7 |
| CI | GitHub Actions en cada PR y cada push a `testing` y `main`: typecheck, lint, build y los cuatro `verify`, con Node 22 y `npm ci`. | `.github/workflows/ci.yml` | #10 |
| Datos de demostración | Lote de datos falsos para probar el mapa, las estadísticas y el asistente: `npm run db:demo` (idempotente) en los 8 restaurantes reales, con una zona demo propia por restaurante, clientes esperando con teléfonos de mentira, mesas demo ocupadas y reservadas y 8 semanas de historial. Marcado estructural con `is_demo` y `demo_batch_id` (migración `0007`, solo aditiva), nunca por nombre. Se borra con `npm run db:demo:borrar` (`borrarDemoData()`). Desde el 5 de octubre, sin interfaz: se quitaron el aviso, el enlace, la sección de `/admin` y `/admin/datos-demo`; queda la etiqueta «Demo» en las cartas. | `lib/demo/`, `scripts/db-demo*.mts`, README §17 | #45, #51 |
| Despliegue | Build de producción en Vercel (`scripts/vercel-build.mjs`: migraciones y catálogo), `/api/health` público y guía de entrega. | `docs/entrega-empresa.md`, `docs/despliegue-vercel.md`, `vercel.json` | #13, #21, #109 |
| Del 2 de octubre (#47–#51) | Borrar un cliente desde el modo sencillo con Aceptar/Cancelar y deshacer (#47, #48); panel «Ver todas las cartas» arrastrable y sin X (#49); modo sencillo sin conexión con cola en IndexedDB, `operationId` y conflictos (#50, migración `0008`); borrado de datos demo por restaurante y etiqueta «Demo» (#51). | `components/quick-mode/`, `lib/offline/`, `public/sw.js`, `lib/demo/` | #47–#51 |
| Zonas de meseros y plano por defecto | Configuraciones por cantidad de meseros con una activa, selector «Meseros activos», reparto por toque, rectángulo o automático, mesero al sentar, estadísticas y asistente por mesero (migración `0009`, solo aditiva). Plano por defecto elegido desde el editor; copiar y pegar elementos. | `lib/waiters/`, `components/waiters/`, `lib/layout/default.ts`, README §18–19 | `feat/zonas-meseros` |
| Usuarios por marca, sin interfaz demo (5 de octubre) | Un usuario de restaurante por marca (`pizzahut@`, `dennys@`, `kfc@`, `chinawok@`) con todos sus locales; fuera el aviso y la sección de datos demo (los datos se quedan); solo las 4 marcas reales. | `scripts/seed.ts`, README §15 y §17 | #53 |
| Editor: una sola ventana (5 de octubre) | Panel de control único con el elemento seleccionado dentro, Rehacer, copiar y pegar elementos sin relaciones, plegado automático en el celular, marcador de mesa más grande y «Ajustar» a las mesas. Acceso directo «Modo sencillo» en la cabecera. | `components/editor/`, `lib/layout/clipboard.ts`, `components/layout/restaurant-mode-link.tsx`, README §12 | `feat/editor-panel-unico` |
| Documentos | Guion de la demo y plan de salida a producción para la dirección. | `docs/demo.md`, `docs/salida-a-produccion.md` | #14 |

Las verificaciones automáticas no usan ningún *runner* de tests: son scripts
contra una base temporal. Ejecutadas el **1 de octubre de 2026** sobre
`feat/datos-demo` (`8d85dc1`, local con Node 22 y SQLite temporal):

| Comando | Resultado |
|---|---|
| `npm run verify:editor` | 144/144 (incluye el catálogo de `db:catalog`) |
| `npm run verify:realtime` | 158/158 (incluye volver a la espera, los rangos de las cartas y agregar varios) |
| `npm run verify:auth` | **329/329** (incluye la API de las cartas, agregar varios, volver a la espera por rol y todo el bloque de datos de demostración: aviso por rol, pantalla, borrado por HTTP y supervivencia de lo real). Levanta la app real; incluye el healthcheck, la privacidad del asistente y el bloqueo del seed en producción. |
| `npm run verify:demo` | **85/85** (nuevo; datos, idempotencia, FK, aborto y matriz de permisos) |
| `npm run typecheck` | pasa |
| `npm run lint` | pasa sobre el código del repositorio. En esta máquina hay dos carpetas `.next-preview` y `.next-perf` de pruebas antiguas, ignoradas por git pero no por `eslint.config.mjs`, que meten ruido de `node_modules` compilado; CI no las tiene. |
| `npm run build` | pasa (Next 16.3.6). En local, si hay un `next dev` corriendo, `.next` queda bloqueado en Windows: con `NEXT_DIST_DIR` aparte. |

Ejecutada el **6 de octubre de 2026** sobre la rama de la issue #59,
`npm run verify:markdown` da **67/67**: renderiza el Markdown del asistente de
verdad (`react-dom/server`) y comprueba, con casos de ataque, que ni
`<script>`, ni `<iframe>`, ni atributos `on…=`, ni URLs `javascript:` llegan
como elementos reales: se quedan como texto visible. Corre en el CI (junto con
`verify:editor` 204/204, `verify:realtime` 231/231 y `verify:auth` 452/452
tras #58).

Añadido con #60, `npm run verify:browser` (**no corre en el CI**: necesita
Chrome) levanta la app real y mide `/analiticas` con Chrome por DevTools
Protocol, sin dependencias nuevas. Comprueba los ejes y la leyenda del gráfico
(#60) y, en 320, 375, 414, 768, 1024 y 1440 px en claro y oscuro, que
`document.documentElement.scrollWidth <= window.innerWidth` (#61); si algo se
sale, lista las hojas que empujan la página. Deja capturas en
`.verify-browser/shots/`.

Cifras reales del lote sobre los 8 restaurantes, contadas el 1 de octubre de
2026: **8 zonas de demostración, 86 mesas, 29 clientes esperando, 29 sentados,
6 mesas reservadas y 12 251 de historial**; 12 403 filas en total, con 0
omitidos. Cargarlo otra vez no añade nada (0 en todo).

## Cumplimiento del enunciado

Revisado el 5 de octubre de 2026, requisito por requisito. «Dónde se ve» dice
la pantalla donde se puede comprobar a mano y la prueba automática que lo
cubre.

| Requisito del enunciado | ¿Cumple? | Dónde se ve |
|---|:---:|---|
| Listas de espera en tiempo real para restaurantes | Sí | Modo sencillo (`/restaurante/[id]/rapido`) en dos tablets a la vez: lo que hace una aparece en la otra. `verify:realtime`. |
| Estructura de mesas por local: tipo, posición x/y, rotación | Sí | Tablas `table_layouts` y `tables` (`lib/db/schema.ts`); editor (`/restaurante/[id]/editor`). `verify:editor`. |
| Editor de mesas *drag & drop* | Sí | Editor: arrastrar desde la paleta, mover, redimensionar y girar; Deshacer. README §8 y §12. |
| Copiar la configuración de mesas a otro restaurante | Sí | Editor → «Copiar plano». Exige `editor:guardar` en los dos. `verify:editor` y `verify:auth`. |
| Rotación de configuraciones guardadas (galería) | Sí | Varias zonas por restaurante: selector «Zona» del editor y pestañas del plano en vivo; giro del plano completo guardado. README §9 y §12. |
| tiempo real con una *room* por restaurante | Sí | Cada restaurante oye solo lo suyo; la sala `overview` lleva solo contadores. `verify:realtime` y `verify:auth`. |
| Conflictos: bloqueo optimista, el primero gana y al segundo «Esta mesa ya fue asignada» | Sí | Dos tablets sentando en la misma mesa. `lib/tables/assign.ts`; `verify:realtime` (también con la cola sin conexión). |
| Modo rápido de *check-in*/*check-out* con tarjetas deslizables (listo / ausente) | Sí | Modo sencillo: deslizar la carta o los botones; «Ver clientes» (antes «Ver todas las cartas»), con los colores de los meseros. README §11. |
| Historial de acciones con Deshacer (Ctrl+Z) | Sí | Botón Deshacer y Ctrl+Z en el modo sencillo y en el editor. `verify:realtime`. |
| Estadísticas: espera promedio, día más rápido y más lento, top de clientes | Sí | `/analiticas`. El gráfico «Volumen y tiempo de espera» lleva sus ejes etiquetados («Clientes (grupos)» a la izquierda, «Minutos de espera» a la derecha, «Día» debajo), con el máximo de cada escala, leyenda de series y avisos de barra con la unidad. La página no tiene scroll horizontal en 320, 375, 414, 768, 1024 ni escritorio (`verify:browser`, 6 anchos × claro/oscuro). `verify:auth` (por rol y con filtros) y `verify:browser`. |
| Asistente de IA en lenguaje natural sobre las estadísticas | Sí | `/analiticas` → «Pregunta sobre tu servicio». Con OpenRouter y respuestas locales sin clave; nombres con alias. La respuesta se pinta como Markdown (`react-markdown` + `remark-gfm`, sin `rehype-raw`: el HTML crudo queda como texto y no se ejecuta). `verify:auth` y `verify:markdown`. |
| Resumen automático de estadísticas | Sí | `/analiticas` → «Resumen de 14 días» (variación, día más lento, mesero que más atendió). |
| RBAC: administrador, restaurante y analítica, y varios roles por usuario | Sí | Tabla completa en `docs/rbac.md`. `verify:auth`. |
| Administrador: crea usuarios y entra a todo | Sí | `/admin` → Usuarios. `verify:auth`. |
| Restaurante: solo su restaurante, modos sencillo y completo | Sí | Cabecera con sus restaurantes; otro restaurante → `/sin-acceso`. `verify:auth`. |
| Analítica: estadísticas de todos, vista completa o por restaurante | Sí | `/analiticas` con filtros por restaurante, marca y ciudad. `verify:auth`. |
| Autenticación con Better Auth | Sí | `/login`. `lib/auth/`. `verify:auth`. |
| Esquema completo de la base de datos y *seed* | Sí | `lib/db/schema.ts`, migraciones en `drizzle/`, `npm run db:seed` (solo desarrollo). |
| CI/CD: build y pruebas en cada push; despliegue al fusionar a `main` | Sí | GitHub Actions (typecheck, lint, build y los cuatro `verify`); Vercel despliega `main` al fusionar a esa rama, con el CI en verde. |
| Flujo de GitHub: ramas desde `testing`, PR, revisión y `testing` → `main` | Sí | Tabla «Ramas y PR» de este documento; protección de `main` y `testing`. |
| README y documentación | Sí | `README.md` y `docs/`. |
| **Zonas de meseros**: configuración por cantidad de meseros activa y cambio fácil entre configuraciones | Sí | Plano en vivo → «Meseros activos: [−] 3 [+]» (botones de 44 px que activan la configuración de esa cantidad o la crean con las mesas repartidas), «Editar zonas» (pincel, selección en grupo, reparto automático); editor → «Ver meseros». Llega a todas las tablets en vivo. Al sentar se ve quién atiende; estadísticas y asistente por mesero. README §18. `verify:editor`, `verify:realtime`, `verify:auth` y `verify:demo`. |
| **Plano por defecto en cada restaurante**, con la estructura actualizada por los usuarios de los restaurantes | Sí | Editor → «★ Por defecto» / «Marcar por defecto»; el editor y el plano en vivo abren esa zona. El rol restaurante edita (mover, añadir, borrar, girar, copiar y pegar) solo en los suyos; analítica no. README §19. `verify:editor` y `verify:auth`. |

Pedidos de la dirección además del enunciado: modo sencillo sin conexión
(README §11, «Modo sin conexión»), borrar un cliente con Aceptar/Cancelar y
deshacer, y el panel «Ver clientes» (antes «Ver todas las cartas») arrastrable.

## Ramas y PR

| PR | Rama | Estado |
|---|---|---|
| #1 | `testing` → `main` | Fusionado (proyecto inicial) |
| #2 | `feat/db-schema` → `main` | Cerrado sin fusionar: estaba obsoleto, todo el trabajo va por `testing`. |
| #3 | `fix/estilos-editor` | Fusionado |
| #4 | `docs/claude-md` (`CLAUDE.md`) | Fusionado |
| #5 | `feat/realtime-server` (tiempo real y conflictos) | Fusionado |
| #6 | `feat/quick-mode-statistics-ai` (Miembro B) | Fusionado |
| #7 | `feat/editor-visual` (radar, íconos, temas) | Fusionado, como *squash* |
| #8 | `feat/auth-rbac` (autenticación y roles) | Fusionado |
| #9 | `feat/quick-mode-live` (Miembro B) | Fusionado. Revisado y aprobado por el Miembro A. |
| #10 | `chore/ci` (Miembro B) | Fusionado. Revisado y aprobado por el Miembro A. |
| #11 | `feat/world-map` (mapa general y marcas) | Fusionado. Aprobado por el Miembro B. |
| #12 | `fix/verify-auth-flake` (404 intermitente de `verify:auth`) | Fusionado. Aprobado por el Miembro B. |
| #13 | `chore/deploy` (despliegue y `/api/health`, Miembro B) | Fusionado. Revisado y aprobado por el Miembro A. |
| #14 | `feat/layout-rotation` (giro guardado; barra, puerta y pared) | Fusionado. Aprobado por el Miembro B. |
| #15 | `chore/pre-release` (healthcheck en `verify:auth`, mejoras del CI, guía de despliegue y este documento) | Fusionado. Aprobado por el Miembro B. |
| #16 | `feat/analytics-brands` → `main` (Miembro B) | **Cerrado sin fusionar.** Iba a `main` por error; el mismo trabajo entró en `testing` por el #17. La rama no se borró. |
| #17 | `feat/analytics-brands` → `testing` (marcas y privacidad del asistente, Miembro B) | Fusionado **sin aprobación**: la única revisión, del Miembro A, pedía cambios. Se corrigió en el #19. |
| #18 | `docs/estado-final` (este documento) | Fusionado. Aprobado por el Miembro B. |
| #19 | `fix/assistant-privacy` (anonimización por palabra entera y singulares, Miembro B; corregido por el Miembro A) | Fusionado. Aprobado por el Miembro A. |
| #20 | `feat/seed-historial` (8 semanas de historial y un host por restaurante) | Fusionado. Aprobado por el Miembro B. |
| #21 | `fix/catalogo-produccion` (`db:catalog` en el Pre-deploy) | Fusionado. Aprobado por el Miembro B. |
| #22 | `fix/merge-main-env` (trae `main` a `testing` y resuelve `.env.example` sin valores) | Fusionado. Aprobado por el Miembro B. |
| #23 | `testing` → `main` (salida a producción) | Fusionado. Aprobado por el Miembro B. |
| #24 | `docs/produccion` (comandos de despliegue a mano) | Fusionado. Aprobado por el Miembro B. |
| #25 | `feat/db-restaurantes` (`npm run db:restaurantes`) | Fusionado. Aprobado por el Miembro B. |
| #26 | `docs/revision-sin-aprobacion` (0 aprobaciones y revisión propia) | Fusionado con revisión propia. |
| #27 | `test/rbac-enunciado` (RBAC contra el enunciado) | Fusionado con revisión propia. |
| #28 | `feat/mapa-honduras` (Honduras entero y ubicación real, migración `0004`) | Fusionado con revisión propia. |
| #29 | `fix/quick-mode-drag` (arrastre con ratón y lápiz, de Jose2508) | Fusionado con revisión propia. |
| #30 | `fix/reset-password` (`npm run reset-password`) | Fusionado con revisión propia. |
| #31 | `fix/redirect-interno` (error SSL de las redirecciones) | Fusionado con revisión propia. |
| #32 | `fix/admin-confirmar` (confirmar contraseña y desactivar en `/admin`) | Fusionado con revisión propia. |
| #33 | `testing` → `main` (segunda publicación) | Fusionado con revisión propia; desplegado. |
| #34 | `docs/estado-produccion-2` (estado tras la segunda publicación) | Fusionado con revisión propia. |
| #35 | `feat/admin-restaurantes` (marcas y restaurantes desde `/admin`, migración `0005`) | Fusionado con revisión propia. |
| #36 | `feat/varios-restaurantes` (selector de restaurante y tarjetas en `/inicio`) | Fusionado con revisión propia. |
| #37 | `feat/accesos-por-marca` (accesos por marca, «marcar todos» y buscador) | Fusionado con revisión propia. |
| #38 | `docs/piloto-dennys-pizzahut` (piloto con Denny's y Pizza Hut) | Fusionado con revisión propia. |
| #39 | `testing` → `main` (tercera publicación: marcas y restaurantes desde `/admin` y el piloto) | Fusionado con revisión propia; desplegado. |
| #40 | `feat/cartas-baraja` (formulario al tocar, abanico, «Ver todas las cartas» y agregar varios; migración `0006`) | Fusionado con revisión propia. |
| #41 | `perf/mapa` (mapa general a 60 fps) | Fusionado con revisión propia. |
| #42 | `feat/create-user` (`npm run create-user` y el piloto con un usuario por marca) | Fusionado con revisión propia. |
| #43 | `testing` → `main` (cuarta publicación: #40, #41 y #42, migración `0006`) | Fusionado con revisión propia; desplegado el 1 de octubre. |
| #44 | `docs/estado-produccion-4` (estado tras la cuarta publicación) | Fusionado con revisión propia. |
| #45 | `feat/datos-demo` (datos de demostración, migración `0007`) | Fusionado con revisión propia. |
| #46 | `testing` → `main` (quinta publicación: datos de demostración) | Fusionado con revisión propia; desplegado el 1 de octubre. |
| #47 | `feat/modo-sencillo-movil` (borrar cliente desde el modo rápido) | Fusionado con revisión propia. |
| #48 | `fix/borrar-cliente-confirmar` (Aceptar/Cancelar y prueba entre restaurantes) | Fusionado con revisión propia. |
| #49 | `feat/panel-arrastrable` («Ver todas las cartas» arrastrable) | Fusionado con revisión propia. |
| #50 | `feat/modo-offline` (modo sencillo sin conexión, migración `0008`) | Fusionado con revisión propia. |
| #51 | `feat/demo-web` (borrado demo por restaurante y etiqueta «Demo») | Fusionado con revisión propia. |
| — | `feat/zonas-meseros` (zonas de meseros y plano por defecto, migración `0009`) | En revisión hacia `testing`. |

### Protección de `main` y `testing`

Desde el 30 de septiembre, las dos ramas tienen en GitHub el *ruleset*
`proteger-main-testing`, activo y **sin bypass para nadie**, ni siquiera para
los administradores del repositorio:

- **Solo se entra por PR.** Desde el 30 de septiembre, con el Miembro B ya
  fuera del proyecto, el PR pide **0 aprobaciones** (antes pedía 1).
- **El CI tiene que estar en verde.** El check obligatorio es el job
  «Typecheck, lint, build y verificaciones» de `.github/workflows/ci.yml`.
- **No se puede borrar la rama ni hacer *force push*.**

**Cómo se revisa ahora cada PR** (también en `CLAUDE.md`):

1. Sin revisor asignado: ya no se pide la revisión de `vbgjptt89g-beep`.
2. Quien abre el PR hace una revisión de código (bugs, seguridad, secretos y
   cumplimiento del enunciado) y la deja como comentario en el PR.
3. Se corren `typecheck`, `lint`, `build` y los cuatro `verify`.
4. Se fusiona con merge normal solo con el CI en verde y sin problemas
   abiertos en la revisión.
5. Los PR hacia `main` esperan el «sí» explícito de Carlos (Miembro A).

Reglas del equipo: nunca se trabaja ni se hace push en `main`; las ramas salen
de `testing` y los PR van hacia `testing`; commits con prefijo (`feat`, `fix`,
`docs`, `chore`, `test`, `perf`); y nunca se suben `.env.local`, `local.db` ni
claves.
