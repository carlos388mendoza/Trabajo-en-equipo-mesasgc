# Estado del proyecto

_Actualizado el 29 de septiembre de 2026._

**Table Waitlist:** listas de espera en tiempo real para los restaurantes de
Grupo Comidas.
- Stack: Next.js 16, React 19, Drizzle y Turso, Better Auth, Socket.IO y
  TypeScript.
- Equipo: Miembro A (editor, tiempo real, conflictos y auth) y Miembro B (modo
  rápido, estadísticas e IA).

## Lo que ya está hecho

| Área | Qué hay | Dónde está |
|---|---|---|
| Esquema y seed | Restaurantes, zonas, elementos, lista de espera y catálogo de tipos. Seed idempotente. | `lib/db/`, `scripts/seed.ts` |
| Editor de mesas | Plano con Konva: arrastrar, redimensionar, girar, deshacer y copiar a otro restaurante. Pensado para tablet. | `components/editor/`, README §8–9, §12 |
| Tiempo real | Next y Socket.IO en un solo servidor (`server.ts`), con una room por restaurante. | `lib/realtime/`, README §10 |
| Conflictos | Asignación de mesa con bloqueo optimista: gana el primero y el otro recibe «Esta mesa ya fue asignada». | `lib/tables/assign.ts` |
| Modo rápido (Miembro B) | En vivo por Socket.IO (`waitlist:add`, `waitlist:resolve` y `waitlist:undo`, con `canModifyWaitlist`), tarjetas tipo Tinder con `motion` y Deshacer (botón y Ctrl+Z). Fusionado en el #9. | `components/quick-mode/`, `lib/waitlist/`, README §11 |
| Estadísticas e IA (Miembro B) | Últimos 14 días en hora de Honduras, «tiempo hasta avisar» con `called_at`, top 10 de clientes y asistente. Fusionado en el #9. | `components/analytics/`, `lib/analytics/`, `app/api/` |
| Aspecto | Estilo de mapa «radar», minimapa, íconos de lucide y temas Claro, Oscuro, Sistema y Personalizado, sin parpadeo. | `lib/theme/`, `/ajustes`, README §13 |
| Giro guardado y estructura | El giro del plano completo se guarda (`table_layouts.rotation`), se avisa en vivo, se copia y lo respeta el plano en vivo. Tipos barra, puerta y pared. **En `feat/layout-rotation`.** | `components/editor/`, `lib/layout/`, README §12 |
| Mapa general y marcas | Tabla `brands` (4 marcas) y marca, ciudad y posición en `restaurants`. `/mapa` estilo radar con los 8 restaurantes en vivo por la sala `overview` (solo contadores), filtros, lista por espera y zoom al plano en vivo. `/restaurante/[id]/mapa` para el host. Analitica no ve nombres. **PR de `feat/world-map` hacia `testing`, en revisión.** | `lib/map/`, `components/map/`, README §16, `docs/rbac.md` |
| Autenticación y roles | **Terminado y probado a mano.** Better Auth con correo y contraseña; roles admin, restaurante y analitica; `/login`, `/inicio`, `/admin`, `/sin-acceso`; encabezado con sesión y favicon. | `lib/auth/`, `proxy.ts`, README §14–15, `docs/rbac.md` |

Las verificaciones automáticas no usan ningún *runner* de tests: son scripts
contra una base temporal. Estado en `feat/layout-rotation` (sale de `feat/world-map`, que ya trae `testing` y el #9):

| Comando | Resultado |
|---|---|
| `npm run verify:editor` | 98/98 (79 + 9 del giro + 10 de barra, puerta y pared) |
| `npm run verify:realtime` | 113/113 (82 del modo rápido en vivo + 31 de la sala `overview`) |
| `npm run verify:auth` | 124/124 (levanta la app real; 92 + 32 del mapa) |
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
| #9 | `feat/quick-mode-live` (Miembro B) | Fusionado, con merge normal. Revisado y aprobado por el Miembro A. |
| — | **`feat/world-map`** (mapa general y marcas) | **PR abierto hacia `testing`**, con `vbgjptt89g-beep` como revisor. Ya trae `testing` (con el #9). |
| — | **`feat/layout-rotation`** (giro guardado; barra, puerta y pared) | Subida, **sin PR** hasta que se fusione el de `feat/world-map` (sale de ella). |

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
- **Destino después del login.** Con un solo rol se entra directo: admin a
  `/mapa`, analitica a `/analiticas` y un host con un restaurante a su modo
  rápido. Con varios roles distintos (el gerente), se elige en `/inicio`.

## Lo que falta

### Auth: después del merge

- El Miembro B revisa los cambios que tocan su código: su modo rápido y sus
  estadísticas se movieron **sin cambios** a `components/` para poder
  protegerlos en el servidor, y sus API tienen ahora la comprobación de
  permisos al principio.
- En producción: `BETTER_AUTH_SECRET` propio, aplicar las migraciones con
  `npm run db:migrate` (nunca `db:push` contra Turso) y crear el primer admin
  con `npm run create-admin`.

### Pendientes del #9 (Miembro B, no bloquean)

- **El asistente y los filtros.** Con «Todos los restaurantes» ya
  seleccionado, «Compara restaurantes» pide quitar los filtros.
- **Singulares:** «1 clientes avisados», «1 personas».

### Mapa general: lo que queda (`feat/world-map`)

- **Revisión del PR** por el Miembro B.
- **`emitOverview`: hecho.** Los eventos `waitlist:add`, `waitlist:resolve` y
  `waitlist:undo` ya lo llaman, solo cuando la acción sale bien, así que
  `/mapa` ve al momento los clientes nuevos, resueltos o restaurados. Lo
  comprueba `verify:realtime`.
- **Miembro B: solo le queda `lib/analytics/brand.ts`.** Hoy
  `getBrandForRestaurant` devuelve el nombre del restaurante como marca
  provisional. Cuando entre este PR, basta con cambiarlo para leer la tabla
  `brands` por `restaurants.brand_id`.
- **Producción:** aplicar la migración 0002 con `npm run db:migrate`. Los
  restaurantes que ya existan quedan sin marca ni posición: salen en la lista
  del mapa, pero no en el dibujo, hasta que se les ponga.
- **Sin pantalla para marcas y posiciones.** Hoy las pone el seed.

### Más adelante

- **Sentar con mesa desde el modo rápido**, con `assignTable` por el socket
  (Miembro B). Así «listo» pasa a «sentado» y cuenta en las estadísticas.
- **«Actividad de hoy» solo de hoy**, el `<main>` anidado y el «Cargando…»
  que no se ve (Miembro B; las estadísticas ya van en hora de Honduras).
- **Pasar al tema el modo rápido y las estadísticas** (tarjetas, íconos de
  lucide) y la pantalla de clientes «listos» (Miembro B).
- **Guardar el tema por usuario** en la base de datos: hoy vive en el
  navegador.
- **Que el minimapa gire con el plano** (hoy dibuja la zona sin girar).
- **`verify:auth` a veces da 404** en el primer PATCH de la API del modo rápido,
  mientras Next compila esa ruta. Al repetirlo pasa. Convendría «calentar» la
  ruta antes de comprobar los permisos.
- **Que alguna pantalla ponga mesas en «reservada».**
- **CI/CD con GitHub Actions**: build y verificaciones en cada push, y deploy al
  fusionar a `main`.
