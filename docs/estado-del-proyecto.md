# Estado del proyecto

_Actualizado el 5 de octubre de 2026._

**Table Waitlist:** listas de espera en tiempo real para los restaurantes de
Grupo Comidas.
- Stack: Next.js 16, React 19, Drizzle y Turso, Better Auth, Socket.IO y
  TypeScript.
- Equipo: Miembro A (editor, tiempo real, conflictos y auth) y Miembro B (modo
  rápido, estadísticas e IA).

## En producción

Desde el 30 de septiembre de 2026 hay una versión publicada en Railway. La
última es `main` = `675c687` (PR #43), desplegada el 1 de octubre (despliegue
`f9e13d63`): cartas del modo rápido como baraja y agregar varios (#40), mapa a
60 fps (#41) y `npm run create-user` (#42).

- **Dominio:** https://trabajo-en-equipo-mesasgc-production.up.railway.app
- **Railway:** proyecto `noble-energy`, servicio `Trabajo-en-equipo-mesasgc`,
  región US East, rama `main` con **Wait for CI**.
- **Base:** Turso `mesasgc-prod`, nueva, en la cuenta del Miembro A
  (`aws-us-east-1`). Tiene las 7 migraciones (hasta la `0006`, con
  `resolved_at` y `resolved_by_user_id`; comprobado con una consulta de solo
  lectura), las 12 tablas y el catálogo de 8 tipos. **Sin datos de
  ejemplo:** el seed no se corre en producción, y el lote de datos de
  demostración (#45) todavía no se ha cargado: entra la migración `0007`
  (`is_demo` y `demo_batch_id`) con el próximo despliegue.
- **Restaurantes:** cargados con `railway run npm run db:restaurantes`: las
  4 marcas, los 8 restaurantes con su latitud y longitud, y una zona vacía
  «Comedor principal» en cada uno (sin mesas ni clientes todavía).
- **Usuarios:** el admin (`admin@grupocomidas.test`) y
  `analitica@grupocomidas.test`. Los del piloto, `dennys@` y `pizzahut@`,
  los crea Carlos con `railway run npm run create-user` (comandos en
  `docs/salida-a-produccion.md`, sección 3.1). Si se pierde el acceso:
  `railway run npm run reset-password` (ver `docs/despliegue.md`, sección 3).
- **Variables:** `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
  `BETTER_AUTH_SECRET` (nuevo, de 48 bytes), `BETTER_AUTH_URL`,
  `OPENROUTER_API_KEY` (con límite de gasto) y `OPENROUTER_MODEL`. Ningún
  valor está en el repositorio.
- **Comandos:** se escriben a mano en Railway, porque los servicios nuevos
  ya no leen `railway.json` (ver `docs/despliegue.md`, sección 1).
- **Comprobado en el despliegue del #43 (1 de octubre):**
  - en el log salen «migrations applied successfully!» (con la `0006`),
    «catálogo de elementos: 8 tipos listos» y «Healthcheck succeeded!», y
    ningún error de la app;
  - `/api/health` responde `{"ok":true}` y `/login`, 200;
  - sin sesión, `/mapa` y el modo rápido redirigen a `/login?next=…`, y
    `/api/restaurante/[id]/cartas` responde 401.
- **Comprobado en el despliegue del #33:**
  - en el log salen «migrations applied successfully!», «catálogo de
    elementos: 8 tipos listos» y «Healthcheck succeeded!»;
  - ya no aparece el error «failed to get redirect response … SSL wrong
    version number» (#31);
  - `/api/health` responde `{"ok":true}` y `/login` carga;
  - sin sesión, las páginas protegidas redirigen a `/login?next=…` y las
    API responden 401.

## Lo que ya está hecho

Todo esto está en `testing`. En `main` está todo hasta el #43; la última fila
(datos de demostración, #45) llega con el siguiente `testing` → `main`.

| Área | Qué hay | Dónde está | PR |
|---|---|---|---|
| Esquema y seed | Restaurantes, marcas, zonas, elementos, lista de espera y catálogo de 8 tipos. Seed idempotente (solo desarrollo; con `NODE_ENV=production` se niega a correr): 8 restaurantes, 11 usuarios de prueba (un host por restaurante) y 8 semanas de historial (~12 000 grupos) para las estadísticas. | `lib/db/`, `scripts/seed.ts`, README §15 | varios, #20 |
| Catálogo en producción | `npm run db:catalog` carga los 8 tipos de elemento sin tocar nada más. Va en el Pre-deploy. | `lib/layout/catalog.ts`, `scripts/db-catalog.mts` | #21 |
| Editor de mesas | Plano con Konva para tablet: arrastrar, redimensionar, girar elementos, deshacer y copiar a otro restaurante. | `components/editor/`, README §8–9, §12 | #3, #7 |
| Giro guardado y estructura | El giro del plano completo se guarda (`table_layouts.rotation`), se avisa en vivo, se copia y lo respetan el plano en vivo y el minimapa. Tipos barra, puerta y pared. | `components/editor/`, `lib/layout/`, README §12 | #14 |
| Tiempo real | Next y Socket.IO en un solo servidor (`server.ts`), con una room por restaurante y la sala `overview` del mapa. | `lib/realtime/`, README §10, §16 | #5, #11 |
| Conflictos | Asignación de mesa con bloqueo optimista: gana el primero y el otro recibe «Esta mesa ya fue asignada». | `lib/tables/assign.ts` | #5 |
| Autenticación y roles | Better Auth con correo y contraseña. Roles admin, restaurante y analitica. `/login`, `/inicio`, `/admin`, `/sin-acceso`, y encabezado con sesión y favicon. | `lib/auth/`, `proxy.ts`, README §14–15, `docs/rbac.md` | #8 |
| Modo rápido (Miembro B) | En vivo por Socket.IO (`waitlist:add`, `waitlist:resolve` y `waitlist:undo`, con `canModifyWaitlist`), tarjetas tipo Tinder con `motion` y Deshacer (botón y Ctrl+Z). | `components/quick-mode/`, `lib/waitlist/`, README §11 | #9 |
| Estadísticas e IA (Miembro B) | Últimos 14 días en hora de Honduras, «tiempo hasta avisar» con `called_at`, top 10 de clientes y asistente. | `components/analytics/`, `lib/analytics/`, `app/api/` | #9 |
| Marcas en estadísticas y privacidad del asistente (Miembro B) | Filtros por marca real (`restaurants.brand_id`) y por ciudad. El top de clientes viaja a OpenRouter con alias («Cliente 1»…) y sin teléfonos ni notas; los nombres se restauran solo en pantalla. La anonimización busca los datos sensibles sobre el texto original y solo como palabra entera: conserva fechas, días, cantidades, restaurantes y marcas. | `lib/analytics/`, README | #17, #19 |
| Mapa general y marcas | Tabla `brands` (4 marcas). `/mapa`, en estilo radar, con **todo Honduras**: silueta real, 18 departamentos, vecinos, Islas de la Bahía, Golfo de Fonseca y 11 ciudades principales (Natural Earth, dominio público, dentro del repo). Restaurantes en su ubicación real (`latitude`/`longitude`, migración `0004`). Rueda, pellizco, arrastre, botones «Ver todo Honduras» / Tegucigalpa / San Pedro Sula, minimapa y grupos por ciudad vistos de lejos. En vivo (solo contadores), con filtros, lista por espera y zoom al plano. `/restaurante/[id]/mapa` para el host. Analitica no ve nombres. | `lib/map/`, `components/map/`, README §16, `docs/mapa-honduras.md`, `docs/rbac.md` | #11, #28 |
| Marcas y restaurantes desde /admin | Crear, editar y desactivar marcas (nombre y color) y restaurantes (nombre, marca, ciudad, latitud y longitud, o una ciudad del mapa). Un restaurante nuevo nace con una zona vacía y sale de inmediato en el mapa, las estadísticas y los accesos. Desactivar no borra nada (migración `0005`, `active`): sale de la operación, pero conserva su historial y sus asignaciones. Permiso `catalogo:gestionar` (solo admin). | `lib/layout/catalog-admin.ts`, `app/admin/catalog-actions.ts`, `components/admin/admin-catalog.tsx`, README §16 | #35 |
| Usuarios desde la terminal | `npm run create-user`: crea o actualiza un usuario por argumentos (correo, nombre, roles, restaurantes por slug o por marca), con la contraseña dos veces oculta en la terminal y confirmación «si»; si existe, no toca la contraseña. Mismas validaciones que `/admin`. Piloto con 2 usuarios (`dennys@` y `pizzahut@`). | `scripts/create-user.mts`, `lib/auth/user-upsert.ts`, README §15 | #42 |
| Un usuario para varios restaurantes | Selector de restaurante en la cabecera (color e inicial de la marca) que lleva al mismo modo, y `/inicio` con una tarjeta por restaurante (cuántos esperan y espera media, se refresca sola). Al cambiar, el socket sale de la room anterior y entra en la nueva. En `/admin`, restaurantes agrupados por marca, con «Marcar todos» y buscador. | `components/layout/restaurant-switcher.tsx`, `app/inicio/page.tsx`, `components/admin/admin-users.tsx` | #36, #37 |
| Cartas del modo rápido | Montón a todo el ancho. Tocar la carta (o «+ Agregar cliente») abre el formulario en un panel que sube desde abajo o en ventana; tocar una esquina abre la fila en abanico (hasta 7 y «+N»). Pestaña **Varios** para agregar hasta 30 de una vez (filas o «Pegar lista»), todos o ninguno, con deshacer en grupo. «Ver todas las cartas» (hoy o 7 días, filtros y buscador) con volver a la espera. Migración `0006` (`resolved_at`, `resolved_by_user_id`). | `components/quick-mode/`, `lib/waitlist/`, `app/api/restaurante/[id]/cartas`, README §11, `docs/salida-a-produccion.md` §4 | #40 |
| Mapa más rápido | Cámara por `transform` CSS durante el gesto (sin React) y confirmada al soltar; base memoizada; radar y halos animados por el compositor; controles sin `backdrop-blur`. Arrastre 24 → 60 fps y rueda 15 → 60 en computadora; 11 → 54 y 13 → 47 en tablet (CPU 4×). | `components/map/world-map.tsx`, `docs/mapa-honduras.md` | #41 |
| Aspecto | Estilo de mapa «radar», minimapa, íconos de lucide y temas Claro, Oscuro, Sistema y Personalizado, sin parpadeo. | `lib/theme/`, `/ajustes`, README §13 | #7 |
| CI | GitHub Actions en cada PR y cada push a `testing` y `main`: typecheck, lint, build y los cuatro `verify`, con Node 22 y `npm ci`. | `.github/workflows/ci.yml` | #10 |
| Datos de demostración | Lote de datos falsos para probar el mapa, las estadísticas y el asistente: `npm run db:demo` (idempotente) en los 8 restaurantes reales, con una zona demo propia por restaurante, clientes esperando con teléfonos de mentira, mesas demo ocupadas y reservadas y 8 semanas de historial. Marcado estructural con `is_demo` y `demo_batch_id` (migración `0007`, solo aditiva), nunca por nombre. Se borra con `npm run db:demo:borrar` (`borrarDemoData()`). Desde el 5 de octubre, sin interfaz: se quitaron el aviso, el enlace, la sección de `/admin` y `/admin/datos-demo`; queda la etiqueta «Demo» en las cartas. | `lib/demo/`, `scripts/db-demo*.mts`, README §17 | #45, #51 |
| Despliegue | Comandos de Railway (build, Pre-deploy `db:migrate && db:catalog`, start y healthcheck), `/api/health` público y guía paso a paso. `railway.json` queda como referencia. | `docs/despliegue.md`, `railway.json` | #13, #21 |
| Del 2 de octubre (#47–#51) | Borrar un cliente desde el modo sencillo con Aceptar/Cancelar y deshacer (#47, #48); panel «Ver todas las cartas» arrastrable y sin X (#49); modo sencillo sin conexión con cola en IndexedDB, `operationId` y conflictos (#50, migración `0008`); borrado de datos demo por restaurante y etiqueta «Demo» (#51). | `components/quick-mode/`, `lib/offline/`, `public/sw.js`, `lib/demo/` | #47–#51 |
| Zonas de meseros y plano por defecto | Configuraciones por cantidad de meseros con una activa, selector «Meseros activos», reparto por toque, rectángulo o automático, mesero al sentar, estadísticas y asistente por mesero (migración `0009`, solo aditiva). Plano por defecto elegido desde el editor; copiar y pegar elementos. | `lib/waiters/`, `components/waiters/`, `lib/layout/default.ts`, README §18–19 | `feat/zonas-meseros` |
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
| Socket.IO con una *room* por restaurante | Sí | Cada restaurante oye solo lo suyo; la sala `overview` lleva solo contadores. `verify:realtime` y `verify:auth`. |
| Conflictos: bloqueo optimista, el primero gana y al segundo «Esta mesa ya fue asignada» | Sí | Dos tablets sentando en la misma mesa. `lib/tables/assign.ts`; `verify:realtime` (también con la cola sin conexión). |
| Modo rápido de *check-in*/*check-out* con tarjetas deslizables (listo / ausente) | Sí | Modo sencillo: deslizar la carta o los botones; «Ver todas las cartas». README §11. |
| Historial de acciones con Deshacer (Ctrl+Z) | Sí | Botón Deshacer y Ctrl+Z en el modo sencillo y en el editor. `verify:realtime`. |
| Estadísticas: espera promedio, día más rápido y más lento, top de clientes | Sí | `/analiticas`. `verify:auth` (por rol y con filtros). |
| Asistente de IA en lenguaje natural sobre las estadísticas | Sí | `/analiticas` → «Pregunta sobre tu servicio». Con OpenRouter y respuestas locales sin clave; nombres con alias. `verify:auth`. |
| Resumen automático de estadísticas | Sí | `/analiticas` → «Resumen de 14 días» (variación, día más lento, mesero que más atendió). |
| RBAC: administrador, restaurante y analítica, y varios roles por usuario | Sí | Tabla completa en `docs/rbac.md`. `verify:auth`. |
| Administrador: crea usuarios y entra a todo | Sí | `/admin` → Usuarios. `verify:auth`. |
| Restaurante: solo su restaurante, modos sencillo y completo | Sí | Cabecera con sus restaurantes; otro restaurante → `/sin-acceso`. `verify:auth`. |
| Analítica: estadísticas de todos, vista completa o por restaurante | Sí | `/analiticas` con filtros por restaurante, marca y ciudad. `verify:auth`. |
| Autenticación con Better Auth | Sí | `/login`. `lib/auth/`. `verify:auth`. |
| Esquema completo de la base de datos y *seed* | Sí | `lib/db/schema.ts`, migraciones en `drizzle/`, `npm run db:seed` (solo desarrollo). |
| CI/CD: build y pruebas en cada push; despliegue al fusionar a `main` | Sí | GitHub Actions (typecheck, lint, build y los cuatro `verify`); Railway despliega `main` con «Wait for CI». |
| Flujo de GitHub: ramas desde `testing`, PR, revisión y `testing` → `main` | Sí | Tabla «Ramas y PR» de este documento; protección de `main` y `testing`. |
| README y documentación | Sí | `README.md` y `docs/`. |
| **Zonas de meseros**: configuración por cantidad de meseros activa y cambio fácil entre configuraciones | Sí | Plano en vivo → «Meseros activos: 2 \| 3 \| 4», «Editar zonas» (pincel, selección en grupo, reparto automático); editor → «Ver meseros». Llega a todas las tablets en vivo. Al sentar se ve quién atiende; estadísticas y asistente por mesero. README §18. `verify:editor`, `verify:realtime`, `verify:auth` y `verify:demo`. |
| **Plano por defecto en cada restaurante**, con la estructura actualizada por los usuarios de los restaurantes | Sí | Editor → «★ Por defecto» / «Marcar por defecto»; el editor y el plano en vivo abren esa zona. El rol restaurante edita (mover, añadir, borrar, girar, copiar y pegar) solo en los suyos; analítica no. README §19. `verify:editor` y `verify:auth`. |

Pedidos de la dirección además del enunciado: modo sencillo sin conexión
(README §11, «Modo sin conexión»), borrar un cliente con Aceptar/Cancelar y
deshacer, y el panel «Ver todas las cartas» arrastrable.

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
| #13 | `chore/deploy` (Railway y `/api/health`, Miembro B) | Fusionado. Revisado y aprobado por el Miembro A. |
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
| #24 | `docs/produccion-railway` (comandos de Railway a mano) | Fusionado. Aprobado por el Miembro B. |
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

## Decisiones que tomamos

- **El giro es de la zona, no del usuario.** `table_layouts.rotation` (0, 90, 180
  o 270; migración `0003`, solo aditiva) se guarda con el guardado normal y
  lo ve igual todo el mundo. Si viene sin `rotation`, el guardado conserva el
  que había, para no romper a quien guarde con un payload viejo.
- **Barra, puerta y pared no admiten clientes.** Son estructura del local: el
  modo rápido y los contadores del mapa solo cuentan mesas.

- **Roles y restaurantes en tablas propias.** `user_roles` y `user_restaurants`
  (migración `0001_auth_rbac.sql`, generada con `drizzle-kit generate`) permiten
  varios roles y varios restaurantes por usuario. La migración es **solo
  aditiva**: las columnas `user.role` y `user.restaurant_id` quedan en la base,
  marcadas como obsoletas en `schema.ts`, y el código ya no las usa.
- **`called_at` ya existía.** `waitlist_entries.called_at` (opcional) estaba en
  el esquema desde el principio, y el modo rápido la rellena al marcar «listo».
  No hizo falta tocar esa tabla.
- **«Listo» en lugar de «sentado» en el modo rápido.** Sentar se hace siempre
  con mesa, por `assignTable`. Mientras no se integre, las estadísticas solo
  cuentan a los sentados con mesa.
- **`/sin-acceso` en lugar de `forbidden()`.** El `forbidden()` de Next 16 es
  experimental. Sin permiso, las páginas redirigen a `/sin-acceso` y las API
  responden 403.
- **El proxy no es la seguridad.** `proxy.ts` (el antiguo `middleware.ts`) solo
  mira si hay cookie. La comprobación de verdad está en `lib/auth/session.ts`,
  dentro de cada página, server action, API route y evento de socket, como
  recomienda la guía de Next 16.
- **Un solo archivo de permisos.** Todas las reglas están en
  `lib/auth/rbac.ts` (`can(usuario, acción, restaurantId)`). La tabla legible
  está en `docs/rbac.md`.
- **El demo va en zonas propias, no en la zona real.** Cada restaurante recibe
  una zona de demostración **nueva y marcada**, en lugar de dibujar el demo
  encima de «Comedor principal». Así el plano real (y el que alguien haya
  dibujado a mano) queda intacto y no se lee, y borrar el demo es reversible:
  se va la zona demo y queda todo lo demás.
- **El demo se marca con columnas, no con nombres.** `is_demo` y `demo_batch_id`
  (migración `0007`, solo aditiva, con tres índices) en `table_layouts`, `tables`
  y `waitlist_entries`. Nada en `brands`, `restaurants`, `element_types` ni en las
  tablas de Better Auth. El borrado usa esas columnas, así que renombrar no
  cambia nada, y **aborta** si un dato real depende de algo demo (por ejemplo
  un cliente real asignado a una mesa demo: `assigned_table_id` es
  `ON DELETE SET NULL` y lo desasignaría en silencio).
- **`demo:ver` para los tres roles, `demo:borrar` solo para admin.** Quien está
  mirando el mapa o las estadísticas tiene derecho a saber si los números son
  reales; borrarlos es la única operación de la app que elimina filas, y es
  global, así que no se delega. Está en `lib/auth/rbac.ts`, no en un sistema de
  permisos aparte.
- **Un solo servicio de borrado.** `borrarDemoData()` (`lib/demo/delete.ts`) lo
  usan la web y `npm run db:demo:borrar`: el script es el plan B, no una segunda
  implementación.
- **El gerente ve las estadísticas de todos.** Los permisos de los roles se
  suman: «restaurante + analitica» edita solo `rest_centro`, pero su rol
  analítica le da las estadísticas de **todos** los restaurantes. Si se quiere
  que solo vea las suyas, hay que cambiar la regla en `rbac.ts` y filtrar
  `/api/analiticas`.
- **Límite del asistente por usuario**, no por IP: la cabecera
  `X-Forwarded-For` la manda el cliente y se podía falsear.
- **No hay registro público.** Los usuarios los crea un admin en `/admin`, o
  `npm run create-admin` en producción. Los 5 usuarios de prueba (contraseña
  `12345abc`) solo se crean en desarrollo.
- **Logos.** Están en `public/brand/`:
  - el circular completo, en `/login` (160 px);
  - el circular solo nombre, en el encabezado (36 px) y en el ícono de la
    pestaña (`app/icon` y `app/apple-icon`);
  - el rectangular, guardado por si hace falta.

  Se muestran con `next/image` y siempre redondos. El encabezado conserva el
  logotipo de texto «Table**Waitlist**» del Miembro B.
- **Temas.**
  - Todos los colores salen de `lib/theme/theme.ts`, que genera las variables
    CSS de Tailwind y el objeto que usa Konva.
  - La elección se guarda en el navegador (localStorage) y se aplica antes del
    primer pintado.
  - Los colores de estado se ajustan solos al fondo.
  - Restablecer solo devuelve los colores de fábrica de Personalizado.
- **Un solo servidor y un solo puerto** para Next y Socket.IO (`server.ts`),
  porque Railway expone un único `PORT`.
- **Marcas en su propia tabla.** `brands` (`id`, `name`, `accent_color`) y,
  en `restaurants`, `brand_id`, `city`, `map_x` y `map_y`, todas opcionales
  (migración `0002_brands_world_map.sql`, solo aditiva). `brand_id` es la
  columna para filtrar las estadísticas por marca.
- **El mapa general solo recibe contadores.** Por la sala `overview` viajan
  números por restaurante, nunca nombres ni ids de clientes. Así la pueden
  ver admin y analitica.
- **Analitica no ve nombres en el plano en vivo.** Los quita el servidor (el
  id del cliente se cambia por `"oculto"`). Nuevo permiso `plano:clientes`,
  solo para admin y el propio restaurante.
- **CI sin secretos.** El workflow usa valores falsos y una SQLite temporal;
  no necesita credenciales de Turso ni de OpenRouter. Tiene
  `permissions: contents: read`, cancela las ejecuciones viejas del mismo PR
  y corta a los 20 minutos.
- **Producción en una base nueva.** La base de Turso de producción es nueva y
  vacía, y Railway le aplica las migraciones desde cero con `db:migrate`
  antes de cada despliegue. Nunca se usa la base de desarrollo, creada con
  `db:push`, ni se corre el seed.
- **`/api/health` es la única API pública.** Es una excepción exacta en
  `proxy.ts`: `/api/healthz` o `/api/health/x` siguen pidiendo sesión.
- **Destino después del login.** Con un solo rol se entra directo: admin a
  `/mapa`, analitica a `/analiticas` y un host con un restaurante a su modo
  rápido. Con varios roles distintos (el gerente), se elige en `/inicio`.

## Lo que falta

### Producción (ver `docs/despliegue.md`)

Hecho el 30 de septiembre:

- [x] Base nueva y vacía `mesasgc-prod` en Turso, con su token.
- [x] Variables en Railway, con un `BETTER_AUTH_SECRET` nuevo, y límite de
      gasto en OpenRouter.
- [x] Comandos escritos a mano en Railway. En el log salen «migrations
      applied successfully!» y «catálogo de elementos: 8 tipos listos».
      `drizzle-kit` se instala bien desde `devDependencies`.

Pendiente:

- [x] Crear el **primer admin real** con `railway run npm run create-admin`
      (ver `docs/despliegue.md`, sección 3). Lo creó Carlos y entró bien.
- [x] **Cargar los restaurantes y las marcas reales** con
      `railway run npm run db:restaurantes`. Hecho el 30 de septiembre: 4
      marcas, 8 restaurantes y 8 zonas vacías. (ver `docs/despliegue.md`,
      sección 3b). La app no tiene pantalla para crear restaurantes, marcas
      ni zonas, y el seed no corre en producción. El script crea las 4
      marcas, los 8 restaurantes y una zona vacía por restaurante, sin
      mesas, clientes ni usuarios. Es idempotente y no pisa nada que ya
      exista.
- [ ] Probar a restaurar un respaldo de Turso en una base aparte.
- [ ] **Cargar los datos de demostración en producción** y borrarlos, con
      `railway run npm run db:demo` y `railway run npm run db:demo:borrar` (`docs/despliegue.md`,
      sección 3c). Solo después de comprobar que el despliegue publicado está
      bien (log con migraciones, catálogo y healthcheck) y con consultas de solo
      lectura antes. **No** se carga automáticamente: no está en el Pre-deploy.
- [ ] **Migrar la configuración de Railway a Infrastructure as Code**
      (`.railway/railway.ts`). Hoy los comandos están escritos a mano en
      Railway, y `railway.json` solo sirve de referencia.
- [ ] Investigar el 404 intermitente de las rutas `/api` justo después de
      compilar (en `npm run dev` y en `verify:auth`).

**Decisiones de la dirección** (ver `docs/salida-a-produccion.md`)

- [ ] **¿Se activa el asistente con OpenRouter?** Desde el #17 los nombres
      del top de clientes viajan como alias («Cliente 1»…), sin teléfonos ni
      notas, pero las estadísticas sí salen a un servicio externo. Sin
      `OPENROUTER_API_KEY`, el asistente solo responde las preguntas básicas.
- [ ] **¿Puede analitica ver el top 10 de clientes con nombres** en
      `/analiticas`? Si no, se quita o se muestra anónimo.
- [ ] **¿Cuánto tiempo se guarda el historial de clientes** antes de
      borrarlo?

**Piloto con Denny's y Pizza Hut** (ver `docs/salida-a-produccion.md`, sección 3)

La empresa decidió que el piloto sea con los **4 restaurantes de Denny's y
Pizza Hut** (Denny's Las Lomas, Denny's Los Andes, Pizza Hut Los Próceres y
Pizza Hut Norte), con **dos usuarios, uno por marca** (desde el 1 de octubre;
antes era uno solo para los 4). China Wok y KFC siguen en el sistema (mapa,
estadísticas y datos) y entran después.

- [ ] Crear en producción **«Denny's»** (`dennys@grupocomidas.test`, sus 2
      locales) y **«Pizza Hut»** (`pizzahut@grupocomidas.test`, sus 2
      locales) con `railway run npm run create-user` (lo corre Carlos: la
      contraseña se escribe en su terminal) o desde `/admin`. Comandos en
      `docs/salida-a-produccion.md`, sección 3.1.
- [ ] Dibujar en el editor (modo completo) el plano real de cada uno de los
      4 locales, sobre su zona vacía.
- [ ] Probar con la mano en la tablet: deslizar con dedo, ratón y lápiz, y
      Ctrl+Z (#29). El navegador de las pruebas automáticas no pintaba.
- [ ] Una semana completa, de lunes a domingo, con los encargados dando
      comentarios. Se miden la espera promedio y el uso frente al papel.
- [ ] Al terminar: un usuario por host y cambiar la contraseña de los
      usuarios compartidos.

**Antes de presentar**

- [ ] Hacer la demo de `docs/demo.md` de principio a fin sobre `testing`, con
      dos pestañas para el tiempo real.
- [ ] En la misma demo, enseñar el lote de datos de demostración: cargar con
      `npm run db:demo` para que las estadísticas tengan historia, enseñar la
      etiqueta «Demo» de las cartas y borrarlo con `npm run db:demo:borrar`.
- [ ] El asistente sin `OPENROUTER_API_KEY` no entiende «¿qué semana fue más
      lenta?» (responde el mensaje genérico); con la clave sí la contesta.
      Si se quiere sin clave, hay que añadirla a `localAnswer` (Miembro B).
- [x] **Arreglo del modo rápido que quedó fuera** (#29): el commit `4701330` de la
      rama `feat/quick-mode-live` («permitir arrastre con mouse y lápiz») se
      subió después de fusionar el #9. Ya está en `testing` y `main`; falta
      probarlo con la mano en la tablet (el navegador de las pruebas no pintaba).

### Más adelante

  que no se ve (Miembro B).
- **Pasar al tema el modo rápido y las estadísticas** (Miembro B).
- **Guardar el tema por usuario** en la base de datos: hoy vive en el
  navegador.
- **Varias zonas desde `/admin`.** Hoy cada restaurante nuevo nace con una
  zona, «Comedor principal»; para una terraza o un segundo piso hay que
  copiar el plano de otro restaurante (el editor lo permite) o pedirlo al
  equipo.
- **Logos de las marcas.** Hoy cada marca se distingue por su color y su
  inicial.
- **Que cada usuario cambie su propia contraseña.** El admin ya cambia la suya
  y restablece la de cualquiera desde `/admin` (botón «Contraseña», que
  además cierra las sesiones abiertas). Lo que falta es que un host o una
  analista la cambien sin pedírselo al admin.
- **Que alguna pantalla ponga mesas en «reservada».** El estado existe en el
  esquema y el lote de demostración lo usa, pero no hay ninguna acción ni
  pantalla que lo ponga: hoy una mesa pasa de libre a ocupada y ya.
- **Más de un servidor.** El Deshacer del modo rápido y las salas de Socket.IO
  viven en la memoria del proceso: basta para 8 restaurantes en un solo
  servidor, pero para varios servidores haría falta, por ejemplo, Redis.
