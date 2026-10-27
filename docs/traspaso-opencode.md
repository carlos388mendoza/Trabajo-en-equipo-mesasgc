# Traspaso a OpenCode (27 de octubre de 2026)

Claude Code se detuvo a mitad de la **Parte 2 (Vercel)** por el límite de uso. Este archivo dice exactamente dónde quedó todo para seguir sin adivinar.

## Estado de cada parte

| Parte | Estado | Dónde |
|---|---|---|
| **1 · Issue #107** (quitar `alert`/`confirm` nativos) | **Terminada**, con CI en verde y fusionada en `testing` | PR #108. El #107 se cierra solo al publicar en `main` |
| **2 · Adaptar a Vercel** | **A medias** | Rama `feat/vercel`, PR **borrador** hacia `testing` |
| **3 · PR #106 y publicación** | **Sin empezar.** El PR #106 (`testing`→`main`) está abierto y mergeable, pero es anterior a #108 y a la Parte 2 | No fusionar sin el «sí, publica» de Carlos |
| **4 · Pasos para Carlos** | **Sin empezar.** Va en `docs/despliegue-vercel.md` (no existe todavía) | — |

## Parte 1: qué se hizo (PR #108, ya en `testing`)

- El único uso nativo era el `window.confirm` de «Cerrar sesión» (`components/layout/sign-out-button.tsx`).
  - En `scripts/verify-markdown.mts`, `alert(1)` es texto de prueba contra XSS, no una llamada.
  - No había ningún `prompt()`.
- `components/ui/confirm-dialog.tsx`: diálogo propio y accesible.
  - Foco atrapado, Esc cancela y Enter confirma (Enter mantenido no confirma).
  - Botón peligroso en rojo.
  - Se dibuja en `document.body` con z-[80].
- /admin reexporta el mismo diálogo desde `components/admin/ui.tsx`.
- ESLint: regla `no-alert` como error.
- `verify:browser` tiene una sección #107.

## Parte 2: método de tiempo real elegido

**Registro de avisos en Turso más sondeo corto por HTTP.** No hay WebSockets ni servicios externos.

**Por qué:**

- En Vercel no corre `server.ts`, las conexiones se cortan a los 300 s (Hobby) y puede haber varias instancias, así que las rooms de Socket.IO en memoria no sirven.
- No necesita cuenta nueva (Upstash, Ably…) y los datos de clientes no salen a terceros.
- Funciona igual en local (`npm run dev`) y en Vercel.

**Cómo funciona:**

- Cada acción es un `POST /api/tiempo-real` con `{ event, payload, restaurantId }`. La respuesta es el «ack» de antes.
- Los avisos se guardan en la tabla `realtime_events` (migración `drizzle/0013_tiempo_real_vercel.sql`, solo aditiva).
- Cada pantalla pregunta `GET /api/tiempo-real?restaurante=<id>&desde=<n>` (o `&mapa=1`):
  - cada 2 s con la pantalla visible;
  - cada 15 s en segundo plano;
  - cada 5 s y 30 s en el mapa general.
- Los avisos se guardan 10 min. Si una pantalla se pierde avisos, el servidor responde `reset` y la pantalla recarga.
- El cliente (`lib/realtime/client.ts`, clase `RealtimeClient`) imita la API del socket: `on`, `emit`, `timeout(ms).emitWithAck`, `connected`, «connect» y «disconnect». Las pantallas y la cola sin conexión casi no cambian.
- **Reconexión:** reintenta a los 2, 4, 8 y 15 s. Al volver avisa «connect»; las pantallas vuelven a entrar y recargan (`onResync` en `use-restaurant-socket.ts` y `loadAllRef` en el modo sencillo).

**Límites gratis** (Vercel Hobby): 1 millón de invocaciones al mes. Una pantalla visible gasta unas 1800 por hora, así que alcanza para unas 550 horas-pantalla al mes. Basta para una demo, pero no para varios restaurantes todo el día.

**Aviso:** Vercel dice que Hobby es para uso **personal, no comercial** (fair use guidelines). Carlos lo sabe: es una demo suya.

## Parte 2: qué ya está hecho en `feat/vercel`

- **Esquema:** tablas `realtime_events` y `login_failures` (`lib/db/schema.ts`, migración 0013).
- **Límite de login en la base** (`lib/auth/login-limit.ts`, ahora `async`). Mismas reglas: solo fallos, 5 por correo o 30 por IP cada 15 min. Se hace `await` en `app/login/actions.ts` y en `app/api/auth/[...all]/route.ts`. `scripts/verify-auth.mts` ya está adaptado y añade la comprobación «el bloqueo vale desde otra instancia».
- **Deshacer de 10 min con la base como fuente de verdad** (`lib/waitlist/quick-actions.ts`):
  - `flushUndo` espera a que se guarde;
  - `hydrateUndo` relee la base;
  - `readUndoState` es la versión asíncrona;
  - `undoWaitlistAction` reclama la fila con `DELETE … RETURNING` (dos instancias no deshacen dos veces) y la devuelve con `release()` si no se puede deshacer.
- **Tiempo real nuevo:**
  - `lib/realtime/bus.ts`: `publish`, `readSince`, `currentCursor` y `prune`;
  - `lib/realtime/handlers.ts`: todos los eventos que tenía `lib/realtime/server.ts`;
  - `lib/realtime/http.ts`;
  - `app/api/tiempo-real/route.ts`;
  - `lib/realtime/client.ts`.
- **Borrado:** `lib/realtime/server.ts` (Socket.IO). `server.ts` queda para local y servidor propio: Next y la tarea de retención, sin sockets.
- **Emisores a la base:** `lib/realtime/registry.ts` (`emitToRestaurant`, ahora `async`) y `lib/realtime/overview.ts` (`emitOverview`). Las actions del editor y de meseros ahora hacen `await`.
- **Pantallas:**
  - `components/realtime/use-restaurant-socket.ts` (añade `waitlist:changed` a los eventos reenviados y `onResync`);
  - `components/map/use-overview-socket.ts`;
  - `components/quick-mode/quick-mode-client.tsx`: recarga al reconectar, y un arreglo de tipos en deshacer «agregar varios».
- **Cron de retención:** `app/api/cron/retencion/route.ts`, protegido con `CRON_SECRET` y público en `proxy.ts`.
- **CSP:** `connect-src 'self'` (sin `ws:`/`wss:`) en `proxy.ts` y `next.config.mjs`.
- **`vercel.json`:** región `iad1`, cron diario a las 09:00 UTC y `buildCommand: node scripts/vercel-build.mjs`.
- **`scripts/vercel-build.mjs`:** solo con `VERCEL_ENV=production` corre `drizzle-kit migrate` y `db-catalog` antes de `next build`. Nunca `db:push` ni seed.
- `npm run typecheck` pasa.

## Paso que quedó a medias

`scripts/verify-realtime.mts` ya usa el cliente HTTP: un servidor `createServer` mínimo que llama a `handleRealtimePost`/`handleRealtimeGet`, y clientes `RealtimeClient` con sondeo de 40 ms. Al correrlo fallan tres cosas:

1. **«… exige permiso actualizado»** (6 casos: add, resolve, undo, reopen, delete, add-many). `lib/realtime/handlers.ts` (`dispatch`) comprueba `canJoinRestaurant` **antes** del permiso concreto, y contesta «No tienes acceso a este restaurante.» en lugar del texto con «permiso».
   - **Arreglo sugerido:** quitar ese `canJoinRestaurant` genérico de `dispatch` para los eventos que no son de entrar (cada evento ya comprueba `canAssignTables` o `canModifyWaitlist` para ESE restaurante, que implica acceso).
   - O moverlo detrás del permiso concreto.
2. **«deja de recibir los del primero y recibe los del segundo»** (host con dos restaurantes que cambia de uno a otro). Hay que revisarlo:
   - tras el `restaurant:join` al segundo, el cliente pone `restaurantId` y `cursor`, pero puede haber un sondeo en curso con el restaurante viejo;
   - o el `counter` recibe un aviso del primero que se publicó antes del cambio.
   - Posible arreglo en `lib/realtime/client.ts`: descartar la respuesta de un sondeo si `restaurantId` cambió mientras estaba en vuelo (guardar el restaurante con el que se preguntó y compararlo).
3. **El script se cae con `Error: No autorizado`** (401 sin capturar) más adelante. Probablemente es el caso «un usuario desactivado ya no conecta» o el de quitarle el mapa. Hay que buscar qué `ask(...)` o `connect(...)` no maneja el 401. `ask` usa `emitWithAck`, que **lanza** con 401; antes el socket devolvía un ack con error. Opciones:
   - envolver `ask` en try/catch y devolver `{ ok: false, error }`;
   - o hacer que `RealtimeClient.request` devuelva `{ ok: false, error: "No autorizado" }` ante un 401 en vez de lanzar. Esto conviene también para las pantallas.

## Qué suites pasan y cuáles no (en `feat/vercel`)

| Suite | Comando | Estado |
|---|---|---|
| typecheck | `npm run typecheck` | ✅ pasa |
| lint | `npm run lint` | sin correr tras los últimos cambios |
| build | `npm run build` | sin correr. En la PC de Carlos el binario de Next está bloqueado por Windows: usar `NEXT_DIST_DIR=.next-perf npx next build --webpack` y luego `git checkout tsconfig.json`. El CI de GitHub sí construye normal |
| verify:editor | `npm run verify:editor` | sin correr (no debería cambiar) |
| verify:realtime | `npm run verify:realtime` | ❌ falla (ver arriba) |
| verify:auth | `npm run verify:auth` | sin correr. Ya está adaptado al límite en la base. En la PC de Carlos se cae en local: usar el CI |
| verify:demo | `npm run verify:demo` | sin correr |
| verify:markdown | `npm run verify:markdown` | sin correr (no debería cambiar) |
| verify:browser | `npm run verify:browser` | no está en el CI y no arranca en la PC de Carlos |

## Lo que falta, en orden

1. Arreglar los tres fallos de `verify:realtime` (sección anterior) y correrlo hasta 0 fallos.
2. Quitar las dependencias `socket.io` y `socket.io-client` de `package.json`:
   - `npm uninstall socket.io socket.io-client`;
   - comprobar con `git grep "socket.io"` que nada más las importa (los comentarios se pueden actualizar).
3. Correr `npm run lint`, el build y todas las `verify` (o abrir el PR y mirar el CI).
4. `verify:auth` y `verify:browser` levantan `server.ts`, que ya no tiene Socket.IO. Revisar si alguna comprobación mira «Socket.IO activo» en el log de arranque. Ahora el mensaje es `> Table Waitlist en http://localhost:PORT (producción)`; `verify-browser.mts` busca `"Table Waitlist en"`, así que debería servir.
5. Añadir a `verify:realtime` comprobaciones del sondeo:
   - `reset` cuando el cursor es más viejo que lo guardado;
   - que el login limit y el deshacer valen «entre instancias» (dos `RealtimeClient` y `dropUndoMemoryForTests`; ya existe la de «tras un reinicio»).
6. Revisar `components/editor/editor-client.tsx`: con `onResync` podría hacer `router.refresh()` (hoy no lo usa; la ocupación del editor solo se refresca con avisos).
7. Escribir `docs/despliegue-vercel.md` con la Parte 4 (pasos para Carlos):
   - crear el proyecto en Vercel desde GitHub (Hobby, repo `carlos388mendoza/Trabajo-en-equipo-mesasgc`, rama `main`, framework Next.js; el build lo toma de `vercel.json`);
   - variables, **solo nombres** y solo en el entorno **Production**: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (la URL de Vercel), `OPENROUTER_API_KEY`, `CRON_SECRET`. `NEXT_PUBLIC_SOCKET_URL` ya no se usa: quitarla de `.env.example`;
   - llaves nuevas: token de Turso nuevo y revocar el viejo; llave nueva de OpenRouter y borrar la vieja; revisar Activity desde el 20 de octubre; `BETTER_AUTH_SECRET` con el comando de PowerShell que dio Carlos (va directo al portapapeles); revisar actividad en Turso;
   - cómo verificar: `/api/health`, `/login`, plano en vivo en 2 pestañas;
   - salida de Railway (solo cuando Carlos confirme): quitar el acceso de Railway a GitHub, borrar las variables y el proyecto noble-energy;
   - recordatorio: todos vuelven a iniciar sesión; cambiar la contraseña del admin y usar «Revisar contraseñas».
8. Actualizar `README.md` (sección de despliegue y tiempo real), `docs/seguridad.md` (CSP, límite en la base, cron con `CRON_SECRET`) y «Dónde quedé» en `docs/estado-del-proyecto.md`. Marcar `docs/hosting-gratis.md`, `docs/despliegue.md` y lo de Railway como **obsoletos**.
9. Quitar «borrador» del PR de `feat/vercel`, poner la revisión como comentario, esperar el CI en verde y fusionar a `testing`.
10. Parte 3: cerrar el PR #106 o actualizarlo (se actualiza solo al cambiar `testing`) para que lleve #108 y la Parte 2. **No fusionarlo** hasta el «sí, publica» de Carlos.

## Reglas del proyecto (obligatorias)

- Nunca mostrar ni escribir contraseñas, tokens ni claves: ni en la terminal, ni en archivos, ni en commits, ni en el chat. Solo nombres de variables.
- Nada de force push. Nada de commits directos a `main` ni a `testing`. Ramas `feat/`, `fix/` o `docs/` desde `testing`, y PR hacia `testing` con la revisión como comentario.
- No correr `seed`, `seed:reset` ni `db:push` en producción. En producción, solo lectura.
- No borrar datos demo ni datos reales.
- No subir `.env.local`, `local.db`, respaldos ni archivos temporales.
- No intentar saltarse el bloqueo de Windows (la CLI de Railway y el binario nativo de Next están bloqueados en la PC de Carlos). No usar la CLI de Vercel para cambiar variables: las pone Carlos en la web.
- No usar OpenCode y Claude Code a la vez sobre la misma carpeta.
- Commits con prefijo `feat:`, `fix:`, `docs:`, `chore:`, `test:` o `perf:`.
- Si algo no se puede hacer gratis o es muy riesgoso, parar y preguntar a Carlos.
