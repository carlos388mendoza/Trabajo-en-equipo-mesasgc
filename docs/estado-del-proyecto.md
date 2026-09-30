# Estado del proyecto

_Actualizado el 30 de septiembre de 2026._

**Table Waitlist:** listas de espera en tiempo real para los restaurantes de
Grupo Comidas.
- Stack: Next.js 16, React 19, Drizzle y Turso, Better Auth, Socket.IO y
  TypeScript.
- Equipo: Miembro A (editor, tiempo real, conflictos y auth) y Miembro B (modo
  rápido, estadísticas e IA).

## En producción

Desde el 30 de septiembre de 2026 hay una versión publicada en Railway. La
última es `main` = `df550bd` (PR #33), desplegada el 30 de septiembre:

- **Dominio:** https://trabajo-en-equipo-mesasgc-production.up.railway.app
- **Railway:** proyecto `noble-energy`, servicio `Trabajo-en-equipo-mesasgc`,
  región US East, rama `main` con **Wait for CI**.
- **Base:** Turso `mesasgc-prod`, nueva, en la cuenta del Miembro A
  (`aws-us-east-1`). Tiene las 5 migraciones (hasta la `0004`, con latitud
  y longitud), las 12 tablas y el catálogo de 8 tipos. **Sin datos de
  ejemplo:** el seed no se corre en producción.
- **Restaurantes:** cargados con `railway run npm run db:restaurantes`: las
  4 marcas, los 8 restaurantes con su latitud y longitud, y una zona vacía
  «Comedor principal» en cada uno (sin mesas ni clientes todavía).
- **Usuarios:** el admin (`admin@grupocomidas.test`) y
  `analitica@grupocomidas.test`. Si se pierde el acceso:
  `railway run npm run reset-password` (ver `docs/despliegue.md`, sección 3).
- **Variables:** `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
  `BETTER_AUTH_SECRET` (nuevo, de 48 bytes), `BETTER_AUTH_URL`,
  `OPENROUTER_API_KEY` (con límite de gasto) y `OPENROUTER_MODEL`. Ningún
  valor está en el repositorio.
- **Comandos:** se escriben a mano en Railway, porque los servicios nuevos
  ya no leen `railway.json` (ver `docs/despliegue.md`, sección 1).
- **Comprobado en el despliegue del #33:**
  - en el log salen «migrations applied successfully!», «catálogo de
    elementos: 8 tipos listos» y «Healthcheck succeeded!»;
  - ya no aparece el error «failed to get redirect response … SSL wrong
    version number» (#31);
  - `/api/health` responde `{"ok":true}` y `/login` carga;
  - sin sesión, las páginas protegidas redirigen a `/login?next=…` y las
    API responden 401.

## Lo que ya está hecho

Todo esto está en `testing` y en `main`.

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
| Mapa general y marcas | Tabla `brands` (4 marcas). `/mapa`, en estilo radar, con **todo Honduras**: silueta real, 18 departamentos, vecinos, Islas de la Bahía, Golfo de Fonseca y 11 ciudades principales (Natural Earth, dominio público, dentro del repo). Restaurantes en su ubicación real (`latitude`/`longitude`, migración `0004`). Rueda, pellizco, arrastre, botones «Ver todo Honduras» / Tegucigalpa / San Pedro Sula, minimapa y grupos por ciudad vistos de lejos. En vivo (solo contadores), con filtros, lista por espera y zoom al plano. `/restaurante/[id]/mapa` para el host. Analitica no ve nombres. | `lib/map/`, `components/map/`, README §16, `docs/mapa-honduras.md`, `docs/rbac.md` | #11, este PR |
| Aspecto | Estilo de mapa «radar», minimapa, íconos de lucide y temas Claro, Oscuro, Sistema y Personalizado, sin parpadeo. | `lib/theme/`, `/ajustes`, README §13 | #7 |
| CI | GitHub Actions en cada PR y cada push a `testing` y `main`: typecheck, lint, build y los tres `verify`, con Node 22 y `npm ci`. | `.github/workflows/ci.yml` | #10 |
| Despliegue | Comandos de Railway (build, Pre-deploy `db:migrate && db:catalog`, start y healthcheck), `/api/health` público y guía paso a paso. `railway.json` queda como referencia. | `docs/despliegue.md`, `railway.json` | #13, #21 |
| Documentos | Guion de la demo y plan de salida a producción para la dirección. | `docs/demo.md`, `docs/salida-a-produccion.md` | #14 |

Las verificaciones automáticas no usan ningún *runner* de tests: son scripts
contra una base temporal. Estado en `testing` y `main` (`e1471ed`/`811e754`,
mismo árbol) el 30 de septiembre:

| Comando | Resultado |
|---|---|
| `npm run verify:editor` | 107/107 (incluye el catálogo de `db:catalog`) |
| `npm run verify:realtime` | 113/113 |
| `npm run verify:auth` | 148/148 (levanta la app real; incluye el healthcheck, la privacidad del asistente y el bloqueo del seed en producción). Falló una vez con un 404 intermitente en las rutas `/api` justo después de `build`, y pasó al repetirlo. |
| `npm run typecheck`, `npm run lint`, `npm run build` | pasan (solo la advertencia antigua de `postcss.config.mjs`) |

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
3. Se corren `typecheck`, `lint`, `build` y los tres `verify`.
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

**Piloto en China Wok Centro** (ver `docs/salida-a-produccion.md`, sección 3)

- [ ] Con los restaurantes cargados, el admin crea desde `/admin` un
      usuario **restaurante** por cada host de China Wok Centro.
- [ ] El host dibuja el plano real del local en el editor, en tablet.
- [ ] Una semana completa, de lunes a domingo, con el encargado dando
      comentarios. Se miden la espera promedio y el uso frente al papel.

**Antes de presentar**

- [ ] Hacer la demo de `docs/demo.md` de principio a fin sobre `testing`, con
      dos pestañas para el tiempo real.
- [ ] El asistente sin `OPENROUTER_API_KEY` no entiende «¿qué semana fue más
      lenta?» (responde el mensaje genérico); con la clave sí la contesta.
      Si se quiere sin clave, hay que añadirla a `localAnswer` (Miembro B).
- [x] **Arreglo del modo rápido que quedó fuera** (#29): el commit `4701330` de la
      rama `feat/quick-mode-live` («permitir arrastre con mouse y lápiz») se
      subió después de fusionar el #9. Ya está en `testing` y `main`; falta
      probarlo con la mano en la tablet (el navegador de las pruebas no pintaba).

### Más adelante

- **Sentar con mesa desde el modo rápido**, con `assignTable` por el socket
  (Miembro B). Así «listo» pasa a «sentado» y cuenta en las estadísticas.
- **«Actividad de hoy» solo de hoy**, el `<main>` anidado y el «Cargando…»
  que no se ve (Miembro B).
- **Pasar al tema el modo rápido y las estadísticas** (Miembro B).
- **Guardar el tema por usuario** en la base de datos: hoy vive en el
  navegador.
- **Pantalla en `/admin` para crear restaurantes**, marcas y zonas, y para
  mover cada restaurante en el mapa. Hoy los crean `npm run db:restaurantes`
  (producción) y el seed (desarrollo), y no se pueden editar desde la app.
- **Que cada usuario cambie su propia contraseña.** El admin ya cambia la suya
  y restablece la de cualquiera desde `/admin` (botón «Contraseña», que
  además cierra las sesiones abiertas). Lo que falta es que un host o una
  analista la cambien sin pedírselo al admin.
- **Que alguna pantalla ponga mesas en «reservada».**
- **Más de un servidor.** El Deshacer del modo rápido y las salas de Socket.IO
  viven en la memoria del proceso: basta para 8 restaurantes en un solo
  servidor, pero para varios servidores haría falta, por ejemplo, Redis.
