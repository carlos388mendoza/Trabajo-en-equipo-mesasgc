# Estado del proyecto

_Actualizado el 28 de septiembre de 2026._

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
| Modo rápido (Miembro B) | Añadir clientes y marcarlos listos o ausentes, deslizando la tarjeta. | `components/quick-mode/`, README §11 |
| Estadísticas e IA (Miembro B) | Espera media, días, restaurantes y asistente, con límite de uso. | `components/analytics/`, `app/api/` |
| Aspecto | Estilo de mapa «radar», minimapa, íconos de lucide y temas Claro, Oscuro, Sistema y Personalizado, sin parpadeo. | `lib/theme/`, `/ajustes`, README §13 |
| Autenticación y roles | Better Auth con correo y contraseña; roles admin, restaurante y analitica; `/login`, `/inicio`, `/admin`, `/sin-acceso`; encabezado con sesión y favicon. | `lib/auth/`, `proxy.ts`, README §14–15, `docs/rbac.md` |

Las verificaciones automáticas no usan ningún *runner* de tests: son scripts
contra una base temporal. Estado al cerrar la rama de auth:

| Comando | Resultado |
|---|---|
| `npm run verify:editor` | 79/79 |
| `npm run verify:realtime` | 60/60 |
| `npm run verify:auth` | 92/92 (levanta la app real) |
| `npm run typecheck`, `npm run lint`, `npm run build` | pasan (solo la advertencia antigua de `postcss.config.mjs`) |

## Ramas y PR

| PR | Rama | Estado |
|---|---|---|
| #1 | `testing` → `main` | Fusionado (proyecto inicial) |
| #2 | `feat/db-schema` → `main` | **Abierto** y antiguo: su contenido ya entró en `testing` por otras ramas. Conviene cerrarlo. |
| #3 | `fix/estilos-editor` | Fusionado |
| #4 | `docs/claude-md` (`CLAUDE.md`) | Fusionado |
| #5 | `feat/realtime-server` (tiempo real y conflictos) | Fusionado |
| #6 | `feat/quick-mode-statistics-ai` (Miembro B) | Fusionado |
| #7 | `feat/editor-visual` (radar, íconos, temas) | Fusionado, como *squash* |
| — | **`feat/auth-rbac`** (autenticación y roles) | **Solo en local, sin subir**, a la espera de revisar las capturas y probar el login. 15 commits encima de `testing`. |
| — | `feat/quick-mode-live` (Miembro B) | En el remoto, sin PR. Seguramente la actualización en vivo del modo rápido. |

Reglas del equipo: nunca se trabaja ni se hace push en `main`; las ramas salen
de `testing` y los PR van hacia `testing`; commits con prefijo (`feat`, `fix`,
`docs`, `chore`, `test`, `perf`); y nunca se suben `.env.local`, `local.db` ni
claves.

## Decisiones que tomamos

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

## Lo que falta

### Para cerrar la auth

- Que revises las capturas y pruebes el login tú mismo. Después, push de
  `feat/auth-rbac` y PR hacia `testing` con `vbgjptt89g-beep` como revisor.
- Revisar con el Miembro B los cambios que tocan su código: su modo rápido y
  sus estadísticas se movieron **sin cambios** a `components/` para poder
  protegerlos en el servidor, y sus API tienen ahora la comprobación de
  permisos al principio.
- En producción: `BETTER_AUTH_SECRET` propio, aplicar las migraciones con
  `npm run db:migrate` (nunca `db:push` contra Turso) y crear el primer admin
  con `npm run create-admin`.

### Siguiente trabajo

- **Sentar con mesa desde el modo rápido**, con `assignTable` por el socket
  (Miembro B). Así «listo» pasa a «sentado» y cuenta en las estadísticas.
- **Actualización en vivo del modo rápido** (rama `feat/quick-mode-live`).
- **Estadísticas en hora de Honduras** (UTC-6), con el filtro de los últimos 14
  días, «Actividad de hoy» solo de hoy, el `<main>` anidado y el «Cargando…»
  que no se ve (Miembro B).
- **Pasar al tema el modo rápido y las estadísticas** (tarjetas, íconos de
  lucide) y la pantalla de clientes «listos» (Miembro B).
- **Vista por marca** (Pizza Hut, KFC...) en analítica: `restaurants` no tiene
  ese dato. Haría falta una columna nueva, coordinada por el esquema.
- **Guardar el giro del plano y el tema por usuario** en la base de datos: hoy
  el giro es solo de la vista y el tema vive en el navegador.
- **Barra, puerta y pared** como tipos de elemento.
- **Que alguna pantalla ponga mesas en «reservada».**
- **CI/CD con GitHub Actions**: build y verificaciones en cada push, y deploy al
  fusionar a `main`.
- **Cerrar el PR #2**, que está obsoleto.
