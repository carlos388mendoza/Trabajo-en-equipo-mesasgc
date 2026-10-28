# Respaldo y restauración de la base de producción (Turso)

La base de producción es **Turso `mesasgc-prod`**. Este documento explica
cómo sacar un respaldo y cómo volver a ponerlo en marcha si algo sale mal.

> **Los respaldos tienen datos REALES de clientes** (nombres, teléfonos,
> notas) y las sesiones abiertas. Se guardan en un sitio privado (una carpeta
> cifrada o un disco del equipo), **nunca** en el repositorio, en un chat o
> en un correo, y se borran cuando ya no hacen falta.

## 1. Sacar un respaldo (desde Windows, sin la CLI de Turso)

El guion `npm run db:respaldo` lee la base **solo con `SELECT`** (nunca
escribe en ella) y la copia entera, esquema y filas, a un archivo SQLite
nuevo. Al terminar enseña cuántas filas tiene cada tabla en el origen y en la
copia: tienen que coincidir.

Con las variables de producción en un archivo temporal `.env.produccion`
(ver `docs/entrega-empresa.md`, «Comandos contra producción»):

```powershell
npx dotenv-cli -e .env.produccion -- npm run db:respaldo -- C:\Respaldos\mesasgc-2026-10-12.respaldo.db
```

- Se recomienda **uno antes de cada publicación a producción** con migraciones,
  y uno a la semana durante el piloto.
- El guion nunca pisa un archivo que ya existe.
- Dentro del repositorio, la carpeta `respaldos/` y los `*.respaldo.db` están
  en `.gitignore`.

**Comprobado el 12 de octubre de 2026** con la base de producción:

- 17 tablas y 12 940 filas, con los conteos iguales en origen y copia.
- La app arrancó en local con esa copia: `/api/health` y `/login` respondieron
  200.
- Las consultas de la app (contadores del mapa, estadísticas y mesas) dieron
  los mismos conteos que producción.
- La migración pendiente (`0010`) se aplicó sobre la copia sin problemas.
- La copia se borró al terminar.

## 2. Restaurar

**Nunca se restaura encima de la base de producción.** Se crea una base
**nueva** con el respaldo y se cambia la app para que use esa. Si algo sale
mal, se vuelve a la base anterior cambiando las mismas dos variables.

### Opción A: desde la web de Turso (recomendada en Windows)

1. Entra en [app.turso.tech](https://app.turso.tech) con la cuenta del
   Miembro A.
2. **Create Database**: elige la opción de crearla **desde un archivo**
   (importar un SQLite) y sube el `.respaldo.db`. Ponle un nombre nuevo, por
   ejemplo `mesasgc-restaurada-2026-10-12`, en la misma región
   (`aws-us-east-1`).
3. En la base nueva, copia su **URL** (`libsql://…`) y crea un **token** de
   acceso.
4. En Vercel → proyecto `mesasgc-demo` → **Settings → Environment Variables**
   (entorno Production), cambia `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` por
   los de la base nueva y haz **Redeploy** del último despliegue de Production.
5. Comprueba que `/api/health` y `/login` respondan 200, que puedas entrar y
   que el plano y la lista de espera se vean bien.

> Los nombres exactos de los botones de la web de Turso pueden cambiar. Si no
> aparece la opción de importar un archivo, usa la opción B desde otra
> computadora (macOS, Linux o Windows con WSL), o pide ayuda al equipo.

### Opción B: con la CLI de Turso (macOS, Linux o WSL)

```bash
turso db create mesasgc-restaurada-2026-10-12 --from-file mesasgc-2026-10-12.respaldo.db
turso db show mesasgc-restaurada-2026-10-12 --url
turso db tokens create mesasgc-restaurada-2026-10-12
```

Después, los pasos 4 y 5 de la opción A.

### Opción C: volver a un momento anterior (sin archivo)

Turso guarda el historial de la base durante unos días, según el plan.
Permite crear una base **nueva** tal como estaba en un momento dado, por
ejemplo justo antes de un despliegue malo:

```bash
turso db create mesasgc-antes-del-fallo --from-db mesasgc-prod --timestamp 2026-10-12T15:00:00Z
```

Después, los pasos 4 y 5 de la opción A.

## 3. Probar un respaldo sin tocar producción

Así se comprobó el del 12 de octubre (todo en local, en una carpeta privada):

1. Saca el respaldo (sección 1).
2. Aplícale las migraciones pendientes, solo a la copia:

   ```bash
   TURSO_DATABASE_URL=file:C:/Respaldos/copia.respaldo.db TURSO_AUTH_TOKEN= npx drizzle-kit migrate
   ```

3. Levanta la app contra la copia, en otro puerto y con su propio build:

   ```bash
   TURSO_DATABASE_URL=file:C:/Respaldos/copia.respaldo.db TURSO_AUTH_TOKEN= PORT=3300 BETTER_AUTH_URL=http://localhost:3300 NEXT_DIST_DIR=.next-respaldo OPENROUTER_API_KEY= npx tsx server.ts
   ```

4. Comprueba que `http://localhost:3300/api/health` y `/login` respondan 200.
5. Para la app y **borra la copia** y la carpeta `.next-respaldo`.
