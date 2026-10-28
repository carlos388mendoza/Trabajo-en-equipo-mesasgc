# Despliegue en Vercel (pasos para Carlos)

Este documento recoge los pasos que **tú** haces en la web (Vercel, Turso,
OpenRouter, Railway, GitHub). El código ya está en la rama `feat/vercel`
(PR #109). La app funciona en Vercel Hobby: serverless, sin Socket.IO, tiempo
real por HTTP con sondeo, cron diario con `CRON_SECRET`.

> Regla: nunca pongas tokens ni contraseñas en archivos del repo. Usa notepad
> para pegarlos y bórralos al terminar.

## A) Base de prueba en Turso (mesasgc-preview)

Ya creada, migrada, con catálogo y usuarios de prueba. Para repetirla:

1. Crear base `mesasgc-preview` en `aws-us-east-1` y un token solo para esa base.
2. Crear `.env.preview` en la raíz con:
   ```
   NODE_ENV=development
   TURSO_DATABASE_URL=
   TURSO_AUTH_TOKEN=
   BETTER_AUTH_SECRET=(genera uno aleatorio, sin mostrármelo)
   ```
   (no commitear; está en `.gitignore`).
3. Abrir con notepad, pegar URL y token, guardar, escribir LISTO.
4. Verificar que la URL contiene `mesasgc-preview` y no `mesasgc-prod`.
5. Correr en este orden con dotenv:
   - `npx dotenv-cli -e .env.preview -- npm run db:migrate`
   - `npx dotenv-cli -e .env.preview -- npm run db:catalog`
   - `npx dotenv-cli -e .env.preview -- npx tsx scripts/seed.ts`
6. Borrar `.env.preview`. Verificar `git status` limpio.

## B) Proyecto en Vercel (mesasgc-demo)

1. Sign Up con GitHub (Hobby). Instalar la app de Vercel en GitHub con "Only
   select repositories" y solo este repo.
2. El proyecto que se queda es `mesasgc-demo` (conectado a
   `carlos388mendoza/Trabajo-en-equipo-mesasgc`, rama de producción `main`).
3. Región de funciones: `iad1` (us-east). Build Command: `node scripts/vercel-build.mjs`
   (ya en `vercel.json`).
4. Variables (solo NOMBRES, nunca valores). Preview usa `mesasgc-preview`,
   Production usará `mesasgc-prod`:

   | Variable | Para qué sirve | Preview | Production |
   |---|---|---|---|
   | TURSO_DATABASE_URL | URL de la base Turso | mesasgc-preview | mesasgc-prod |
   | TURSO_AUTH_TOKEN | Token de la base | token preview | token prod (nuevo) |
   | BETTER_AUTH_SECRET | Secreto de Better Auth | distinto | distinto y nuevo |
   | BETTER_AUTH_URL | URL base de la app | URL de preview o vacío | URL de production |
   | OPENROUTER_API_KEY | Llave de OpenRouter (nueva) | nueva | la misma o nueva |
   | OPENROUTER_MODEL | Modelo (openai/gpt-4o-mini) | sí | sí |
   | CRON_SECRET | Secreto del cron diario | distinto | distinto y nuevo |

5. Secretos distintos para Preview y Production, cada uno con:
   ```powershell
   $b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b) | Set-Clipboard
   ```
6. OpenRouter: crear UNA llave nueva para Vercel (con límite de gasto si se
   puede). NO reutilizar la de Railway.
7. En Hobby, las Previews piden iniciar sesión en Vercel para verse (SSO
   protection). Puedes desactivarla en Settings → Deployment Protection si quieres
   probar sin login.
8. Redeploy de la rama `feat/vercel` desde el dashboard o con un commit vacío.

## C) Probar la Preview (checklist)

- [ ] `/api/health` → 200 `{"ok":true}`
- [ ] Login con admin, analítica y un restaurante
- [ ] Plano en vivo en 2 pestañas/tablets a la vez
- [ ] Modo rápido (agregar, sentar, liberar, eliminar cliente)
- [ ] Lista de espera y deshacer
- [ ] `/admin` y "Revisar contraseñas"
- [ ] Pantalla completa en Opera (sin scroll horizontal)
- [ ] Login bloquea tras varios intentos fallidos
- [ ] Sin alerts nativos (#107)
- [ ] Ver logs en Vercel: Settings → Logs o `npx vercel logs`

## D) Publicar a Production (solo tras mi "sí, publica")

1. Merge feat/vercel → testing → main por PR. CI verde en cada paso.
2. Configurar `main` como rama de Production en Vercel (ya lo es).
3. Variables de Production en Vercel: mismas 7 variables, pero con valores de
   `mesasgc-prod` y secretos nuevos/distintos. Usar `.env` + notepad + CLI
   igual que en Preview, pero con entorno `production`.
4. Turso `mesasgc-prod`: "invalidar todos los tokens" (OJO: invalida TODOS,
   por eso va primero) → crear token nuevo de inmediato → ponerlo en Vercel
   Production → Redeploy. La app se cae unos minutos: es normal.
5. Verificar `/api/health` → 200 y `/login` → 200 en la URL de Production.
6. El build migra la base solo en Production (vercel-build.mjs). Comprobar que
   no haya errores en el log del build.

## E) Limpieza (solo con Production funcionando)

1. OpenRouter: borrar la llave VIEJA (la de Railway); revisar Activity desde el
   20 de octubre.
2. Turso: revisar actividad de `mesasgc-prod` desde el 20 de octubre.
3. Railway: borrar el proyecto noble-energy (Settings → Danger → Delete
   Project); borrar tokens en Account Settings → Tokens.
4. GitHub → Settings → Applications:
   - Installed GitHub Apps: Railway → Configure → Uninstall.
   - Authorized OAuth Apps: Railway → Revoke.
   - Revisar que no haya otras apps raras con acceso al repo.
5. GitHub → repo → Settings → Secrets and variables: borrar cualquier secreto
   relacionado con Railway.
6. GitHub → repo → Settings → Environments/Deployments: quitar entornos de
   Railway si existen.

## F) Después

- Todos deben volver a iniciar sesión (secreto nuevo).
- Cambiar la contraseña de desarrollo (la que estuvo escrita en el repo) del admin (y de analítica) desde `/admin` y
  pulsar "Revisar contraseñas".
- Copiar planos si siguen vacíos: desde `/restaurante/rest_tgu_kfc/editor`
  "Copiar plano" → KFC Río Piedras; desde `rest_tgu_pizza` → Pizza Hut Norte;
  en cada destino Meseros → Editar zonas → Repartir automáticamente → Guardar.
- Mandar el link nuevo de Vercel a Grupo Comidas.
- Opcional: borrar la base `mesasgc-preview` si ya no se usa.
