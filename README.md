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
| `restaurants` | Los locales. `slug` para la URL. |
| `table_layouts` | Zonas/vistas del local (comedor, terraza). Es la unidad sobre la que trabaja el editor y la galería. `version` sube en cada guardado. |
| `element_types` | Catálogo de los 5 tipos (mesa-sillas, mesa-butacas, area-juegos, bano, caja) con color, ícono y tamaño. Editable sin deploy. |
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
cp .env.example .env.local   # y llenar TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
npm install
npm run db:push              # aplica el esquema
npm run db:seed              # tipos de elemento + 2 restaurantes de ejemplo
```

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
| `components/editor/editor-client.tsx` | Estado del editor y **el `dynamic({ ssr: false })` de Konva**. |
| `components/editor/konva-canvas.tsx` | Stage, pan, zoom y retícula. |
| `components/editor/element-node.tsx` | Un elemento (memoizado, con sus sillas). |
| `components/editor/element-palette.tsx` | Paleta con drag & drop HTML5. |

### Por qué el `dynamic` está donde está

Konva toca `document` y el canvas 2D en el momento de importarse, así que no
puede ejecutarse en el servidor. Next 15+ además prohíbe `ssr: false` dentro de
un Server Component, y `page.tsx` lo es. Por eso el `dynamic` vive en
`editor-client.tsx`, que es un Client Component. El resultado verificado: en el
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
- **`rotation` se queda a 0.** El `Transformer` va con `rotateEnabled: false`
  porque los tipos no traen ángulo; la columna está para el paso 4.

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
- Sin deshacer (Ctrl+Z): todavía no existe.

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

### Archivos

| Fichero | Para qué |
| --- | --- |
| `server.ts` | Next + Socket.IO en un solo `http.Server`. |
| `lib/realtime/events.ts` | El contrato: tipos de los eventos y schemas Zod. |
| `lib/realtime/server.ts` | Rooms y handlers. No importa nada de Next. |
| `lib/realtime/registry.ts` | `io` en `globalThis`, para emitir desde las actions. |
| `lib/realtime/auth.ts` | Permisos del socket. **Único sitio a tocar con Better Auth.** |
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

### Pendiente de este paso

- Better Auth: `lib/realtime/auth.ts` deja pasar a todos. El TODO dice qué
  poner: la sesión desde la cookie del handshake y `canAccessRestaurant`.
- Copiar una zona suelta (`copyZoneIntoAnother`) no avisa: no tiene interfaz
  todavía y su resultado no trae el restaurante de destino.
- El guardado del editor no comprueba la versión de la zona: si dos personas
  guardan a la vez, gana la última. El editor avisa, pero no lo impide.
- En Windows, `@libsql/client` necesita el *Visual C++ Redistributable*
  (`vcruntime140.dll`). Sin él, ni `server.ts` ni los `verify:*` arrancan.
