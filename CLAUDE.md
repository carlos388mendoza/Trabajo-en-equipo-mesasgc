@AGENTS.md

# Table Waitlist

Aplicación en tiempo real para manejar listas de espera de clientes en
restaurantes: estructura de mesas por local (editor tipo mapa), modo rápido de
check-in/check-out, roles con permisos distintos, estadísticas y un asistente
de IA. Toda la interfaz y los valores de la base de datos están en **español**
(`libre`, `esperando`, `mesa-sillas`...). El README es la documentación larga:
léelo antes de tocar el esquema, el editor o la copia de estructuras.

## Quién soy yo

Soy el **Miembro A**. Mis áreas son:

1. **Editor de mesas**: drag & drop con `react-konva`, copiar la estructura a
   otro restaurante, galería de zonas (rotación de configuraciones).
2. **Tiempo real**: servidor Socket.IO con una *room* por `restaurantId`, así
   cada restaurante recibe solo sus eventos de asignación de mesa.
3. **Manejo de conflictos**: bloqueo optimista, donde gana el primer evento que
   llega al servidor.

El Miembro B se encarga del modo rápido (`/restaurante/[id]/rapido`), el
Ctrl+Z, las estadísticas y la IA. Auth, CI/CD y el esquema completo son
trabajo de los dos. No toques el código del Miembro B salvo que te lo pida.

## Stack

| Capa | Tecnología | Estado |
|---|---|---|
| Frontend + rutas | Next.js (App Router) + React 19 + TypeScript | Instalado: **Next 16** (se actualizó desde 14 en `f459a92`) |
| Base de datos | Turso (libSQL) | Instalado |
| ORM / migraciones | Drizzle ORM 0.45 + drizzle-kit 0.31 | Instalado |
| Auth y roles | Better Auth | Pendiente: las tablas ya están en el schema, falta el paquete |
| Tiempo real | Socket.IO | Pendiente: solo están las variables en `.env.example` |
| Canvas | `konva` + `react-konva` | Instalado |
| Validación | Zod 4 | Instalado |
| Estilos | Tailwind 3 | Instalado |

**Next 16 no es el Next que conoces** (ver `AGENTS.md`). Antes de escribir
código de Next, lee la guía en `node_modules/next/dist/docs/`. Ejemplos de lo
que ya cambió en este repo: `params` es una `Promise`, `next lint` ya no
existe (se usa `eslint` directo) y `dynamic({ ssr: false })` no se puede usar
dentro de un Server Component.

## Comandos

```bash
npm run dev            # Next en :3000
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (flat config)
npm run verify:editor  # comprobaciones del editor y de la copia contra una SQLite temporal
npm run db:generate    # genera SQL en drizzle/
npm run db:push        # aplica el esquema a TURSO_DATABASE_URL (¡base real!)
npm run db:seed        # tipos de elemento + 2 restaurantes de ejemplo
npm run seed:reset     # borra los layouts y vuelve a sembrar (no toca usuarios)
```

No hay runner de tests. `scripts/verify-editor.mts` hace ese papel: sale con
código 1 si algo falla. Si cambias `lib/layout/*`, córrelo y añade
comprobaciones ahí. Nunca le añadas `drizzle-kit push`, porque leería el
`TURSO_DATABASE_URL` del entorno y podría vaciar una base de verdad.

## Estructura

```
app/restaurante/[id]/editor/page.tsx     Server Component: carga zona, catálogo y elementos
app/restaurante/[id]/editor/actions.ts   Server actions: Zod → permisos → lib → revalidatePath
components/editor/                       Cliente: editor-client, lazy-konva-canvas (dynamic de Konva), canvas, nodos, paleta, diálogo de copia
components/map/                          Mapa general (SVG), plano en vivo (Konva en solo lectura) y socket de la sala overview
lib/map/                                 Contadores agregados, dibujo del mapa y lecturas del plano en vivo, sin nada de Next
lib/db/schema.ts                         Todo el esquema Drizzle (un solo archivo a propósito)
lib/db/enums.ts                          Única fuente de verdad de roles, tipos y estados
lib/db/index.ts                          `db`: proxy perezoso, se conecta en el primer uso
lib/db/queries/                          Lecturas
lib/layout/save.ts, copy.ts              Escritura y reglas de integridad, sin nada de Next
lib/layout/validation.ts                 Schemas Zod de los payloads
scripts/seed.ts, verify-editor.mts       Seed y verificación
```

## Convenciones de código

- **Las server actions son una capa fina.** Solo validan con Zod, comprueban
  permisos, delegan en `lib/` y revalidan. La lógica de BD va en `lib/`, sin
  importar nada de Next, para poder probarla desde un script.
- **Todo lo que llega a una action es no confiable.** Ocultar un botón no es
  una barrera de seguridad. `assertCanEditRestaurant` en `actions.ts` es por
  ahora un placeholder hasta que se monte Better Auth.
- **Compara contra las constantes de `lib/db/enums.ts`**, nunca contra strings
  sueltos. Nada de `enum` de TypeScript.
- **Sin `check()` constraints en el schema** (libSQL no los soporta); valida en
  el servidor con Zod.
- **`db` solo se importa en el servidor**, nunca en un Client Component.
- Konva solo se carga con el `dynamic({ ssr: false })` de
  `components/editor/lazy-konva-canvas.tsx` (lo usan el editor y el plano en
  vivo).
- La densidad y el tono de los comentarios siguen el código actual: en
  español, explicando el *porqué* de las decisiones que no son obvias.

## Tiempo real y conflictos (mi parte pendiente)

Cómo está pensado, según el README y el schema:

1. El frontend emite el evento de asignación **sin actualizar la UI todavía**.
2. El servidor asigna con un único
   `UPDATE tables SET current_entry_id = ?, status = 'ocupada', version = version + 1 WHERE id = ? AND current_entry_id IS NULL`,
   en la misma transacción que actualiza `waitlist_entries.assigned_table_id`.
3. Si afecta 1 fila, emite el evento a toda la room `restaurantId`.
4. Si afecta 0 filas, otro host se adelantó: responde **solo al que falló**
   con "Esta mesa ya fue asignada" y ese cliente se refresca.

Piezas que ya existen para esto:

- `tables.currentEntryId`: el puntero de ocupación.
- `tables.version`: bloqueo optimista al mover.
- `table_layouts.version`: sube en cada guardado, para que otros dispositivos
  sepan que el layout cambió.
- El índice único `tables_current_entry_unique`, como red de seguridad.

Para Socket.IO, `.env.example` prevé un servidor Node custom en `PORT=3001`
(`NEXT_PUBLIC_SOCKET_URL`), desplegado en Railway.

**El editor nunca escribe `status` ni `current_entry_id`**, y una mesa ocupada
no se puede borrar desde el editor. `verify:editor` lo comprueba; no lo
rompas.

## Reglas del equipo (obligatorias)

- **Nunca trabajes ni hagas push a `main`.** Tampoco trabajes directo en
  `testing`.
- **Crea cada rama desde `testing` actualizada**, con el prefijo `feat/`
  (o `fix/` / `docs/` según el tipo): `git switch testing && git pull`, y
  luego `git switch -c feat/<nombre>`.
- **Los PR van siempre hacia `testing`**, nunca hacia `main`. Menciona el
  Issue que resuelven (`Closes #N`). Solo el PR final `testing` → `main`
  dispara el deploy, y ese no lo abras por tu cuenta.
- **Cómo se revisa un PR (desde el 30 de septiembre de 2026).** El Miembro B
  ya terminó, así que el ruleset `proteger-main-testing` pide **0
  aprobaciones**. Sigue pidiendo PR, el check «Typecheck, lint, build y
  verificaciones», y prohíbe borrar la rama y el force push. En cada PR:
  1. **No** pongas a `vbgjptt89g-beep` como revisor.
  2. Haz tú la revisión de código (bugs, seguridad, secretos y cumplimiento
     del enunciado) y déjala como **comentario en el PR**.
  3. Corre `typecheck`, `lint`, `build` y los tres `verify`.
  4. Fusiona (merge normal) solo con el CI en verde y sin problemas abiertos
     en tu revisión.
  5. **PR hacia `main`:** avisa a Carlos y espera su «sí» antes de fusionar.
- **Los commits llevan prefijo `feat:`, `fix:`, `docs:`, `chore:`, `test:` o
  `perf:`**, con un scope opcional (`feat(editor): ...`). Hazlos pequeños y
  descriptivos.
- **Nunca subas `.env.local`** ni ningún secreto. Está en `.gitignore`: no lo
  fuerces con `git add -f`. Si hace falta una variable nueva, añádela vacía a
  `.env.example` con un comentario.
- Antes de hacer commit o push, confirma en qué rama estás (`git branch
  --show-current`). Si estás en `main` o en `testing`, crea una rama primero.
