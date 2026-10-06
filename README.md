# Table Waitlist

[![CI](https://github.com/carlos388mendoza/Trabajo-en-equipo-mesasgc/actions/workflows/ci.yml/badge.svg?branch=testing)](https://github.com/carlos388mendoza/Trabajo-en-equipo-mesasgc/actions/workflows/ci.yml)

Aplicación en tiempo real para el manejo de listas de espera de clientes en restaurantes: estructura de mesas por local, modo rápido de check-in/check-out, roles con permisos distintos, estadísticas y un asistente de IA para consultas en lenguaje natural.

**Plazo:** 1 semana.

---

## CI

GitHub Actions ejecuta estas comprobaciones en cada pull request dirigido a `testing` o `main`, y en cada push a esas ramas:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run verify:editor`
- `npm run verify:realtime`
- `npm run verify:auth`
- `npm run verify:demo`

El workflow usa Node.js 22 y `npm ci`. Las verificaciones usan bases SQLite temporales y aplican las migraciones del repositorio; no necesitan credenciales de Turso ni de OpenRouter. Para ver el resultado, abre la pestaña **Actions** del repositorio y selecciona la ejecución del workflow **CI**. Una marca verde indica que terminó bien; una roja señala que falló un paso y permite abrir sus logs.

---

## Despliegue

La guía paso a paso para desplegar en Railway está en [`docs/despliegue.md`](docs/despliegue.md).

---

## 1. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend + rutas protegidas por rol | Next.js (React) + TypeScript |
| Backend / API | Next.js API routes (o Express/Hono si se separa) |
| Base de datos | Turso |
| ORM / migraciones | Drizzle |
| Autenticación y roles (RBAC) | Better Auth |
| Tiempo real | Socket.IO |
| IA / lenguaje natural | AI SDK + OpenRouter |
| Gestión de tareas | GitHub Issues + Projects |

---

## 2. Roles del sistema (RBAC)

| Rol | Acceso |
|---|---|
| **Administrador** | Crea usuarios, accede a todos los restaurantes y a todas las estadísticas |
| **Usuario de restaurante** | Accede solo a su restaurante, modos sencillo y completo; edita la estructura de sus mesas, elige su plano por defecto y gestiona sus zonas de meseros |
| **Usuario de analíticas** | Ve estadísticas de todos los restaurantes/marcas, vista completa o filtrada por restaurante |

Un usuario puede tener varios roles a la vez. Cómo está hecho: sección 14 y
[`docs/rbac.md`](docs/rbac.md), con la tabla completa de permisos.

---

## 3. Reparto de tareas

### Miembro A — Estructura de mesas y sincronización en tiempo real

1. Diseño de esquema DB para mesas/elementos (tipo, posición x/y, rotación)
2. Editor de mesas drag & drop (`react-konva` o `dnd-kit`)
3. Función "copiar configuración de mesas" a otro restaurante
4. Rotación de configuraciones guardadas (navegación tipo galería)
5. Servidor WebSocket (Socket.IO) — eventos de asignación de mesa, por "room" según restaurante
6. Manejo de conflictos: bloqueo optimista (el primer evento que llega al servidor gana; el segundo recibe un error y se refresca)

### Miembro B — Modo rápido, estadísticas e IA

1. UI de lista de espera con tarjetas deslizables (`framer-motion` o `react-swipeable`) para marcar "listo" / "ausente"
2. Historial de acciones (stack) para deshacer (Ctrl+Z)
3. Dashboard de estadísticas: tiempo de espera promedio, día más rápido/lento, top de clientes (`recharts`)
4. Endpoint de IA (AI SDK + OpenRouter) que traduzca preguntas en lenguaje natural a consultas sobre las estadísticas
5. Resumen automático de estadísticas (ej. variación semanal)

### Ambos

- Esquema completo de la base de datos (`restaurants`, `tables`, `table_layouts`, `waitlist_entries`, `users`, `roles`) + script de seed
- Autenticación con Better Auth y definición de roles
- CI/CD con GitHub Actions (build + test en cada push, deploy automático al hacer merge a `main`)
- Este `README` y, opcionalmente, una carpeta `/docs` con documentación más extensa

---

## 4. Cronograma sugerido (7 días)

| Día | Ambos | Miembro A | Miembro B |
|---|---|---|---|
| 1 | Setup del repo, DB, Auth, tipos compartidos en TS | — | — |
| 2 | — | Editor drag & drop de mesas | UI de tarjetas deslizables |
| 3 | — | WebSocket server + eventos de asignación | Historial de acciones (Ctrl+Z) |
| 4 | — | Manejo de conflictos (bloqueo optimista) | Dashboard de estadísticas |
| 5 | — | Copiar/rotar configuraciones de mesas | Endpoint de IA + consultas en lenguaje natural |
| 6 | Integración: probar en 2 dispositivos a la vez | Ajustes finales | Resumen automático + ajustes finales |
| 7 | Pulido de UI, CI/CD, README/docs, demo | — | — |

---

## 5. Flujo de trabajo en GitHub

1. **Un solo repositorio**, ambos como *maintainers*.
2. Se activa protección en `main`: nadie hace push directo, todo entra por Pull Request.
3. Se crea la rama `testing` desde `main` para probar antes de producción.
4. Cada tarea de la lista de arriba se crea como un **GitHub Issue** y se organiza en un **GitHub Project** (Kanban: To Do / In Progress / Done).
5. Para cada Issue se crea una **feature branch** desde `testing`:
   - `feat/table-editor`
   - `feat/quick-mode`
   - `fix/db-migration`
   - `refactor/optimize-code`
6. **Nunca se trabaja directo en `main` ni en `testing`.**
7. Commits pequeños y descriptivos (son "checkpoints" a los que se puede volver).
8. Al terminar una tarea: **Pull Request** de la feature branch hacia `testing`, mencionando el Issue que resuelve (`Closes #4`).
9. El otro miembro **revisa el código** (code review) antes de aprobar el merge.
10. Cuando varias features estén integradas y probadas en `testing`, se abre un PR final de `testing` → `main`, que dispara el **deploy automático** (CI/CD).

### Glosario rápido

- **Commit:** un punto en el tiempo del proyecto (checkpoint) al que se puede volver.
- **Branch (rama):** una línea de tiempo de commits; puede haber varias a la vez.
- **Pull Request:** solicitud para unir los commits de una rama a otra, sujeta a revisión.
- **Issue:** una tarea o requerimiento registrado en GitHub.

---

## 6. Notas técnicas clave

- **WebSockets por restaurante:** emitir eventos en "rooms" separadas por `restaurantId`, así cada restaurante solo recibe sus propias actualizaciones.
- **Conflictos de asignación de mesa:**
  1. El frontend envía el evento de asignación al servidor (sin actualizar la UI todavía).
  2. El servidor valida si la mesa ya tiene cliente asignado.
  3. Si está libre, la asigna y emite el evento a todos los conectados a esa sala.
   4. Si ya fue tomada, rechaza y avisa solo al que falló ("Esta mesa ya fue asignada").

---

## 7. Esquema de la base de datos

Definido en `lib/db/schema.ts` (Drizzle + Turso). Los conjuntos cerrados de
valores viven en `lib/db/enums.ts`, que es la única fuente de verdad: el schema
solo usa tipos y la UI compara contra esas constantes.

```
brands ──── restaurants  (brand_id, opcional)
restaurants ──┬── table_layouts ──── tables ──┐
              │        (zonas/vistas)   ▲     │
              │                        │     │
              ├── waitlist_entries ────┴─────┘  (assigned_table_id)
              └── user
element_types ──── tables  (element_type_id)

user / session / account / verification   (Better Auth)
```

| Tabla | Para qué |
|---|---|
| `brands` | Las marcas (China Wok, Pizza Hut, KFC, Denny's) con su `accent_color`. |
| `restaurants` | Los locales. `slug` para la URL. `brand_id`, `city`, `map_x` y `map_y` (todas opcionales) son del mapa general y de las estadísticas por marca. |
| `table_layouts` | Zonas/vistas del local (comedor, terraza). Es la unidad sobre la que trabaja el editor y la galería. `version` sube en cada guardado. `rotation` (0, 90, 180 o 270) es el giro del plano completo. |
| `element_types` | Catálogo de los 8 tipos (mesa-sillas, mesa-butacas, area-juegos, bano, caja, barra, puerta, pared) con color, ícono y tamaño. Editable sin deploy. |
| `tables` | Mesas **y** baños/cajas/áreas: en el canvas se comportan igual, y `element_type_id` los distingue. Lleva la geometría (`x`, `y`, `width`, `height`, `rotation`). |
| `waitlist_entries` | Clientes en la lista. `party_size` lo necesitan las estadísticas. |
| `user`, `session`, `account`, `verification` | Las que espera Better Auth. `role` y `restaurant_id` son columnas de `user`. |

### Decisiones que conviene no deshacer sin pensarlo

- **Una sola tabla `tables` para mesas, baños, cajas y áreas de juegos.** En el
  canvas se mueven y se pintan igual; separarlas serían cinco tablas repetidas.
- **`tables.current_entry_id` es el puntero de "quién está en esta mesa".** Es
  lo que hace posible el manejo de conflictos: la asignación es un único
  `UPDATE ... WHERE current_entry_id IS NULL`, y si afecta 0 filas es que otro
  host se adelantó. `waitlist_entries.assigned_table_id` es el lazo inverso.
- **Roles como columna, no como tabla.** Son tres valores cerrados; una tabla
  `roles` solo añadiría un join en cada verificación de permisos.
- **Los valores en la base de datos están en español** (`libre`, `esperando`,
  `mesa-sillas`) y la interfaz también.
- **Sin `check()` constraints**: Turso/libSQL no los soporta en Drizzle. Los
  valores se validan en el servidor con Zod.

### Puesta en marcha de la base de datos

```bash
cp .env.example .env.local   # llenar TURSO_DATABASE_URL y BETTER_AUTH_SECRET
npm install
npm run db:push              # aplica el esquema (en local, file:./local.db)
npm run db:seed              # tipos de elemento, 2 restaurantes y los usuarios de prueba
```

En local basta `TURSO_DATABASE_URL=file:./local.db`. `BETTER_AUTH_SECRET` es
obligatorio para iniciar sesión (`openssl rand -base64 32`).

**Contra una base remota (Turso) no se usa `db:push`**: los cambios de esquema
se generan con `npm run db:generate` (quedan en `drizzle/`) y se aplican con
`npm run db:migrate`. El catálogo de elementos del editor lo carga
`npm run db:catalog` (solo toca `element_types`; Railway lo corre en el
Pre-deploy). Las 4 marcas, los 8 restaurantes y una zona vacía por
restaurante los carga `npm run db:restaurantes`: solo añade lo que falta y
nunca crea mesas, clientes ni usuarios. El primer admin de producción se crea
con `npm run create-admin` (sección 15).

Otros scripts: `db:generate` (genera SQL en `drizzle/`), `db:studio`,
`seed:reset` (borra los datos de layout y vuelve a sembrar; **no** toca las
cuentas de usuario), `db:demo` y `db:demo:borrar` (datos de demostración,
sección 17), `verify:editor` (144 comprobaciones del editor contra una base de
datos temporal), `verify:realtime` (158), `verify:auth` (329) y `verify:demo`
(85), `lint`, `typecheck`.

---

## 8. Editor de mesas (paso 2)

`/restaurante/[id]/editor`: mapa tipo GTA5 donde se coloca la estructura del
local, con pan arrastrando el fondo y zoom con la rueda.

### Cómo funciona por dentro

| Archivo | Papel |
|---|---|
| `app/restaurante/[id]/editor/page.tsx` | Server Component. Carga zona, catálogo y elementos, y los pasa ya resueltos. |
| `app/restaurante/[id]/editor/actions.ts` | Server action. Valida con Zod, comprueba permisos y revalida caché. |
| `lib/layout/save.ts` | Toda la escritura y las reglas de integridad, sin nada de HTTP. |
| `lib/layout/validation.ts` | Schema Zod del payload. |
| `lib/layout/element-style.ts` | Funciones puras: forma, color y numeración de cada tipo. |
| `lib/db/queries/layouts.ts` | Lecturas del editor. |
| `components/editor/editor-client.tsx` | Estado del editor. |
| `components/editor/lazy-konva-canvas.tsx` | **El `dynamic({ ssr: false })` de Konva**, que comparten el editor y el plano en vivo. |
| `components/editor/konva-canvas.tsx` | Stage, pan, zoom y retícula. |
| `components/editor/element-node.tsx` | Un elemento (memoizado, con sus sillas). |
| `components/editor/canvas-icon.tsx` | Íconos del lienzo, pasados a mapa de bits una sola vez. |
| `lib/layout/placement.ts` | `placeInView` (dónde aparece una mesa nueva) y `clampToZone` (que nada salga de la zona), sin nada de React. |

### Por qué el `dynamic` está donde está

Konva toca `document` y el canvas 2D en el momento de importarse, así que no
puede ejecutarse en el servidor. Next 15+ además prohíbe `ssr: false` dentro de
un Server Component, y `page.tsx` lo es. Por eso el `dynamic` vive en
`lazy-konva-canvas.tsx`, que es un Client Component y lo usan el editor y el
plano en vivo del mapa. El resultado verificado: en el
build de producción **Konva no aparece en el bundle del servidor** y sí en un
chunk de cliente de 330 KB que solo se descarga al abrir el editor.

### Decisiones que conviene no deshacer sin pensarlo

- **La zona activa viaja en la URL** (`?zona=<id>`), no en el estado. Así el
  botón "atrás" funciona y recargar no pierde el sitio. La page monta el editor
  con `key={layout.id}`, que es lo que hace que cambiar de zona empiece con
  estado limpio sin efectos.
- **El editor NO escribe `status` ni `current_entry_id`.** Son del paso 6. La
  lista de campos del `UPDATE` es explícita a propósito, y hay una comprobación
  en `verify:editor` que lo cubre: si el guardado tocara la ocupación, una mesa
  ocupada aparecería libre en el mapa.
- **Una mesa con clientes sentados no se puede borrar desde el editor.** Se
  rechaza el guardado entero con un mensaje, en vez de dejar el histórico de la
  lista de espera apuntando a una mesa inexistente.
- **Regla anti-impostor:** un `id` que ya existe en *otra* zona se rechaza. Sin
  eso, alguien podría reescribir la mesa de otro restaurante imponiendo su id.
  Un `id` que no existe en ninguna zona sí se acepta: es un elemento nuevo.
- **La vista (zoom y desplazamiento) vive dentro de Konva, no en el estado de
  React.** Panear mueve el Stage en cada `dragMove`; pasar eso por estado
  re-renderizaría el árbol entero 60 veces por segundo.
- **Las formas salen de la `key` del tipo, no de una columna.** Una mesa con
  sillas siempre es redonda aunque le cambien el color, y cambiar la forma de un
  tipo no necesita migrar la base de datos.
- **Un elemento se gira con los botones de su panel, no arrastrando.** El
  `Transformer` sigue con `rotateEnabled: false`: en una tablet, girar con el
  dedo es impreciso. Ver la sección 12.

### Verificación

```bash
npm run verify:editor
```

Levanta una base de datos SQLite temporal (`.verify-editor.db`, gitignorada),
aplica la migración real del repo y comprueba 44 cosas: las funciones puras de
estilo y numeración, las guardas de Zod, y sobre todo que la escritura respete
las reglas de integridad (zona del restaurante, tipos del catálogo, ids, no
tocar la ocupación, no borrar mesas ocupadas, idempotencia). No ejecuta
`drizzle-kit push`, a propósito: leería el `TURSO_DATABASE_URL` del entorno y
podría vaciar una base de verdad.

Lo que **no** comprueba, porque necesita un navegador: que el arrastre, el zoom
y el drop se sientan bien. Eso hay que probarlo a mano.

### Pendiente de este paso

- Better Auth: `assertCanEditRestaurant` en `editor/actions.ts` es un
  placeholder deliberado. Ojo a que ocultar el formulario no es una barrera de
  seguridad; la comprobación va en la action.
- Los tipos de `element_types` son de solo lectura en el editor.

## 9. Copiar estructura entre restaurantes (paso 3)

El botón **«Copiar estructura…»** de la barra del editor lleva *todas* las zonas
de un restaurante a otro que tú elijas, con ids nuevos.

Lo que hace y lo que se niega a hacer:

- Copia zonas y elementos, y nada más. La lista de espera **no** se copia ni se
  toca: las mesas del destino nacen `libre` y sin `currentEntryId`, aunque en el
  origen estuvieran ocupadas.
- Si el destino ya tiene zonas, **no copia**: dice cuántas hay y para. La
  sustitución solo ocurre si el usuario lo confirma explícitamente, y entonces
  borra todo lo del destino antes de escribir.
- Si el destino tiene mesas con clientes sentados, la sustitución se rechaza
  aunque venga confirmada. Vaciar el local con gente dentro rompería la lista de
  espera de ese local.
- Borra y escribe dentro de una transacción: o se copia entero, o no se toca
  nada. No queda un destino a medias si falla a mitad.

### Archivos

| Fichero | Para qué |
| --- | --- |
| `lib/layout/copy.ts` | La copia. Sin dependencias de Next: se puede probar sola. |
| `components/editor/copy-layout-dialog.tsx` | El diálogo de elegir destino y confirmar. |
| `lib/layout/geometry.ts` | Rectángulo envolvente y normalización, para encajar una zona en otra de otro tamaño. |

### Decisiones que conviene no deshacer sin pensarlo

- **`lib/layout/copy.ts` no importa nada de Next.** Las server actions son
  capa fina; la lógica va aquí para poder testearla. Es el mismo patrón que
  `lib/layout/save.ts`.
- **El destino se vacía antes de insertar, no se renombra nada.** Por eso los
  nombres de zona del origen se pueden reutilizar tal cual: no hay nada con lo
  que choquen contra el índice único de `(restaurante, nombre)`. Un deduplicador
  de nombres aquí sería código que no puede dispararse.
- **La zona por defecto se busca, no se supone.** Un `select` no garantiza
  orden, así que "la por defecto es la primera fila" funciona por casualidad y
  falla en cuanto el orden cambia. Si el origen no marcara ninguna, se promueve
  la primera para que el destino siempre tenga una.
- **`replace` es obligatorio en el tipo, no opcional.** Que la action acepte
  copiar sin preguntar significaría que un `undefined` —un forgot de un
  parámetro, un `?? false` mal puesto— se lee como "sustituye todo". Con el
  boolean obligatorio, el que tiene que decidir es el código que llama, y la
  action no compila hasta que sepas qué pasa.
- **El botón se deshabilita si hay cambios sin guardar.** Copiar el estado
  guardado cuando en pantalla hay otra cosa es una forma sutil de perder trabajo.

### Verificación

```bash
npm run verify:editor
```

79 comprobaciones. Las de este paso cubren: no copiar a sí mismo, destino
inexistente, destino con estructura sin `replace` (y que queda intacto),
destino ocupado rechazado, ids nuevos, mesas que nacen libres, sustitución
completa, que la zona por defecto sobreviva aunque no sea la primera, y el
encaje de una zona copiada dentro de otra de tamaño distinto.

### Pendiente de este paso

- Better Auth: `assertCanEditRestaurant` sigue siendo un placeholder, también
  en la copia. Se llama para origen y destino.
- El diálogo se cierra solo si la copia va bien. Si falla, se queda abierto con
  el mensaje, para poder cambiar el destino sin recargar.


## 10. Tiempo real y conflictos (pasos 5 y 6)

`npm run dev` ya no es `next dev`: arranca `server.ts`, que sirve Next **y**
Socket.IO en el mismo puerto (3000). `npm run dev:next` sigue existiendo por si
solo quieres la web, pero sin tiempo real.

### Cómo funciona

- Cada pantalla entra en la *room* de su restaurante (`restaurant:<id>`), así
  que un local solo recibe sus propios avisos.
- **Asignar una mesa** sigue el flujo de la sección 6: el cliente pide, el
  servidor decide y solo si gana se avisa a toda la room. El perdedor recibe
  «Esta mesa ya fue asignada.» por su respuesta (ack) y nadie más se entera.
- Al guardar una zona o copiar una estructura, los demás dispositivos reciben
  un aviso y el editor muestra «Otro dispositivo guardó cambios» con un botón
  para recargar. No recarga solo: pisaría lo que el usuario esté moviendo.
- La ocupación de las mesas se pinta en el editor en vivo.

| Evento | Quién lo manda | Qué hace |
| --- | --- | --- |
| `restaurant:join` | cliente | Entra en la room. Un socket, un restaurante. |
| `table:assign` / `table:release` | cliente | Pide sentar / liberar. Contesta por ack. |
| `table:assigned` / `table:released` | servidor | Aviso a toda la room cuando alguien gana. |
| `layout:updated` / `structure:changed` | servidor | Otro dispositivo guardó o copió. |
| `overview:join` | cliente | Entra en la sala `overview` del mapa general (exige `mapa:ver`). El ack trae los contadores de todos. |
| `overview:counters` | servidor | Contadores nuevos de un restaurante, a la sala `overview`. Ver sección 16. |

### Archivos

| Fichero | Para qué |
| --- | --- |
| `server.ts` | Next + Socket.IO en un solo `http.Server`. |
| `lib/realtime/events.ts` | El contrato: tipos de los eventos y schemas Zod. |
| `lib/realtime/server.ts` | Rooms y handlers. No importa nada de Next. |
| `lib/realtime/registry.ts` | `io` en `globalThis`, para emitir desde las actions. |
| `lib/realtime/auth.ts` | Permisos del socket. **Único sitio a tocar con Better Auth.** |
| `lib/realtime/overview.ts` | `emitOverview(restaurantId)`: contadores a la sala del mapa general. |
| `lib/tables/assign.ts` | Asignar y liberar con bloqueo optimista. |
| `components/realtime/use-restaurant-socket.ts` | Hook del navegador. El modo rápido puede usarlo igual. |

### Decisiones que conviene no deshacer sin pensarlo

- **Un solo puerto.** Railway expone uno, y así el navegador se conecta al
  mismo origen sin CORS. `NEXT_PUBLIC_SOCKET_URL` es opcional.
- **`destroyUpgrade: false`.** Engine.io cierra al segundo cualquier WebSocket
  que no sea suyo; sin esto podría cortar el HMR de Next (`/_next/hmr`).
- **`io` vive en `globalThis`.** Next empaqueta las server actions en otro
  grafo de módulos; una variable de módulo estaría vacía desde la action.
- **El bloqueo es el `UPDATE ... WHERE current_entry_id IS NULL`, no la
  lectura previa.** Las lecturas solo dan buenos mensajes. Va en un `batch`
  con el `UPDATE` del cliente de la lista: o se sientan los dos, o ninguno.
- **El restaurante sale de la room, nunca del payload.** Un socket que entró
  en el restaurante 2 no puede tocar una mesa del 1 mandando su id.
- **Liberar pide el cliente que el host ve en la mesa.** Si otro dispositivo
  ya la liberó y la volvió a asignar, no se libera a alguien que no ha visto.
- **`output: "standalone"` no se puede activar**: la guía de servidor propio
  de Next dice que no son compatibles.

### Verificación

```bash
npm run verify:realtime
```

Base SQLite temporal (`.verify-realtime.db`, gitignorada) con la migración real
y un servidor Socket.IO de verdad en un puerto libre. Comprueba las reglas de
asignación y liberación, las carreras (2 y 10 hosts a por la misma mesa, un
cliente en dos mesas a la vez), el aislamiento entre rooms, que el perdedor
reciba el error solo él, y que el restaurante salga de la room.

Lo que **no** comprueba: dos navegadores reales a la vez. Eso es el día 6 del
cronograma.

### Probarlo a mano con dos pestañas

Con `npm run dev` corriendo y los datos del seed, abre
`http://localhost:3000/restaurante/rest_centro/editor` en dos pestañas. Abajo a
la izquierda las dos dicen «● en vivo».

- **Guardar:** añade una mesa en una pestaña y pulsa Guardar. La otra muestra
  «Otro dispositivo guardó cambios en esta zona».
- **Asignar:** mientras no exista el modo rápido, `demo:host` hace de otro host
  desde la terminal. Pasa por los mismos eventos y permisos que el navegador,
  así que primero inicia sesión: por defecto como el admin de prueba
  (`DEMO_EMAIL` y `DEMO_PASSWORD` lo cambian).

```bash
npm run demo:host -- sentar tbl_c_1 wl_1          # Mesa 1 se pinta OCUPADA en las dos pestañas
npm run demo:host -- carrera tbl_c_2 wl_2 wl_3    # dos hosts a la vez: uno gana, el otro "Esta mesa ya fue asignada."
npm run demo:host -- liberar tbl_c_1 wl_1         # Mesa 1 vuelve a libre
```

`URL` y `RESTAURANTE` cambian el servidor y el restaurante (por defecto
`http://localhost:3000` y `rest_centro`). Para volver a los datos de partida:
`npm run seed:reset`.

### Pendiente de este paso

- Better Auth: `lib/realtime/auth.ts` deja pasar a todos. El TODO dice qué
  poner: la sesión desde la cookie del handshake y `canAccessRestaurant`.
- Copiar una zona suelta (`copyZoneIntoAnother`) no avisa: no tiene interfaz
  todavía y su resultado no trae el restaurante de destino.
- El guardado del editor no comprueba la versión de la zona: si dos personas
  guardan a la vez, gana la última. El editor avisa, pero no lo impide.
- En Windows, `@libsql/client` necesita el *Visual C++ Redistributable*
  (`vcruntime140.dll`). Sin él, ni `server.ts` ni los `verify:*` arrancan.

## 11. Modo rápido, estadísticas y asistente IA

El modo rápido (`/restaurante/[id]/rapido`) lee y escribe clientes de
`waitlist_entries` en Turso. Permite registrar el nombre, tamaño del grupo y
una nota, y marcar al grupo siguiente como listo o ausente; en pantallas
táctiles también acepta deslizar la tarjeta a izquierda o derecha.

Estas tres acciones viajan por Socket.IO (`waitlist:add`, `waitlist:resolve` y
`waitlist:undo`) y se notifican a las tablets conectadas a la room del mismo
restaurante. `Deshacer` revierte la última acción del local: elimina un grupo
que acaba de agregarse o restaura el estado anterior. El registro de deshacer
vive en memoria y se reinicia al reiniciar el servidor.

### Modo sin conexión (requisito de la dirección)

El modo sencillo sigue funcionando sin Internet. Con conexión, todo es como
antes (Socket.IO, avisos a la room, validaciones del servidor).

- **Cola persistente** (`lib/offline/store.ts`, IndexedDB `tw-modo-sencillo`).
  Cada cambio se guarda **antes** de mandarlo, con `operationId` (UUID),
  `action` (el evento del socket), `targetId`, `data` (payload), `sequence`,
  `createdAt`, `state` (`pendiente`, `enviando` o `conflicto`), `attempts`
  y `error`. Es por usuario y restaurante, y sobrevive a recargar, girar la
  tablet o cerrar la pestaña. Nunca guarda contraseñas, tokens ni la cookie.
  Al cerrar sesión se borra (`components/layout/sign-out-button.tsx`).
- **Lo que se ve** es «últimos datos del servidor + cola aplicada en orden»
  (`applyOperations`, en `lib/offline/apply.ts`). Una operación que ya no
  tiene sentido sobre esos datos (ocupar una mesa ocupada) no se pinta.
  Deshacer sin conexión quita la última de la cola.
- **Acciones en cola:** `waitlist:add`, `waitlist:add-many`,
  `waitlist:resolve` (listo o ausente), `waitlist:reopen`, `waitlist:delete`,
  `table:assign` (sentar) y `table:release` (liberar mesa). El deshacer del
  servidor (`waitlist:undo`) no se encola: vive en memoria del servidor.
- **Copia local** de la lista y de las mesas (`saveSnapshot`), y un service
  worker (`public/sw.js`, red primero) que guarda solo la página del modo
  sencillo, `/_next/static` y los logos, para poder **recargar sin red**.
  Nunca la API, el login, los sockets ni ningún POST.
- **Reconexión** (`use-offline-queue.ts`): al entrar de nuevo en la room se
  manda la cola **en orden**, una a una («Sincronizando…»), y después se
  vuelve a leer todo del servidor. Las confirmadas salen de la cola. Dos
  pestañas no sincronizan a la vez (`navigator.locks`) y se avisan los
  cambios (`BroadcastChannel`).
- **Sin duplicados** (`lib/offline/operations.ts`, migración `0008`, tabla
  `offline_operations`): el servidor guarda la respuesta de cada
  `operationId`. Un reenvío devuelve la misma respuesta sin aplicarla otra
  vez ni avisar a la room. Las altas llevan además un id de cliente elegido en
  la tablet, y su hora real de llegada (limitada a las últimas 24 h, para que
  no sirva para colarse). Un `operationId` de otro restaurante se rechaza.
- **Conflictos:** los decide el servidor con los mismos mecanismos que en
  línea (el UPDATE condicional de `assignTable`, `releaseTable` con el
  cliente esperado, `updated_at` en resolver y borrar). Si A, sin conexión,
  sentó a alguien en una mesa que B ocupó entretanto, la operación de A se
  rechaza («Esta mesa ya fue asignada»), no pisa a B, queda como
  `conflicto` y se enseña en rojo hasta que el host pulsa «Entendido». Un
  rechazo por sesión o por no estar en la room no es un conflicto: se
  reintenta.
- **Estados:** 🟢 Conectado, 🟠 Sincronizando…, 🔴 Sin conexión, «N cambios
  pendientes», 🟢 Sincronizado (`sync-status.tsx`).
- **Sentar y liberar** desde «Ver todas las cartas» (`seat-picker.tsx`, con
  `GET /api/restaurante/[id]/mesas`, permiso `rapido:ver`; el socket exige
  `mesas:asignar`).
- **Pruebas:** `verify:realtime` (reenvíos, conflictos entre dispositivos,
  ids ajenos, hora de llegada, `applyOperations`) y `verify:auth` (permisos de
  `/mesas`). En el navegador, con dos dispositivos y la app compilada: sin
  red, acciones, cola en IndexedDB, recarga sin red, conflicto, reconexión,
  sin duplicados y tiempo real.

### Las cartas: agregar, abanico y «Ver todas las cartas»

Desde el PR `feat/cartas-baraja` el montón ocupa todo el ancho y el
formulario ya no está al lado (`components/quick-mode/`):

- **Toque o arrastre.** `swipe-card.tsx` mide cuánto se movió el puntero:
  menos de 10 px y 600 ms es un toque. Un toque en el centro abre el
  formulario; en una de las 4 esquinas (48 × 48 px, con un doblez de
  indicador), el abanico. Deslizar nunca abre nada.
- **Formulario** (`add-guest-sheet.tsx`, sobre `overlay.tsx`): panel que sube
  desde abajo en celular y tablet, y ventana desde 1024 px. Esc, Cancelar o
  tocar fuera lo cierran. Pestañas **Uno** y **Varios**: en Varios hay filas
  editables (Enter en la nota crea la siguiente) y **Pegar lista**
  («Nombre, personas[, nota]», `lib/waitlist/guest-list.ts`). Las filas con
  errores bloquean el guardado.
- **Agregar varios** es un solo evento, `waitlist:add-many` (máximo 30,
  `MAX_BATCH_ENTRIES` en `lib/realtime/events.ts`), con el mismo permiso
  (`rapido:modificar`). Es un único `INSERT` de varias filas: entran todas o
  ninguna, cada una 1 ms después de la anterior para respetar el orden. La
  room recibe un `waitlist:changed` por cliente. Deshacer (aviso o Ctrl+Z)
  los quita a todos en una transacción, y no quita a ninguno si alguno ya
  cambió.
- **Abanico** (`card-fan.tsx`): hasta 7 cartas giradas alrededor de un punto
  bajo la mano; con más, «+N» abre «Ver todas las cartas». Solo anima
  `rotate`, `scale` y `opacity`, y `MotionConfig reducedMotion="user"` lo
  respeta. Elegir una carta la pone arriba del montón **en esa tablet**; el
  orden de la fila no cambia.
- **Ver todas las cartas** (`all-cards-view.tsx`): `GET
  /api/restaurante/[id]/cartas?rango=hoy|7dias` (`rapido:ver`: el host, sus
  restaurantes; el admin, todos; analitica, 403). Las que siguen esperando
  salen siempre. Filtros por estado y buscador sin tildes. Una en espera se
  resuelve con `waitlist:resolve`; una lista o ausente vuelve con
  `waitlist:reopen` (conserva su hora de llegada y su lugar; se puede
  deshacer). Un sentado no vuelve: tiene mesa. Se actualiza con los
  `waitlist:changed` de la room.
- **Migración `0006`** (solo aditiva): `waitlist_entries.resolved_at` y
  `resolved_by_user_id` (sin FK, como `seated_by_user_id`), para «esperó 12
  minutos, la resolvió Ana». Volver a la espera las vacía, junto con
  `called_at`.

Las estadísticas (`/analiticas`) se calculan en `/api/analiticas` sobre los
registros reales: grupos sentados durante los últimos 14 días (zona
`America/Tegucigalpa`), espera desde `arrived_at` hasta `seated_at`, comparación con los 14 días anteriores,
resumen diario y agrupación por restaurante. Sin registros, la interfaz indica
que todavía no hay actividad; no presenta cifras de demostración.

El gráfico «Volumen y tiempo de espera» lleva los ejes etiquetados: el eje Y
izquierdo dice «Clientes (grupos)» con el valor más alto de su escala, el
derecho «Minutos de espera» con el suyo y el eje X «Día». La leyenda identifica
las dos series (clientes/grupos en azul, minutos de espera en naranja) y cada
barra lleva su aviso con la unidad («Lun: 12 grupos atendidos»). Los cuatro
títulos viven **dentro** del bloque con scroll horizontal propio del gráfico,
así que etiquetarlos no le cuesta ancho a la página (issue #61).

`/analiticas` no tiene scroll horizontal en ningún ancho: en móvil las tarjetas
se apilan y los filtros van en columna, el gráfico ocupa todo lo disponible (las
barras no tienen ancho fijo: se reparten el ancho de su día) y solo hace scroll
propio por dentro por debajo de 440 px, donde 14 días con dos barras dejarían de
leerse. Las tablas y los bloques de código de la respuesta del asistente se
desplazan ellos solos. La comprobación está en `npm run verify:browser`.

El asistente (`/api/assistant`) recibe ese resumen para contestar preguntas en
español. Si se configura `OPENROUTER_API_KEY`, consulta OpenRouter; sin esa
clave, responde localmente las preguntas comunes sobre espera y volumen. La
clave se define solo en `.env.local` y no se envía al navegador. Cuando usa
OpenRouter, envía la pregunta (después de quitar datos privados conocidos),
totales, fechas, promedios, actividad por día y cifras por restaurante, marca y
ciudad. El top se manda con alias como «Cliente 1», junto con grupos y espera
promedio; la respuesta cambia esos alias por los nombres solo para mostrarla
en pantalla. No se envían nombres reales, teléfonos ni notas de clientes. Los
teléfonos y notas tampoco forman parte del contexto estadístico que se manda al
proveedor.

La respuesta se pinta como **Markdown** (`components/analytics/markdown.tsx`,
con `react-markdown` y `remark-gfm`): títulos, negritas, cursivas, listas
ordenadas y desordenadas, tablas, código inline, bloques de código y enlaces.
No se interpreta HTML crudo (no hay `rehype-raw`), así que un `<script>` que
aparezca en el texto se queda **como texto visible y no se ejecuta**, igual
que los atributos `on…=`; los enlaces salen con `target="_blank"` y
`rel="noopener noreferrer"`, y las URLs `javascript:` se vacían. Cada tabla va
envuelta en su propio contenedor con scroll horizontal, para que en el celular
empuje solo a la tabla. El prompt pide además al modelo que responda en
Markdown sencillo y nunca en HTML. `npm run verify:markdown` renderiza el
componente de verdad y comprueba el formato y el ataque (67 comprobaciones),
y corre también en el CI.

No se añadieron tablas ni columnas: el esquema de `testing` ya contiene lo
necesario. `waitlist_entries.party_size` guarda cuántas personas hay en el
grupo; `notes` guarda la observación del registro; `status` distingue
`esperando`, `listo`, `sentado` y `ausente`; `arrived_at` mide la espera;
`called_at` conserva cuándo se avisó que había lugar; `seated_at` registra el
momento de sentar al grupo y permite calcular la espera real. La relación con
`restaurants` permite filtrar y comparar la actividad por local.

Los clientes marcados como `listo` todavía no cuentan en las estadísticas:
estas solo incluyen grupos con estado `sentado` y `seated_at`. El modo rápido
los contará cuando la asignación de mesa con `assignTable` se integre en la
siguiente rama. Las estadísticas también muestran actividad de hoy, el día
más lento, top 10 de clientes y filtros por restaurante, marca real y ciudad.
El tiempo hasta avisar se calcula desde `arrived_at` hasta `called_at` para
clientes avisados durante el período.

## 12. Aspecto del editor (tablet)

El editor está pensado para usarse con el dedo en una tablet:
- Botones de al menos 44 px, con ícono y un texto corto debajo.
- Zoom pellizcando con dos dedos.
- Tiradores grandes para redimensionar.
- Tocar un elemento de «Añadir» lo pone **dentro del recuadro**: en el centro
  de lo que se ve (ajustado al zoom) o, si ahí ya hay algo, en el hueco libre
  más cercano (`placeInView` en `lib/layout/placement.ts`).
- **Nada sale de la zona:** arrastrar, pegar, girar, soltar desde la paleta y
  redimensionar pasan por `clampToZone`, que también tiene en cuenta el giro.
  Pegar pone la copia junto al original y dentro de la zona.
- **60 FPS en tablet y celular** al arrastrar, mover el plano y pellizcar
  (ver «Rendimiento» más abajo).

### Qué se ve

- **Cada tipo con su dibujo:**
  - Mesa redonda con una silla por puesto (hasta 8).
  - Mesa con butaca en forma de U.
  - Área de juegos con rayas.
  - Baño y caja con su ícono.
- **El nombre siempre visible**, en una etiqueta blanca que no gira con la mesa.
- **Colores por estado:** libre en verde, ocupada en rojo, reservada en gris,
  con una leyenda fija en una esquina.
- **Mesas ocupadas:** el nombre del cliente y los minutos que lleva sentado. El
  contador avanza solo, con un único reloj para todo el mapa.
- **Un pulso corto** cuando una mesa cambia por un evento en vivo.
- **Marcador de mesa grande:** el nombre, el marcador de estado, el mesero y
  el cliente sentado crecen con la mesa (`markScale`, entre 1 y 1,4), y
  **Ajustar** encuadra las mesas que hay (no la zona entera, que puede ser un
  lienzo mucho mayor), hasta un 160 %. Todo es proporcional: se ve igual de
  bien en escritorio, tablet y celular, y la zona de toque sigue cubriendo la
  mesa y sus sillas.
- **Una sola ventana de control**, que cambia de sitio según la pantalla (lo
  decide CSS con el punto `lg`, 1024 px, así que no hay parpadeo) y **nunca
  tapa el plano**:
  - **Tablet en horizontal y computadora:** un panel fijo a la derecha, de
    320 px y con scroll propio; el lienzo se achica para dejarle sitio. Arriba,
    zona, «★ Por defecto», **Guardar**, **Deshacer** (Ctrl+Z) y **Rehacer**
    (Ctrl+Shift+Z o Ctrl+Y); debajo, el **elemento seleccionado** y las
    secciones **Añadir**, **Plano** (girar el plano ↺ ↻, **Pegar elemento**,
    **Copiar plano**, zoom y **Ajustar**) y **Meseros** («Meseros activos»,
    «Ver meseros» y «Repartir meseros»).
  - **Celular y tablet en vertical:** una barra compacta abajo con **Añadir**,
    **Deshacer**, **Rehacer**, **Guardar**, **Girar** (la mesa elegida o, sin
    selección, el plano) y **Más**. Justo encima, una tira de alto fijo con el
    elemento seleccionado (nombre, puestos, mesero, girar, **Copiar**,
    **Pegar**, **Duplicar**, **Eliminar** y **Listo**), que se desliza de lado.
    «Añadir» y «Más» abren un panel que sube desde abajo, como mucho el 40 %
    del alto; se baja arrastrándolo (o con la flecha o Escape) y se cierra solo
    al añadir. **Nunca se abre solo**: añadir una mesa no lo despliega.
  - Todos los botones miden al menos 44×44 px.
  - Los avisos («Tienes cambios sin guardar», «Guardado…», «Otro dispositivo
    guardó…») van en el panel lateral o en «Más»; en la barra de abajo solo
    salen los errores y el aviso de otro dispositivo, y «Guardar» cambia a
    «Guardado».
- **Copiar y pegar elementos** (Ctrl+C / Ctrl+V o los botones, que funcionan
  con el dedo): la copia (`lib/layout/clipboard.ts`) tiene un id nuevo, el
  siguiente nombre de su tipo y las mismas medidas, giro y puestos, y **no**
  copia relaciones: nace libre, sin cliente, sin reserva y sin mesero. Entra en
  Deshacer y Rehacer y se guarda como cualquier elemento. El portapapeles
  sobrevive al cambio de zona.

### Íconos

Son íconos de línea de [lucide](https://lucide.dev), todos con el mismo grosor.
Los botones y la paleta usan `lucide-react`. El lienzo de Konva usa el paquete
gemelo `lucide`, que da el mismo dibujo como datos: se convierte a SVG y se pinta
como imagen (`components/editor/canvas-icon.tsx`). El ícono de cada tipo sale de
su `key` (`components/editor/icons.ts`), igual que la forma. La columna
`element_types.icon` ya no se muestra; el seed guarda ahí el nombre del ícono.

### Decisiones que conviene no deshacer sin pensarlo

- **`lucide` y `lucide-react` van fijados a la MISMA versión exacta** (sin
  `^`). Si se separan, un ícono puede verse distinto en la paleta y en el mapa.
- **El elemento se dibuja desde su centro** (`offset` = mitad del tamaño) para
  girar sobre sí mismo. En la base de datos `x`/`y` siguen siendo la esquina
  superior izquierda sin girar; la conversión está en `element-node.tsx` y en
  el `Transformer`.
- **Todo el dibujo va con `listening={false}` y hay un rectángulo invisible
  como zona de toque.** Así Konva no calcula el toque de cada silla. Sin ese
  rectángulo el elemento no se puede seleccionar ni arrastrar.
- **Deshacer nunca deshace la ocupación.** Es lo que pasa en el local ahora, no
  una edición del usuario: al restaurar una foto se conserva la ocupación que
  hay en pantalla.
- **El nombre del cliente en vivo se pide aparte.** El evento `table:assigned`
  solo trae el id del cliente. El editor llama a `getTableOccupantInfo`, una
  action de solo lectura, en vez de cambiar el evento.
- **Sin sombras difuminadas ni filtros en el lienzo.** En Konva son de lo más
  caro de pintar; el relieve sale de un borde, no de una sombra.

### Editor fluido en tablet

El 6 de octubre de 2026 el editor iba a 8-17 FPS en tablet y celular al
arrastrar una mesa, mover el plano o pellizcar. Qué lo frenaba y qué se hizo:

- **Cada movimiento redibujaba todo.** La mesa que se arrastra pasa a una capa
  propia y se guarda como imagen (`node.cache`) mientras dura el arrastre, así
  cada paso copia una imagen en vez de redibujar las 40 mesas. El recuadro de
  selección se desengancha hasta soltar.
- **React no se entera hasta soltar.** Konva mueve el nodo; el estado (y la
  foto para Deshacer) se actualiza una sola vez, al soltar. Las mesas van con
  `React.memo` y callbacks estables, y elegir una mesa va en `startTransition`,
  así el panel no se re-renderiza en cada movimiento.
- **Mover el plano y pellizcar con «cámara CSS».** Durante el gesto se mueve
  el lienzo con una transformación CSS (lo hace la tarjeta gráfica) y Konva
  redibuja una sola vez al soltar. El pellizco usa eventos táctiles nativos
  (`Konva.hitOnDragEnabled = false`).
- **Menos píxeles y figuras más baratas.** Densidad de píxeles como mucho 2
  (`Konva.pixelRatio`), la cuadrícula en una sola figura en una capa con
  `listening={false}`, `perfectDrawEnabled={false}` en todas las figuras, los
  íconos pasados a mapa de bits una vez (`canvas-icon.tsx`) y sin sombras.
- **El minimapa y el zoom de la barra** se actualizan con una pausa corta
  (100 y 150 ms), no en cada fotograma.

FPS medidos con Chrome sin ventana, el build de producción, la CPU **4 veces
más lenta**, densidad de píxeles 2 y gestos táctiles reales (la mediana de
fotograma es 16,7 ms en todos los casos «después»):

| Pantalla | Arrastrar mesa | Mover plano | Pellizco | Seleccionar |
|---|---|---|---|---|
| Celular vertical 375×812 | 11 → 57 | 16 → 59 | 9 → 60 | 33 → 60 |
| Celular horizontal 812×375 | 11 → 58 | — → 60 | 46 → 60 | 51 → 59 |
| Tablet vertical 768×1024 | 10 → 59 | 15 → 60 | 14 → 59 | 33 → 58 |
| Tablet horizontal 1024×768 | 10 → 60 | 17 → 60 | 8 → 60 | 37 → 58 |
| Computadora 1280×800 | 8 → 59 | 17 → 60 | 9 → 59 | 25 → 58 |

(«—»: de ese gesto no quedó medida de «antes».)

### Giro del plano completo

- **Se guarda.** Los botones **Girar ↺** y **Girar ↻** giran la zona entera un
  cuarto de vuelta, como una foto en la galería. Es un cambio más: marca
  «sin guardar» y se guarda con **Guardar** en `table_layouts.rotation`
  (migración `0003_layout_rotation.sql`, solo aditiva).
- **Los demás dispositivos se enteran.** El guardado sube la versión de la
  zona y emite `layout:updated`: los otros editores ven el aviso de «otro
  dispositivo guardó», y el plano en vivo se recarga solo.
- **El minimapa gira con el plano**, tanto con ↺ ↻ como al abrir una zona ya
  girada, y tocarlo lleva al punto correcto (`planToRotated` y
  `rotatedToPlan` en `lib/layout/geometry.ts`).
- **Se ve igual en todas partes.** Lo respetan el plano en vivo de
  `/restaurante/[id]/mapa` y el zoom de `/mapa`, y **Copiar plano** lo copia
  al otro restaurante.
- **Qué no hace.** Deshacer no vuelve atrás un giro (se usa el botón
  contrario). Copiar una zona sobre otra que ya existe conserva el giro de la
  de destino.

### Barra, puerta y pared

- **Tres tipos nuevos** en `ELEMENT_TYPE_KEYS` y en el seed, que los añade
  por clave sin duplicar. Ninguno admite clientes.

  | Tipo | Ícono (lucide) | Cómo se dibuja |
  |---|---|---|
  | Barra | `Wine` | Mostrador alargado, con el canto de servicio marcado y banquetas a lo largo. |
  | Puerta | `DoorOpen` | Hueco en la pared, la hoja abierta y el arco que barre al abrirse, como en un plano de arquitectura. |
  | Pared | `BrickWall` (en la paleta) | Bloque sólido del color de las paredes del tema, sin etiqueta encima porque la taparía. |
- **Se ven bien en todos los temas.** La pared usa el color de las líneas del
  tema, y la barra y la puerta su color de tipo con relleno translúcido.
- **El marco de selección se ajusta al elemento.** Las ondas del pulso en vivo
  están ocultas cuando no se animan, y el arco de la puerta es una polilínea:
  `Arc` y `Wedge` de Konva miden el círculo entero.

### Pendiente de este paso

- **Nada pone una mesa en "reservada" todavía.** Se pinta en gris y está en la
  leyenda, pero ninguna pantalla asigna ese estado.
- El comentario de `element_types.icon` en `lib/db/schema.ts` todavía dice
  «emoji». No se tocó porque es el archivo compartido del esquema.

## 13. Estilo radar y temas

### El mapa

- **Estilo de mapa visto desde arriba**, con diseño propio. No usa logos,
  tipografías ni íconos de ningún juego; los íconos son de lucide.
- **Elementos:**
  - Cuadrícula tenue de fondo.
  - Paredes y zonas con líneas marcadas y un brillo suave.
  - Áreas con rellenos translúcidos.
  - Mesas como marcadores con su ícono.
- **En vivo:** cuando una mesa cambia, sale de ella una onda expansiva con un
  eco que se desvanecen.
- **Minimapa** abajo a la izquierda: el plano entero y la parte que se ve.
  Tocarlo o arrastrar sobre él lleva la vista ahí.
- **Paneles flotantes semitransparentes:** la barra de herramientas, los
  avisos, el panel del elemento y la leyenda flotan sobre el mapa.

### Ajustes > Apariencia (`/ajustes`)

- **Temas:**
  - Claro.
  - Oscuro (azul marino).
  - Sistema: sigue el modo del dispositivo y cambia en vivo.
  - Personalizado: cuatro selectores de color (fondo del mapa, líneas y
    paredes, acento, paneles).
- **Vista previa** que cambia en vivo.
- **Restablecer** (dentro de Personalizado): devuelve los cuatro colores a los de fábrica. No cambia el tema elegido.
- **Colores de estado:** libre, ocupada y reservada no se eligen. Se ajustan
  solos al fondo: tonos medios sobre claro, más brillantes sobre oscuro.
- **Avisos de contraste:** en Personalizado se avisa si el contraste baja de
  3:1, el mínimo de WCAG para elementos gráficos. Se comprueba en líneas,
  acento y cada estado.

### Cómo está hecho

| Fichero | Para qué |
| --- | --- |
| `lib/theme/theme.ts` | **El único sitio con colores.** Temas, derivación de Personalizado, contraste, variables CSS y el script de arranque. |
| `lib/theme/use-theme.ts` | Leer y guardar la elección (localStorage), seguir el modo del sistema, aplicar las variables. |
| `components/theme/theme-sync.tsx` | Mantiene `<html>` al día con el tema elegido. |
| `components/editor/minimap.tsx` | Minimapa en SVG. |
| `components/settings/*` | Página de Apariencia y vista previa. |

### Decisiones que conviene no deshacer sin pensarlo

- **Un solo archivo de colores, dos salidas.**
  - La interfaz usa variables CSS (`--c-panel`, `--c-accent`...) guardadas como
    "r g b", para que Tailwind pueda añadir transparencia (`bg-panel/80`).
    `tailwind.config.ts` solo dice qué variable usa cada clase.
  - Konva recibe el mismo objeto `Theme`.
  - No hay colores sueltos en los componentes. La excepción son los colores de
    cada tipo, que salen de `element_types`.
- **Sin parpadeo al recargar.** Un script en el `<head>`, generado desde
  `theme.ts`, aplica el tema guardado antes del primer pintado. Es la técnica de
  la guía de Next «Preventing flash before hydration». Por eso `<html>` lleva
  `suppressHydrationWarning`.
  - En desarrollo, Strict Mode borra lo que puso el script, y `ThemeSync` lo
    repone en `useLayoutEffect`.
  - `ThemeSync` lee la fuente directamente y no el valor del hook. Al hidratar,
    el hook todavía trae el valor del servidor (Claro), y aplicarlo pintaría un
    destello.
- **Personalizado guarda sus variables ya resueltas en localStorage**, para
  que el script de arranque no tenga que saber derivar colores.
- **La vista publica su posición al minimapa por una suscripción propia**, una
  vez por fotograma. Panear no re-renderiza el editor.
- **El plano se encuadra debajo de la barra flotante** con su alto real,
  medido con `ResizeObserver`: en tablet la barra ocupa dos filas.

### Pendiente de este paso

- **La elección vive solo en el navegador.** Cuando esté Better Auth, hay que
  guardarla por usuario (ver el TODO en `lib/theme/theme.ts`), coordinándolo
  con quien lleva el esquema. No se tocó `lib/db/schema.ts`.

## 14. Autenticación y roles

Con [Better Auth](https://www.better-auth.com), correo y contraseña, sobre
Drizzle y libSQL. No hay registro público: los usuarios los crea un admin en
`/admin`. La tabla de permisos está en [`docs/rbac.md`](docs/rbac.md).

### Cómo funciona

1. **Login** (`/login`): una server action llama a Better Auth, que deja una
   cookie de sesión `httpOnly` y `SameSite=Lax` (además `Secure` en https).
   La contraseña pide al menos 8 caracteres. Un usuario desactivado recibe
   «Usuario desactivado» aunque la contraseña sea correcta.
2. **Destino** (`/inicio`): cada uno va a lo suyo según su rol. Con varios
   roles o restaurantes, elige.
3. **Cada petición** pasa por dos barreras:
   - `proxy.ts` (el antiguo `middleware.ts` de Next 16) solo mira si hay
     cookie. Sin ella, una página redirige a `/login` y una API responde 401.
     No consulta la base: corre en cada petición, también en los prefetch.
   - La comprobación de verdad está en `lib/auth/session.ts`, que se llama
     dentro de cada página, server action y API route. Lee la sesión y el
     usuario de la base, así que desactivar o quitar un rol vale al momento.
     Sin permiso: `/sin-acceso` en las páginas y 403 en las API.
4. **Socket.IO** lee la misma cookie en el handshake (`lib/realtime/auth.ts`).
   Entrar en la room de un restaurante y cada asignación vuelven a comprobar
   el permiso.

### Archivos

| Fichero | Para qué |
| --- | --- |
| `lib/auth/auth.ts` | Configuración de Better Auth (se crea al primer uso). |
| `lib/auth/rbac.ts` | **Todas las reglas**: `can(usuario, acción, restaurantId)`. |
| `lib/auth/session.ts` | DAL para Next: `requirePage`, `guardAction`, `guardApi`. |
| `lib/auth/users.ts` | Usuarios con roles y restaurantes; crear, cambiar contraseña, desactivar. Sin Next. |
| `proxy.ts` | Comprobación optimista de la cookie. |
| `app/admin/` | Gestión de usuarios (solo admin). |
| `scripts/create-admin.mts` | Primer admin en producción. |
| `scripts/verify-auth.mts` | `npm run verify:auth`. |

### Esquema

- Roles y restaurantes están en `user_roles` y `user_restaurants` (migración
  `drizzle/0001_auth_rbac.sql`, solo aditiva).
- Las columnas viejas `user.role` y `user.restaurant_id` siguen en la base,
  pero están **obsoletas**: el código ya no las usa.

### Decisiones que conviene no deshacer sin pensarlo

- **El proxy no es la seguridad.** Una server action es un POST a su página: si
  un cambio del *matcher* la dejara fuera del proxy, `guardAction` la sigue
  protegiendo. Lo explica la guía de autenticación de Next 16.
- **No se protege en los layouts.** No se vuelven a ejecutar al navegar. El
  layout del restaurante solo decide qué enlaces enseñar.
- **Un solo archivo de reglas.** Páginas, actions, API y socket llaman a
  `can()`: si cambia un permiso, cambia en `rbac.ts` y nada más.
- **Los destinos de `/inicio` salen del rol, no del permiso.** El admin
  puede ver estadísticas, pero su casa es el mapa general (`/mapa`). Ver
  `landingFor` en `rbac.ts`.
- **El límite del asistente cuenta por usuario**, no por IP: la cabecera
  `X-Forwarded-For` la manda el cliente y se podía falsear.

### Verificación

```bash
npm run verify:auth
```

- Levanta la app real en un puerto libre, con una base temporal
  (`.verify-auth.db`) y los usuarios de prueba.
- Comprueba 329 cosas: login correcto e incorrecto; cada rol solo en lo suyo,
  por página, API, server action y socket; sin sesión, 401 o `/login`; que un
  usuario desactivado ya no entra; y el bloque de datos de demostración (aviso,
  pantalla y borrado por web, sección 17).
- Compila en `.next-verify/`, así que puede correr mientras `npm run dev`
  sigue abierto: Next 16 no deja dos servidores sobre la misma carpeta.

## 15. Usuarios de prueba

> **Solo para desarrollo.** El seed los crea únicamente si `NODE_ENV` no es
> `production`, y solo si no existen. La contraseña `12345abc` es pública, está
> en este README: **nunca** la uses en producción.

Todos tienen la contraseña **`12345abc`**:

| Correo | Nombre | Roles | Restaurantes |
|---|---|---|---|
| `admin@grupocomidas.test` | Administrador | admin | todos |
| `analitica@grupocomidas.test` | Analista | analitica | todos (solo lectura) |
| `pizzahut@grupocomidas.test` | Pizza Hut | restaurante | rest_norte, rest_tgu_pizza |
| `dennys@grupocomidas.test` | Denny's | restaurante | rest_tgu_dennys, rest_sps_dennys |
| `kfc@grupocomidas.test` | KFC | restaurante | rest_tgu_kfc, rest_sps_kfc |
| `chinawok@grupocomidas.test` | China Wok | restaurante | rest_centro, rest_sps_chinawok |

**Un usuario de restaurante por marca**, con todos los locales de su marca
(desde el 5 de octubre). Entran a `/inicio`, con una tarjeta por local, y
cambian de restaurante con el selector de la cabecera.

Antes el seed creaba un «Host» por local, `gerente@` (restaurante +
analítica) y, hasta el 1 de octubre, `dennys-pizzahut@`. Ya no los crea, y en
una base **local** que los tenga de antes **los quita** (son cuentas de prueba;
sus sesiones, roles y accesos se van con ellos, y la lista de espera solo los
referencia de forma blanda). En producción el seed no corre nunca: allí un
usuario que sobra se **desactiva** desde `/admin`, no se borra.

Los casos «un host con un solo restaurante» y «un usuario con dos roles» los
cubre `verify:auth` con dos cuentas propias (`prueba-local@` y
`prueba-dual@`) que solo existen en su base temporal.

### `npm run create-user`: crear o actualizar un usuario desde la terminal

Para dar de alta usuarios en producción sin entrar a `/admin`:

```bash
npm run create-user -- --correo dennys@grupocomidas.test --nombre "Denny's" --rol restaurante --marca "Denny's"
```

- `--rol` (admin, restaurante o analitica), `--restaurante` (slug, p. ej.
  `pizza-hut-norte`) y `--marca` (todos sus restaurantes activos; vale
  «Denny's» o «dennys») se pueden repetir o separar con comas.
- Muestra la base a la que se conecta (solo el host), un resumen, pide la
  contraseña **dos veces, oculta** y confirmar con «si». La contraseña no se
  acepta por argumentos ni por variables de entorno; sin terminal no hace
  nada.
- Si el correo ya existe **no lo duplica**: solo cambia nombre, roles y
  restaurantes, sin preguntar ni tocar la contraseña (para eso,
  `npm run reset-password`).
- Usa las mismas validaciones y funciones que `/admin`
  (`lib/auth/user-upsert.ts`). Lo prueba `verify:auth`.

`rest_centro` es **China Wok Centro** (Tegucigalpa) y `rest_norte` es **Pizza
Hut Norte** (San Pedro Sula): conservan sus ids, así que estos usuarios siguen
valiendo. Cada uno de los 8 restaurantes del mapa tiene su host de prueba.

El seed también deja **8 semanas de historial** en los 8 restaurantes
(`seedHistory`): unos 12 000 grupos ya sentados o ausentes, con más gente el
fin de semana y en los picos del mediodía y de la noche, y clientes
habituales que llenan el top de clientes. Es determinista: repetirlo no
duplica nada. Con `NODE_ENV=production` el seed entero se niega a correr.

`npm run seed:reset` borra los restaurantes, y con ellos las asignaciones de
`user_restaurants`. El seed se las devuelve a estos usuarios sin tocar su
contraseña.

### Producción: el primer admin

```bash
npm run create-admin
```

- Lee `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `ADMIN_NAME` del entorno, o los
  pregunta (la contraseña, sin mostrarla).
- No hay ninguna contraseña escrita en el código.
- Si el correo ya existe, solo le da el rol admin y lo reactiva, sin cambiar
  su contraseña.
- Después, los demás usuarios se crean desde `/admin`.

## 16. Mapa general y marcas

`/mapa` muestra todos los restaurantes sobre un mapa radar, y
`/restaurante/[id]/mapa` es el plano en vivo de uno. Quién ve qué está en
`docs/rbac.md`: admin y analitica ven el mapa general, y el rol restaurante
solo ve el plano de los suyos.

### Qué se ve

- **Honduras entero.** Silueta real, los 18 departamentos con su nombre, las
  fronteras con Guatemala, El Salvador y Nicaragua (y Belice), la costa del
  Caribe con las Islas de la Bahía y las del Cisne, el Golfo de Fonseca y las
  11 ciudades principales. Los datos son de Natural Earth (dominio público), ya
  proyectados y dentro del repo: ver `docs/mapa-honduras.md`. Los colores
  salen del tema, en estilo radar.
- **Ubicación real.** Cada restaurante tiene latitud y longitud
  (`restaurants.latitude`/`longitude`, migración `0004`) y
  `lib/map/projection.ts` las pasa a unidades del mapa. `map_x`/`map_y`
  quedan de respaldo para filas sin coordenadas.
- **Cámara.** Rueda o pellizco para acercar (sobre el punto señalado),
  arrastrar para moverse, botones «Ver todo Honduras», «Tegucigalpa», «San
  Pedro Sula», + y −, y un minimapa al acercarse. Los rótulos y marcadores
  se ven siempre del mismo tamaño en pantalla.
- **Grupos.** Desde lejos, los restaurantes que se pisarían se juntan en un
  marcador por ciudad (suma de clientes, peor alerta y un gajo por marca);
  tocarlo acerca hasta separarlos.
- **Un marcador por restaurante**, del color de su marca:
  - el número de clientes en espera;
  - un anillo con el % de mesas ocupadas;
  - debajo, la espera media actual.
- **Alerta de espera.** Se distingue también por la forma, no solo por el
  color:
  - más de 20 min: halo amarillo que pulsa y un triángulo;
  - más de 40 min: halo rojo más grueso y más rápido, y un octógono.

  Con «reducir movimiento» del sistema, el halo se queda quieto.
- **Filtros y lista.** Se filtra por marca y por ciudad, y hay una leyenda. El
  mapa ocupa todo el ancho; debajo, la lista ordena los restaurantes por espera.
- **Zoom al plano.** Al tocar un marcador, el `viewBox` se acerca a él y
  aparece el plano en vivo del restaurante: el mismo lienzo del editor, en
  solo lectura. «Volver al mapa general» (o Esc) hace el zoom inverso.

### Tiempo real

- **La sala `overview`** recibe los cambios de todos los restaurantes. Solo
  entra quien tiene `mapa:ver`.
- **Solo viajan contadores:** mesas totales, ocupadas y reservadas, clientes
  en espera y la hora media de llegada. El navegador calcula la espera media
  con esa hora, así que avanza sola.
- **Quién avisa.** `emitOverview(restaurantId)` (`lib/realtime/overview.ts`) se
  llama después de sentar o liberar una mesa, al guardar o copiar un plano, y
  cuando el modo rápido agrega, resuelve o deshace (solo si la acción salió bien).
- **Respaldo.** `/mapa` pide además los contadores cada 30 s.
- **El plano en vivo no aplica los eventos uno a uno.** Cuando llega un aviso,
  vuelve a pedir el plano a la server action `loadLivePlan`, que decide en el
  servidor si incluye los nombres.

### Plano en vivo a pantalla completa (tablet en horizontal)

Las tablets usan Opera, y la pantalla completa se pone desde el propio Opera
(no hay botón de Fullscreen API). Con la tablet en horizontal,
`/restaurante/[id]/mapa` pasa a **modo inmersivo**:

- **Lo decide CSS, no JS.** Una media query en `lib/layout/immersive.ts`
  (horizontal, 900×500 o más, `hover: none` y `pointer: coarse`) alimenta las
  variantes de Tailwind `tableta-horizontal:`, `inmersivo:`, `inmersivo-raiz:`
  y `con-plano-inmersivo:`. Así no hay parpadeo al cargar, cambia en el mismo
  fotograma al girar la tablet, y el celular tumbado (430 px de alto como
  mucho) y la computadora (puntero fino) se quedan como siempre.
- **Pantalla entera sin `overflow: hidden`.** La raíz del plano
  (`data-inmersivo`) es `fixed` con `100dvh` y los márgenes de
  `safe-area-inset`; la cabecera, el menú del restaurante y el título se
  ocultan (`con-plano-inmersivo:hidden`) y el `<main>` pierde margen y alto
  mínimo. No queda nada que haga scroll.
- **Controles flotantes:** la misma barra de siempre pasa a flotar arriba,
  semitransparente y sin desenfoque (un `backdrop-filter` encima del lienzo
  costaría fotogramas): nombre, «En vivo», zonas, «Meseros activos [−] N [+]»
  (con el texto solo para el lector de pantalla), **Lista** y **contraer**. No
  se pinta una segunda barra: no hay dos «Agregar mesero».
- **Encuadre:** `KonvaCanvas` recibe `refitOnResize` y `topInset` (la franja
  de los controles): al entrar en el modo, al asomar la barra de Opera o al
  entrar en su pantalla completa, el plano se vuelve a encuadrar solo (con
  120 ms de pausa, una vez con la medida final). El minimapa se oculta.
- **Lista de espera:** un panel a la derecha con el **modo sencillo en un
  iframe del propio sitio**. Es la misma página de siempre, así que conserva
  el tiempo real, la cola sin conexión, los permisos (`rapido:ver`; sin él no
  hay botón) y sentar y liberar. Dentro del iframe, un script en `<head>` marca
  `data-embebido` y la variante `embebido:` quita cabecera y menú. El iframe se
  crea al abrir el panel la primera vez y luego se queda.
- **Solo el propio sitio puede enmarcar la app:** `next.config.mjs` envía
  `Content-Security-Policy: frame-ancestors 'self'` y
  `X-Frame-Options: SAMEORIGIN` (contra el *clickjacking*). Lo comprueba
  `verify:auth`.
- **«Vista normal»** (ícono de contraer) lo quita hasta que la tablet se pone
  de pie; desde la vista normal, **Plano en grande** lo vuelve a poner.
- **Rendimiento:** con la CPU 4 veces más lenta, mover el plano y pellizcar
  van igual o mejor que en la vista normal (57 y 51 FPS en 1024×768, contra 55
  y 46), y a 60 FPS sin ralentizar.

### Archivos

| Fichero | Para qué |
| --- | --- |
| `lib/map/counters.ts` | Contadores por restaurante, espera media y umbrales (20 y 40 min). |
| `lib/map/queries.ts` | Restaurantes con su marca y `getLivePlan` (quita los nombres si no hay `plano:clientes`). |
| `lib/map/world.ts` | Ciudades principales, encuadres y límites de la cámara. |
| `lib/map/projection.ts` | Latitud y longitud ↔ unidades del mapa. |
| `lib/map/honduras-geo.ts` | Silueta, departamentos y vecinos (generado: no editar a mano). |
| `scripts/map/generate-honduras.mts` | Genera `honduras-geo.ts` a partir de Natural Earth. |
| `lib/realtime/overview.ts` | `emitOverview`. |
| `app/mapa/page.tsx`, `app/mapa/actions.ts` | Página y actions (`loadOverviewCounters`, `loadLivePlan`). |
| `app/restaurante/[id]/mapa/page.tsx` | Plano en vivo de un restaurante. |
| `components/map/live-plan.tsx` | El plano en vivo y su modo inmersivo (controles flotantes y panel de la lista de espera). |
| `lib/layout/immersive.ts` | La media query de la tablet en horizontal, que comparten Tailwind y el plano. |
| `components/map/world-map.tsx` | Mapa, cámara (rueda, pellizco, arrastre, botones y minimapa), marcadores y grupos, filtros, lista y zoom al plano. |
| `components/map/live-plan.tsx` | Plano en vivo (Konva en solo lectura). |
| `components/map/use-overview-socket.ts` | Socket de la sala `overview` y respaldo de 30 s. |

### Decisiones que conviene no deshacer sin pensarlo

- **SVG y no Konva en el mapa general.** Son pocas figuras y casi no se mueven.
  Además, con clases de Tailwind el primer HTML ya trae el tema bueno, sin
  destello.
- **Los nombres se quitan en el servidor.** Analitica recibe el plano con el
  id del cliente cambiado por `"oculto"` y sin nombre ni hora. Ocultarlos solo
  en la interfaz se vería en la respuesta.
- **Analitica no entra en las rooms de restaurante.** Por ellas viajan los ids
  de los clientes. Se entera de los cambios por la sala `overview`.
- **Migración solo aditiva** (`0002_brands_world_map.sql`, generada con
  `drizzle-kit generate`). El `ON DELETE set null` de `brand_id` se añadió a
  mano: drizzle-kit lo omite en el `ALTER TABLE ... ADD` de SQLite, y el
  snapshot ya lo espera.

### Seed

- **4 marcas y 8 restaurantes**, 2 por marca, repartidos entre Tegucigalpa y
  San Pedro Sula.
- **Planos:** los 6 nuevos copian el suyo de `rest_centro` o `rest_norte` con
  `copyLayoutToRestaurant`.
- **Clientes y mesas:** todos tienen clientes en espera con horas de llegada
  distintas, así que se ven los tres niveles de alerta. Algunas mesas están
  ocupadas (con `assignTable`) y otras reservadas.
- **La demo del README sigue igual:** `tbl_c_1` y `tbl_c_2` quedan siempre
  libres.

### Pendiente de este paso

- **Marca en las estadísticas (Miembro B).** `lib/analytics/brand.ts` usa todavía
  el nombre del restaurante como marca: falta leer `restaurants.brand_id`.
- **Gestión de marcas y posiciones.** No hay pantalla para crear marcas ni
  para mover un restaurante en el mapa: hoy lo pone el seed.

### Marcas y restaurantes desde /admin

Desde `/admin` → **Marcas y restaurantes**, sin scripts (solo admin, permiso
`catalogo:gestionar`). Los pasos para la dirección están en
`docs/salida-a-produccion.md`, sección 3.2.

- **Marca:** nombre y color. Desactivada, ya no se ofrece para restaurantes
  nuevos; sus restaurantes no cambian.
- **Restaurante:** nombre, marca, ciudad, latitud y longitud (dentro de
  Honduras). La ubicación se escribe o se rellena eligiendo una de las
  ciudades del mapa. Al crearlo nace con una zona vacía, «Comedor principal»,
  y sale de inmediato en el mapa, las estadísticas, los accesos y `/inicio`.
- **Desactivar no borra nada** (`restaurants.active`, migración `0005`, solo
  aditiva):
  - sale del mapa general y de los accesos que se ofrecen;
  - su host pierde el acceso (páginas, API y socket), porque `loadAuthUser`
    solo carga los restaurantes activos;
  - su historial sigue en las estadísticas;
  - la asignación en `user_restaurants` se conserva, así que al reactivarlo el
    host lo recupera.
- En **Acceso** y **Nuevo usuario**, los restaurantes se agrupan por marca,
  con «Marcar todos» por marca y un buscador.
- **Varios restaurantes, un usuario:** `/inicio` muestra una tarjeta por
  restaurante con cuántos esperan, y la cabecera, un selector para cambiar
  entre ellos, que lleva al mismo modo. El modo rápido y el plano en vivo se
  montan de cero al cambiar (`key={id}`), y su socket entra en la room nueva.

| Fichero | Para qué |
| --- | --- |
| `lib/layout/catalog-admin.ts` | Crear, editar y desactivar marcas y restaurantes (sin Next). |
| `lib/layout/catalog-input.ts` | Validación Zod de lo que llega de `/admin`. |
| `app/admin/catalog-actions.ts` | Server actions (`catalogo:gestionar`). |
| `components/admin/admin-catalog.tsx` | La pantalla de marcas y restaurantes. |
| `components/layout/restaurant-switcher.tsx` | El selector de restaurante de la cabecera. |

---

## 17. Datos de demostración

Para probar el mapa, las estadísticas y el asistente sin esperar al piloto, hay
un lote de datos **falsos** que se carga y se borra con un comando:

```bash
npm run db:demo          # carga el lote (pide escribir «si»)
npm run db:demo:borrar   # lo borra (pide escribir «BORRAR»)
```

En producción se corre con `railway run npm run db:demo`; los pasos exactos
están en `docs/despliegue.md`.

### Qué carga

- **Una zona de demostración por restaurante** (los 8 reales), con la sala
  completa: mesas con sillas, una bancada, baños, caja y zona de juegos.
- **Clientes esperando ahora**, con sus minutos de espera y **teléfonos de
  mentira** (`0000-0000-0000`), y una nota que lo dice en cada ficha.
- **Mesas de demostración ocupadas y reservadas**, puestas con `assignTable`, el
  mismo camino que usa un host.
- **Ocho semanas de historial** para que `/analiticas` y el asistente tengan
  algo que contar desde el primer día.

Cargado sobre los 8 restaurantes reales (contado el 1 de octubre de 2026, sin
nada real en la base): **8 zonas de demostración, 86 mesas, 29 clientes esperando,
29 sentados y 6 mesas reservadas, más 12 251 clientes de historial**; 12 403
filas en total. `/analiticas` y el asistente los leen como leen cualquier otra
cosa: no hay atajo para el demo.

Lo que **no** hace nunca: crear ni tocar marcas, restaurantes, el catálogo de
tipos, usuarios o contraseñas, y no toca la zona real ni los planos que alguien
haya dibujado a mano. Los planos del demo son zonas **propias** de cada
restaurante.

Es **idempotente**: correrlo dos veces deja lo mismo que correrlo una, porque
los ids son deterministas y el insert es `ON CONFLICT DO NOTHING`.

### Cómo se distinguen de los reales

Cada fila que crea lleva `is_demo` y `demo_batch_id` (migración `0007`, solo
aditiva, en `table_layouts`, `tables` y `waitlist_entries`). El borrado usa esas
columnas, **nunca el nombre**: renombrar una zona de demostración no la salva del
borrado, ni renombrar una real la mete en el lote.

### Sin interfaz desde el 5 de octubre

A pedido de la dirección, **la interfaz de datos demo se quitó**: ya no hay
aviso «Hay datos de demostración cargados», ni enlace «Datos demo», ni sección
en `/admin`, ni `/admin/datos-demo` (da 404), ni su server action. Lo único
que se ve en la app es la etiqueta **«Demo»** en las cartas del modo sencillo.

**Los datos y el sistema se quedan**: `is_demo`, `demo_batch_id`, `lib/demo`,
`verify:demo`, y los dos comandos (`npm run db:demo` y
`npm run db:demo:borrar`; en producción, con `railway run`). `borrarDemoData()`
(`lib/demo/delete.ts`) sigue siendo el único sitio que borra datos de
demostración: transaccional, solo `is_demo`, y aborta sin escribir nada si algún
dato **real** dependiera de algo de demostración. `npm run db:demo:borrar` pide
escribir `BORRAR`.

### Archivos

| Fichero | Para qué |
| --- | --- |
| `lib/demo/fixtures.ts` | Los datos en sí (planos, nombres, ritmo del historial). Sin base de datos. |
| `lib/demo/load.ts` | `loadDemoData()` (idempotente) y `demoSummary()`. |
| `lib/demo/history.ts` | Las ocho semanas de historial. |
| `lib/demo/delete.ts` | `borrarDemoData()`: solo `is_demo`, en una transacción, y aborta si un dato real depende. |
| `lib/demo/summary.ts` | `demoBreakdown()`: clientes, historial, mesas, zonas y configuraciones de meseros demo por restaurante. |
| `scripts/db-demo.mts`, `scripts/db-demo-borrar.mts` | Los dos scripts de terminal. |
| `components/quick-mode/demo-tag.tsx` | La etiqueta «Demo» de las cartas. |
| `scripts/verify-demo.mts` | `npm run verify:demo`. |

### Qué lo comprueba

`npm run verify:demo` (en CI): migración aplicada, que cargar dos veces es lo
mismo que cargar una, cobertura de los 8 restaurantes, teléfonos de mentira,
estados variados, las 8 semanas de historial, que `/analiticas` los lee como
cualquier otro dato, que **no toca nada real**, que **aborta** si un cliente
real dependiera de una mesa de demostración, el borrado (todo o por
restaurante), que lo real sobrevive y que se puede recargar.

`npm run verify:auth` levanta la app de verdad y comprueba que **no queda ningún
rastro de la interfaz** para ningún rol (ni el aviso, ni el enlace, ni la
sección, ni `/admin/datos-demo`, ni la server action) y que los datos demo
siguen ahí y se ven en las estadísticas y en las cartas con su etiqueta.

---

## 18. Zonas de meseros (requisito del enunciado)

> «Manejo de zonas de meseros, guardar configuración por cantidad de meseros
> activa y la opción de cambiar entre configuración de zonas fácilmente.»

Cada restaurante guarda varias **configuraciones de meseros** («2 meseros»,
«3 meseros», «4 meseros»…) y **una está activa**. Cada configuración reparte
las mesas del restaurante entre N meseros, cada uno con su **nombre** (o
número) y su **color**. Se cambia de una a otra con **un toque**.

### Qué se ve

- **Plano en vivo** (`/restaurante/[id]/mapa`): el contador **«Meseros
  activos: [−] 3 [+]»** arriba, y cada mesa teñida del color de su mesero
  con su nombre encima. Debajo, la leyenda: cada mesero con sus mesas y
  cuántas quedan «sin mesero». Los botones **[−] y [+]** (44×44 px) bajan y
  suben la cantidad de meseros: activan la configuración de ese número y, si
  todavía no existe, **la crean con las mesas ya repartidas** y la activan.
  No se puede bajar de 1 ni subir de `MAX_WAITERS` (12), y el cambio llega a
  las demás tablets por el socket.
- **Editar zonas** (botón del plano en vivo, o «Repartir meseros»
  desde el editor, que abre `?meseros=editar`): nombre de la configuración,
  nombre y color de cada mesero, y un **pincel**: se elige un mesero y se
  tocan sus mesas (tocar otra vez se la quita). **«Selección en grupo»**
  cambia el arrastre por un rectángulo que asigna todas las mesas que atrapa.
  **«Repartir automáticamente»** reparte en bloques de mesas vecinas, con el
  mismo número de mesas por mesero (como mucho una de diferencia).
  **«Nueva con N meseros»** crea una configuración ya repartida.
- **Editor** (`/restaurante/[id]/editor`): el mismo selector, **«Ver
  meseros»** para teñir las mesas como en el plano en vivo, y el enlace para
  repartirlas. El reparto se edita en el plano en vivo a propósito: allí un
  toque no mueve la mesa.
- **Modo sencillo**: al **sentar**, cada mesa del selector dice su mesero, y
  el aviso dice «Ana se sentó en Mesa 4. **Lo atiende Luis.**». En «Ver todas
  las cartas», los sentados dicen quién los atiende.
- **Estadísticas**: «Clientes atendidos por mesero» (grupos y personas de los
  últimos 14 días) y el asistente contesta «¿cuántos clientes atendió cada
  mesero?». Hacia OpenRouter los meseros viajan con alias («Mesero R1»…).

### Tiempo real

Activar, guardar o borrar una configuración emite **`waiters:changed`** a la
room del restaurante: todas sus tablets (editor y plano en vivo) se repintan
al instante. Analítica, que no entra en las rooms, se entera por la sala
`overview`: los contadores llevan `waitersKey` (id y versión de la activa; no
dice nada de ningún cliente), y su plano se recarga cuando cambia.

### Cómo está hecho

| Pieza | Qué hace |
| --- | --- |
| Migración `0009` (solo aditiva) | Tablas `waiter_configs` (con `is_active`, `version`, `save_token`, `is_demo`), `waiter_zones` (mesero y color) y `waiter_zone_tables` (mesa → zona, una por configuración), y la columna `waitlist_entries.waiter_name`. |
| `lib/waiters/configs.ts` | Listar, crear (ya repartida), guardar, activar y borrar. Comprueba que la configuración, las zonas y las mesas sean de **ese** restaurante, y que las mesas admitan clientes. |
| `lib/waiters/balance.ts` | `autoBalance` (puro) y la paleta de colores. Lo usan el servidor y el navegador. |
| `app/restaurante/[id]/meseros/actions.ts` | Server actions: Zod → `meseros:gestionar` → `lib/waiters` → `waiters:changed`. |
| `components/waiters/waiter-zones.tsx` | Selector, leyenda y panel de edición. |
| `lib/tables/assign.ts` | Al sentar, apunta en `waiter_name` el mesero de la mesa en la configuración activa, **en el mismo UPDATE** que sienta al cliente. |

### Decisiones que conviene no deshacer sin pensarlo

- **Una sola activa por restaurante**, garantizado por un índice único
  parcial (`waiter_configs_one_active_idx`). Activar desmarca y marca en un
  batch.
- **Se guarda el nombre del mesero en el cliente**, no un id: las
  estadísticas siguen valiendo aunque luego se cambie o se borre la
  configuración.
- **Guardar es un solo batch con bloqueo optimista.** La primera sentencia
  sube la versión solo si sigue siendo la del navegador y deja su marca
  (`save_token`); las demás solo actúan con esa marca. Dos tablets que
  guardan a la vez: gana una y la otra recibe «Otro dispositivo cambió esta
  configuración». Con transacciones interactivas, la segunda se bloqueaba.
- **El reparto no toca `tables`**: ni la estructura ni la ocupación. Si el
  editor borra una mesa, sale de su zona sola (`ON DELETE CASCADE`).

### Permisos

Crear, editar, borrar y activar: **`meseros:gestionar`**, del admin (todos)
y del rol restaurante (los suyos). Analítica las **ve** (selector, colores y
leyenda) pero no las cambia. Tabla completa en `docs/rbac.md`.

### Seed y datos de demostración

- `npm run db:seed` crea «2 meseros» (activa) y «3 meseros» en `rest_centro`
  (Ana, Luis, Marta) y `rest_norte` (Carlos, Sofía, Diego), solo si no tienen
  ninguna.
- `npm run db:demo` crea «2 meseros» y «3 meseros» de ejemplo, marcadas
  `is_demo`, en los restaurantes que **no** tengan ya una, y apunta mesero
  al historial demo. Las borra `npm run db:demo:borrar` (si la borrada
  era la activa, pasa a activa la siguiente que quede).

### Qué lo comprueba

- `verify:editor`: reparto automático, Zod, crear, activar (una sola),
  guardar con sus reglas (otra mesa, un baño, mesa repetida, zona ajena,
  versión vieja), que el reparto no toca las mesas y que borrar una mesa la
  saca de su zona.
- `verify:realtime`: el mesero en el ack y en el aviso al sentar, el reenvío
  offline, `waiters:changed`, `waitersKey`, dos activaciones a la vez y dos
  guardados a la vez.
- `verify:auth`: quién ve y quién cambia (por página y por server action),
  y que el cambio llega a la otra tablet por el socket.
- `verify:demo`: configuraciones de ejemplo, mesero en el historial y borrado.

---

## 19. Plano por defecto y estructura de cada restaurante (requisito del enunciado)

> «La configuración de las mesas por defecto en cada restaurante, las
> actualizaciones de la estructura de las mesas las hacen los usuarios de
> los restaurantes.»

- **Cada restaurante tiene un plano por defecto**: la zona que se abre al
  entrar en el editor y en el plano en vivo. Un restaurante nuevo nace con su
  «Comedor principal» por defecto; si unos datos viejos no tuvieran ninguna,
  `ensureDefaultLayout` marca la primera al abrir el editor o el plano.
- **El editor la marca**: «★ Por defecto» en la zona que lo es, y
  **«Marcar por defecto»** en las demás (`setDefaultLayoutAction`). Una sola
  por restaurante (índice único parcial `table_layouts_one_default_idx`).
- **La estructura la editan los usuarios del restaurante**: mover, añadir,
  borrar, girar, **copiar y pegar** (Ctrl+C / Ctrl+V, o «Copiar», «Pegar» y
  «Duplicar», también entre zonas) y elegir el plano por defecto. Todo con
  `editor:guardar`: el rol restaurante en **los suyos** y el admin en todos;
  analítica no.
- Lo comprueban `verify:editor` (una sola por defecto, zona de otro
  restaurante, `ensureDefaultLayout`) y `verify:auth` (centro elige la suya,
  norte y analítica no, y el editor abre la nueva).
