# Table Waitlist

Aplicación en tiempo real para el manejo de listas de espera de clientes en restaurantes: estructura de mesas por local, modo rápido de check-in/check-out, roles con permisos distintos, estadísticas y un asistente de IA para consultas en lenguaje natural.

**Plazo:** 1 semana.

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
| **Usuario de restaurante** | Accede solo a su restaurante, modos sencillo y completo |
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
`npm run db:migrate`. El primer admin de producción se crea con
`npm run create-admin` (sección 15).

Otros scripts: `db:generate` (genera SQL en `drizzle/`), `db:studio`,
`seed:reset` (borra los datos de layout y vuelve a sembrar; **no** toca las
cuentas de usuario), `verify:editor` (44 comprobaciones del editor contra una
base de datos temporal), `lint`, `typecheck`.

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
| `components/editor/element-palette.tsx` | Paleta con drag & drop HTML5. |

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

Las estadísticas (`/analiticas`) se calculan en `/api/analiticas` sobre los
registros reales: grupos sentados durante los últimos 14 días (zona
`America/Tegucigalpa`), espera desde `arrived_at` hasta `seated_at`, comparación con los 14 días anteriores,
resumen diario y agrupación por restaurante. Sin registros, la interfaz indica
que todavía no hay actividad; no presenta cifras de demostración.

El asistente (`/api/assistant`) recibe ese resumen para contestar preguntas en
español. Si se configura `OPENROUTER_API_KEY`, consulta OpenRouter; sin esa
clave, responde localmente las preguntas comunes sobre espera y volumen. La
clave se define solo en `.env.local` y no se envía al navegador.

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
más lento, top 10 de clientes y filtros por restaurante y marca (la búsqueda
de marca coincide con el nombre del restaurante disponible en el esquema).
El tiempo hasta avisar se calcula desde `arrived_at` hasta `called_at` para
clientes avisados durante el período.

## 12. Aspecto del editor (tablet)

El editor está pensado para usarse con el dedo en una tablet:
- Botones de al menos 44 px, con ícono y un texto corto debajo.
- Zoom pellizcando con dos dedos.
- Tiradores grandes para redimensionar.
- Tocar un elemento de la paleta lo añade en el centro de lo que se ve.

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
- **Barra de herramientas:** Guardar, Deshacer (también con Ctrl+Z), Girar el
  plano ↺ ↻, Copiar plano, Alejar, Acercar y Ajustar. Al lado, el indicador
  «En vivo».

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
- **Las sombras solo van en el cuerpo del elemento.** En Konva son caras, y
  con 40 mesas se nota.

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
- Comprueba 92 cosas: login correcto e incorrecto; cada rol solo en lo suyo,
  por página, API, server action y socket; sin sesión, 401 o `/login`; y que
  un usuario desactivado ya no entra.
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
| `centro@grupocomidas.test` | Host Centro | restaurante | rest_centro |
| `norte@grupocomidas.test` | Host Norte | restaurante | rest_norte |
| `analitica@grupocomidas.test` | Analista | analitica | todos (solo lectura) |
| `gerente@grupocomidas.test` | Gerente Centro | restaurante, analitica | rest_centro |

`rest_centro` es **China Wok Centro** (Tegucigalpa) y `rest_norte` es **Pizza
Hut Norte** (San Pedro Sula): conservan sus ids, así que estos usuarios siguen
valiendo. Los otros 6 restaurantes del mapa no tienen host de prueba.

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

- **Mapa propio.** Es un dibujo en SVG (`lib/map/world.ts`), sin mapas reales
  ni imágenes de terceros: San Pedro Sula arriba a la izquierda y Tegucigalpa
  abajo a la derecha, con sus distritos y la CA-5. Los colores salen del tema.
- **Un marcador por restaurante**, del color de su marca:
  - el número de clientes en espera;
  - un anillo con el % de mesas ocupadas;
  - debajo, la espera media actual.
- **Alerta de espera.** Se distingue también por la forma, no solo por el
  color:
  - más de 20 min: halo amarillo que pulsa y un triángulo;
  - más de 40 min: halo rojo más grueso y más rápido, y un octógono.

  Con «reducir movimiento» del sistema, el halo se queda quieto.
- **Filtros y lista.** Se filtra por marca y por ciudad, y hay una leyenda. La
  lista lateral ordena los restaurantes por espera.
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

### Archivos

| Fichero | Para qué |
| --- | --- |
| `lib/map/counters.ts` | Contadores por restaurante, espera media y umbrales (20 y 40 min). |
| `lib/map/queries.ts` | Restaurantes con su marca y `getLivePlan` (quita los nombres si no hay `plano:clientes`). |
| `lib/map/world.ts` | El dibujo: ciudades, distritos y carretera. |
| `lib/realtime/overview.ts` | `emitOverview`. |
| `app/mapa/page.tsx`, `app/mapa/actions.ts` | Página y actions (`loadOverviewCounters`, `loadLivePlan`). |
| `app/restaurante/[id]/mapa/page.tsx` | Plano en vivo de un restaurante. |
| `components/map/world-map.tsx` | Mapa, marcadores, filtros, lista y zoom. |
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
