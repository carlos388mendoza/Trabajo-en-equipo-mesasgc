# Entrega a la empresa: Table Waitlist

Guía simple para quien se quede a cargo de la app. Fecha: 28 de octubre de 2026.

> Regla de oro: **nunca escribas contraseñas, tokens ni llaves en el repositorio, en chats ni en correos.**
> Se guardan solo en los paneles de cada servicio (Vercel, Turso, OpenRouter) o en un administrador de contraseñas.

## 1. Qué es

**Table Waitlist** maneja la lista de espera y las mesas de los restaurantes de Grupo Comidas, en tiempo real:
cada local ve y asigna sus mesas, hay un mapa general, estadísticas y un asistente de IA. Tiene roles
(admin, restaurante, analítica). Toda la interfaz está en español.

**Link oficial:** https://mesasgc-demo.vercel.app

## 2. Servicios que usa

| Servicio | Para qué | Dónde |
|---|---|---|
| **GitHub** | El código (repo `carlos388mendoza/Trabajo-en-equipo-mesasgc`), las revisiones (PR) y las pruebas automáticas (Actions) | github.com |
| **Vercel** | Aloja la app (proyecto `mesasgc-demo`). Publica solo al fusionar a la rama `main` | vercel.com |
| **Turso** | La base de datos. `mesasgc-prod` es la real; `mesasgc-preview` es de pruebas | turso.tech |
| **OpenRouter** | El modelo de IA del asistente de estadísticas (se paga por uso) | openrouter.ai |

## 3. Variables necesarias (solo nombres)

Se configuran en Vercel → proyecto → Settings → Environment Variables. **Production** usa la base real y
**Preview** usa `mesasgc-preview`: nunca pongas la base real en Preview (el build lo bloquea).

| Variable | Para qué |
|---|---|
| `TURSO_DATABASE_URL` | Dirección de la base |
| `TURSO_AUTH_TOKEN` | Llave de acceso a esa base |
| `BETTER_AUTH_SECRET` | Firma las sesiones. Única, larga y distinta en Production y en Preview |
| `BETTER_AUTH_URL` | La URL de la app (Production). En Preview puede ir vacía |
| `OPENROUTER_API_KEY` | Llave del asistente de IA |
| `OPENROUTER_MODEL` | Modelo que usa el asistente |
| `CRON_SECRET` | Protege la tarea diaria de limpieza (`/api/cron/retencion`) |
| `LEAKED_PASSWORDS` (opcional) | Contraseñas ya filtradas que «Revisar contraseñas» debe buscar, separadas por comas |

En tu computadora (archivo `.env.local`, que **no** se sube al repo): las mismas, más `SEED_PASSWORD`
(la contraseña de los usuarios de prueba del seed; cualquiera, solo para desarrollo). Hay un modelo en `.env.example`.

## 4. Cómo publicar cambios

1. `git switch testing && git pull`, y una rama nueva: `git switch -c feat/<nombre>` (o `fix/`, `docs/`).
2. Haz los cambios y corre `npm run typecheck`, `npm run lint` y los `verify:*` que apliquen.
3. Abre un **PR hacia `testing`** y espera el check «Typecheck, lint, build y verificaciones» en verde. Fusiona.
4. Prueba la Preview de `testing` (Vercel la crea sola; pide iniciar sesión en Vercel).
5. Cuando todo esté bien, abre un **PR `testing` → `main`**, con el CI en verde, y fusiona. Eso publica a Production.
6. Comprueba `https://mesasgc-demo.vercel.app/api/health` y `/login` (deben dar 200) y recarga la app con Ctrl+F5.

Nunca se trabaja ni se hace push directo a `main` ni a `testing` (están protegidas).

## 5. Respaldos y restauración

La base real tiene datos de clientes: **los respaldos se guardan en un sitio privado, nunca en el repositorio.**

- **Respaldar** (solo lee, nunca escribe): ver [`docs/respaldos.md`](respaldos.md). Resumen: crear el archivo
  temporal `.env.produccion` con `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` de producción, correr
  `npx dotenv-cli -e .env.produccion -- npm run db:respaldo -- C:\Respaldos\mesasgc-FECHA.respaldo.db`,
  comprobar que los conteos coinciden y **borrar `.env.produccion`**.
- **Cuándo:** antes de cada publicación con migraciones y una vez por semana.
- **Restaurar:** crear una base nueva en Turso, cargar el respaldo, cambiar `TURSO_DATABASE_URL` y
  `TURSO_AUTH_TOKEN` en Vercel (Production) y hacer **Redeploy**. Pasos completos en `docs/respaldos.md`.
- Turso también guarda versiones anteriores de la base según el plan: míralo en su panel.

### Comandos contra producción

Los scripts (`create-user`, `reset-password`, `db:respaldo`…) leen `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`.
Para correrlos contra producción: crea `.env.produccion` (está ignorado por git) con esas dos variables,
usa `npx dotenv-cli -e .env.produccion -- npm run <script>` y borra el archivo al terminar.
**No corras `db:seed`, `seed:reset` ni `db:push` contra producción.**

## 6. Usuarios y contraseñas

En la app, como admin: **/admin → Usuarios**.
- **Nuevo usuario:** correo, nombre, rol y restaurantes. Se genera una contraseña temporal.
- **Contraseña:** «Generar otra» (o escribe una) y «Restablecer contraseña». Cierra sus sesiones.
  «Eliminar contraseña» deja la cuenta sin poder entrar hasta que le pongas una nueva.
- **Desactivar / Activar:** no borra nada. La flechita junto a Desactivar tiene **Eliminar cuenta**
  (pide escribir el correo; no se puede eliminar a uno mismo ni al único admin activo).
- **Revisar contraseñas:** busca usuarios que usen una contraseña pública o filtrada.
- Si nadie puede entrar a /admin: `npm run reset-password` y `npm run create-user` (ver
  [`docs/manual-admin.md`](manual-admin.md), sección 5) con las variables de producción.

Pide a cada persona una contraseña larga y propia, y compártela por un canal privado.

## 7. Límites gratis y cuándo pasar a Vercel Pro

Detalle y cuentas en [`docs/consumo-turso-sondeo.md`](consumo-turso-sondeo.md). Resumen (límites leídos el
28 de octubre de 2026; confírmalos en cada panel):

| Servicio | Gratis | Con el uso real (≈ 20 pantallas, 12 h al día) |
|---|---|---|
| Vercel Hobby | 1 M de invocaciones al mes, 4 h de CPU activa; **solo uso no comercial** | ≈ 5,6 M de invocaciones: **no alcanza** |
| Turso gratis | 500 M de filas leídas y 10 M escritas al mes, 5 GB | ≈ 28–73 M leídas: alcanza |
| OpenRouter | Pago por uso | Depende de cuánto se use el asistente |

**Hay que pasar a Vercel Pro ahora**, con la cuenta a nombre de la empresa: Hobby es solo para uso personal y
no comercial, y el consumo real lo supera. Pro cuesta unos 20 USD por asiento al mes más uso (≈ 6 USD del sondeo).
Si el consumo vuelve a ser un problema, la opción es cambiar el tiempo real a Pusher o Ably (baja las invocaciones ≈ 95 %).

## 8. Dónde ver los logs si se cae

1. Prueba `/api/health` en el navegador: debe decir `{"ok":true}`. Si no responde, es la app o Vercel.
2. **Vercel** → proyecto `mesasgc-demo` → **Logs** (errores de la app; en Hobby se guardan 1 hora, en Pro 1 día)
   y **Deployments** (si el último despliegue falló, el log de build dice por qué; «Redeploy» o «Rollback»
   a uno anterior que funcionaba).
3. **Turso** → la base `mesasgc-prod` → estado y uso (si se acabó un límite o el token expiró).
4. **GitHub** → Actions: si el CI falló, el PR no se puede fusionar.
5. Si falla el inicio de sesión de todos: revisa `BETTER_AUTH_SECRET` y `BETTER_AUTH_URL` en Vercel.
6. Plan B: restaurar el último respaldo (sección 5).

## 9. Lista para transferir las cuentas a la empresa

Hazla con calma y en este orden. Marca cada punto cuando esté hecho y verificado.

- [ ] **GitHub:** crear (o usar) la organización de la empresa y transferir el repositorio (Settings → Danger
      zone → Transfer ownership). Repasar las reglas de `main` y `testing`, los colaboradores y los secretos del repo.
      El repositorio es **público**: confirmar con la empresa que así debe seguir.
- [ ] **Vercel:** crear el equipo Pro de la empresa y transferir el proyecto `mesasgc-demo` (Settings → Transfer),
      o crearlo de nuevo conectado al repo y copiar las variables. Verificar el dominio y la URL oficial.
- [ ] **Turso:** pasar las bases a una organización de la empresa (o invitar a la empresa como propietaria) y
      crear tokens nuevos; revocar los anteriores.
- [ ] **OpenRouter:** cuenta de la empresa, llave nueva con límite de gasto; borrar la anterior.
- [ ] **Rotar todo después de transferir:** tokens de Turso, `BETTER_AUTH_SECRET`, `CRON_SECRET` y llave de
      OpenRouter; poner los valores nuevos en Vercel (Production) y hacer **Redeploy**. Todos tendrán que volver a iniciar sesión.
- [ ] **Actualizar `BETTER_AUTH_URL`** si cambia la URL o el dominio.
- [ ] **Usuarios:** revisar en /admin quién tiene acceso, desactivar a quien ya no deba, y cambiar las contraseñas
      de admin y analítica; correr «Revisar contraseñas».
- [ ] **Respaldo completo** antes y después de la transferencia, guardado en un sitio privado de la empresa.
- [ ] **Quitar el acceso personal** de quien entrega (GitHub, Vercel, Turso, OpenRouter) cuando todo funcione.
- [ ] **Responsables:** anotar quién publica cambios, quién respalda y quién paga cada servicio.
