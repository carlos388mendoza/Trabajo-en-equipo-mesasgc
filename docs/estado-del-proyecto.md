# Estado del proyecto

_Actualizado el 29 de septiembre de 2026._

**Table Waitlist:** listas de espera en tiempo real para los restaurantes de
Grupo Comidas.
- Stack: Next.js 16, React 19, Drizzle y Turso, Better Auth, Socket.IO y
  TypeScript.
- Equipo: Miembro A (editor, tiempo real, conflictos y auth) y Miembro B (modo
  rápido, estadísticas e IA).

## Lo que ya está hecho

Todo esto está en `testing`.

| Área | Qué hay | Dónde está | PR |
|---|---|---|---|
| Esquema y seed | Restaurantes, marcas, zonas, elementos, lista de espera y catálogo de 8 tipos. Seed idempotente con 8 restaurantes y 5 usuarios de prueba (solo en desarrollo). | `lib/db/`, `scripts/seed.ts` | varios |
| Editor de mesas | Plano con Konva para tablet: arrastrar, redimensionar, girar elementos, deshacer y copiar a otro restaurante. | `components/editor/`, README §8–9, §12 | #3, #7 |
| Giro guardado y estructura | El giro del plano completo se guarda (`table_layouts.rotation`), se avisa en vivo, se copia y lo respetan el plano en vivo y el minimapa. Tipos barra, puerta y pared. | `components/editor/`, `lib/layout/`, README §12 | #14 |
| Tiempo real | Next y Socket.IO en un solo servidor (`server.ts`), con una room por restaurante y la sala `overview` del mapa. | `lib/realtime/`, README §10, §16 | #5, #11 |
| Conflictos | Asignación de mesa con bloqueo optimista: gana el primero y el otro recibe «Esta mesa ya fue asignada». | `lib/tables/assign.ts` | #5 |
| Autenticación y roles | Better Auth con correo y contraseña. Roles admin, restaurante y analitica. `/login`, `/inicio`, `/admin`, `/sin-acceso`, y encabezado con sesión y favicon. | `lib/auth/`, `proxy.ts`, README §14–15, `docs/rbac.md` | #8 |
| Modo rápido (Miembro B) | En vivo por Socket.IO (`waitlist:add`, `waitlist:resolve` y `waitlist:undo`, con `canModifyWaitlist`), tarjetas tipo Tinder con `motion` y Deshacer (botón y Ctrl+Z). | `components/quick-mode/`, `lib/waitlist/`, README §11 | #9 |
| Estadísticas e IA (Miembro B) | Últimos 14 días en hora de Honduras, «tiempo hasta avisar» con `called_at`, top 10 de clientes y asistente. | `components/analytics/`, `lib/analytics/`, `app/api/` | #9 |
| Mapa general y marcas | Tabla `brands` (4 marcas). `/mapa` estilo radar con los 8 restaurantes en vivo (solo contadores), filtros, lista por espera y zoom al plano en vivo. `/restaurante/[id]/mapa` para el host. Analitica no ve nombres. `emitOverview` avisa también desde el modo rápido. | `lib/map/`, `components/map/`, README §16, `docs/rbac.md` | #11 |
| Aspecto | Estilo de mapa «radar», minimapa, íconos de lucide y temas Claro, Oscuro, Sistema y Personalizado, sin parpadeo. | `lib/theme/`, `/ajustes`, README §13 | #7 |
| CI | GitHub Actions en cada PR y cada push a `testing` y `main`: typecheck, lint, build y los tres `verify`, con Node 22 y `npm ci`. | `.github/workflows/ci.yml` | #10 |
| Despliegue | `railway.json` (build, `db:migrate` antes de desplegar, start y healthcheck), `/api/health` público y guía paso a paso. | `railway.json`, `docs/despliegue.md` | #13 |
| Documentos | Guion de la demo y plan de salida a producción para la dirección. | `docs/demo.md`, `docs/salida-a-produccion.md` | #14 |

Las verificaciones automáticas no usan ningún *runner* de tests: son scripts
contra una base temporal. Estado en `chore/pre-release` (`testing` más este
PR):

| Comando | Resultado |
|---|---|
| `npm run verify:editor` | 102/102 |
| `npm run verify:realtime` | 113/113 |
| `npm run verify:auth` | 128/128 (levanta la app real; incluye el healthcheck) |
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
| #12 | `fix/verify-auth-flake` (404 intermitente de `verify:auth`) | **Abierto.** CI en verde, sin conflictos, **sin aprobación registrada** en GitHub. |
| #13 | `chore/deploy` (Railway y `/api/health`, Miembro B) | Fusionado. Revisado y aprobado por el Miembro A. |
| #14 | `feat/layout-rotation` (giro guardado; barra, puerta y pared) | Fusionado. Aprobado por el Miembro B. |
| — | `chore/pre-release` (healthcheck en `verify:auth`, mejoras del CI, guía de despliegue y este documento) | PR abierto hacia `testing`. |

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

### Antes del PR final `testing` → `main`

El PR a `main` es el que dispara el despliegue. Lo abre el equipo cuando todo
lo de abajo esté listo.

**PR pendientes**

- [ ] **#12** (`fix/verify-auth-flake`): falta que el Miembro B registre su
      aprobación en GitHub. Después, fusionarlo.
- [ ] **PR de marcas del Miembro B:** cambiar `lib/analytics/brand.ts` para
      que lea la marca de `restaurants.brand_id` en vez de usar el nombre del
      restaurante. Todavía no está abierto.
- [ ] **Este PR** (`chore/pre-release`).

**Pendientes del Miembro B (no bloquean)**

- [ ] El asistente pide quitar los filtros aunque ya estén en «Todos los
      restaurantes» («Compara restaurantes»).
- [ ] Singulares: «1 clientes avisados», «1 personas».

**Producción** (ver `docs/despliegue.md`)

- [ ] Crear en Turso una base **nueva y vacía** para producción (por ejemplo
      `mesasgc-prod`) y su token.
- [ ] Cargar las variables en Railway: un `BETTER_AUTH_SECRET` nuevo,
      `BETTER_AUTH_URL` con https, Turso y OpenRouter.
- [ ] En el primer despliegue, comprobar que el Pre-deploy dice «migrations
      applied». `drizzle-kit` está en `devDependencies`: si faltara en el
      contenedor, moverlo a `dependencies`.
- [ ] Crear el primer admin con `npm run create-admin` y no correr nunca el
      seed contra producción.
- [ ] Poner un límite de gasto en OpenRouter y probar a restaurar un
      respaldo de Turso.

**Decisiones de la dirección** (ver `docs/salida-a-produccion.md`)

- [ ] ¿Se aceptan que los nombres del top de clientes se envíen a OpenRouter
      cuando se usa el asistente?
- [ ] ¿Puede analitica ver el top 10 de clientes con nombres?
- [ ] ¿Cuánto tiempo se guarda el historial de clientes?

**Antes de presentar**

- [ ] Hacer la demo de `docs/demo.md` de principio a fin sobre `testing`, con
      dos pestañas para el tiempo real.

### Más adelante

- **Sentar con mesa desde el modo rápido**, con `assignTable` por el socket
  (Miembro B). Así «listo» pasa a «sentado» y cuenta en las estadísticas.
- **«Actividad de hoy» solo de hoy**, el `<main>` anidado y el «Cargando…»
  que no se ve (Miembro B).
- **Pasar al tema el modo rápido y las estadísticas** (Miembro B).
- **Guardar el tema por usuario** en la base de datos: hoy vive en el
  navegador.
- **Pantalla para gestionar marcas y la posición de cada restaurante** en el
  mapa: hoy las pone el seed.
- **Que alguna pantalla ponga mesas en «reservada».**
- **Más de un servidor.** El Deshacer del modo rápido y las salas de Socket.IO
  viven en la memoria del proceso: basta para 8 restaurantes en un solo
  servidor, pero para varios servidores haría falta, por ejemplo, Redis.
