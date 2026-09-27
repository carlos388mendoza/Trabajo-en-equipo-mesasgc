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

`npm run db:push` va a través de `scripts/db-push.mjs` y no llama a drizzle-kit
directo, porque en la versión 0.20 el subcomando `push:sqlite` ignora el campo
`schema` de `drizzle.config.ts` y aborta. El script arma los flags que pide.

Otros scripts: `db:generate` (genera SQL en `drizzle/`), `db:studio`,
`seed:reset` (borra los datos de layout y vuelve a sembrar; **no** toca las
cuentas de usuario).
