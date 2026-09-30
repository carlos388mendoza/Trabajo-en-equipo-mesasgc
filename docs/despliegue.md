# Despliegue en Railway

Esta guía configura Table Waitlist en Railway con el repositorio de GitHub y la rama `main`.

## 1. Crear el proyecto desde GitHub

1. Entra en [railway.app](https://railway.app/) e inicia sesión.
2. Pulsa **New Project** y elige **Deploy from GitHub repo**.
3. Selecciona `Trabajo-en-equipo-mesasgc`.
4. En el servicio, abre **Settings → Source** y selecciona la rama `main` como rama de despliegue.
5. Genera un dominio público de Railway desde la sección de dominios del servicio. Lo necesitarás para `BETTER_AUTH_URL`.

### Los comandos salen de `railway.json`

El repositorio trae `railway.json` en la raíz, y Railway toma de ahí los comandos del servicio. No hace falta escribirlos a mano:

| Paso | Comando | Qué hace |
|---|---|---|
| Build | `npm ci && npm run build` | Instala las dependencias y compila la app |
| Pre-deploy | `npm run db:migrate` | Aplica a la base las migraciones que falten |
| Start | `npm start` | Arranca Next y Socket.IO en el puerto que da Railway |
| Healthcheck | `/api/health` | Railway espera un 200 antes de dar el despliegue por bueno |

Después del primer despliegue, abre **Settings** y comprueba que esos cuatro valores aparecen ahí. Si no aparecen, por ejemplo porque el servicio no leyó el archivo, escríbelos a mano con los mismos valores de la tabla: tienen que coincidir siempre con `railway.json`. Consulta la [documentación de Config as Code](https://docs.railway.com/config-as-code/reference) si la interfaz de Railway cambió.

Las migraciones de Drizzle son incrementales. El despliegue **nunca** ejecuta el seed ni `db:push`.

## 1b. La base de datos de producción

**La base de Turso de producción debe ser nueva y vacía** (por ejemplo, `mesasgc-prod`). Railway aplica las migraciones desde cero en el primer despliegue.

**No uses la base de desarrollo creada con `db:push`.** Una base creada así no tiene la tabla `__drizzle_migrations`. El primer `db:migrate` intentaría crear tablas que ya existen, fallaría y el despliegue no arrancaría. Además, esa base tiene los usuarios de prueba con la contraseña pública `12345abc`.

1. En Turso, crea una base nueva, por ejemplo `mesasgc-prod`, y no le cargues nada.
2. Copia su URL y crea un token para ella: van en `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` (ver 2).
3. En el primer despliegue, revisa el log del paso de Pre-deploy: tiene que decir que las migraciones se aplicaron (`migrations applied`).
4. La base queda con las tablas y **sin ningún usuario**. El primer administrador se crea en el paso 3.

## 2. Agregar las variables

Abre el servicio en Railway y entra a **Variables**. Agrega cada nombre y su valor. Las claves se escriben directamente en Railway; no las compartas en GitHub, documentos del repositorio ni chats.

| Variable | Valor y dónde conseguirlo |
|---|---|
| `TURSO_DATABASE_URL` | URL de la base de producción **nueva y vacía** (ver 1b). Cópiala de Turso, en la información o conexión de esa base. |
| `TURSO_AUTH_TOKEN` | Token de acceso de esa misma base de producción. Créalo desde Turso y pégalo directamente en Railway. |
| `BETTER_AUTH_SECRET` | Secreto nuevo y exclusivo para producción. En PowerShell local puedes generarlo con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`; copia el resultado directamente a Railway y no lo publiques. |
| `BETTER_AUTH_URL` | URL pública HTTPS del servicio Railway, por ejemplo `https://tu-servicio.up.railway.app`. No agregues una ruta al final. |
| `OPENROUTER_API_KEY` | Clave de API creada en la sección **API Keys** de OpenRouter. Pégala directamente en Railway. |
| `OPENROUTER_MODEL` | Modelo que usará el asistente. El valor inicial recomendado en `.env.example` es `openai/gpt-4o-mini`; puedes elegir otro modelo disponible en OpenRouter. |

Railway proporciona `PORT`; no hace falta escribirlo. El servidor propio usa ese valor para Next.js y Socket.IO en el mismo puerto.

### Cuidado con la base de datos

La URL y el token de Turso son de **producción**. No corras `npm run db:seed`, `npm run seed:reset` ni `npm run db:push` contra esa base. Las migraciones se aplican mediante el comando de predespliegue configurado. Para probar localmente, usa `TURSO_DATABASE_URL=file:./local.db` con `TURSO_AUTH_TOKEN` vacío.

## 3. Crear el primer administrador

Después del primer despliegue, con las variables de Railway ya guardadas:

1. Instala e inicia sesión en [Railway CLI](https://docs.railway.com/cli).
2. En PowerShell, entra a la carpeta del proyecto y enlaza la CLI con el proyecto y servicio:

   ```powershell
   railway link
   ```

3. Abre una consola dentro del contenedor desplegado:

   ```powershell
   railway ssh
   ```

4. En esa consola ejecuta:

   ```sh
   npm run create-admin
   ```

5. Sigue las preguntas para el nombre, correo y contraseña. Usa una contraseña nueva y segura, distinta de `12345abc`. No la guardes en este repositorio ni la compartas por chat.

El comando crea solo al administrador inicial; no ejecutes el seed en producción.

## 4. Revisar un despliegue fallido

1. Abre el proyecto y servicio en Railway.
2. Entra a **Deployments**, selecciona el despliegue más reciente y abre sus logs de **Build** y **Deploy**.
3. Si falla la compilación, revisa el primer error de Build. Si falla al iniciar, confirma que están las seis variables y que `BETTER_AUTH_URL` coincide con el dominio HTTPS.
4. Si falló la migración, verifica la URL y el token de Turso y el permiso de escritura. Corrige la variable o el acceso y vuelve a desplegar; no intentes arreglarlo con `db:push`.
5. Si el healthcheck falla, confirma en **Settings** que los comandos coinciden con `railway.json` (Healthcheck Path `/api/health`) y que `/api/health` responde `{"ok":true}`.
6. Si el Pre-deploy dice que una tabla ya existe, la base no era nueva (ver 1b). Crea una base vacía, cambia `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` y vuelve a desplegar.

## 5. Controlar el gasto del asistente

En OpenRouter, configura un límite de gasto bajo para empezar y alertas de consumo. Revisa el uso después de probar el asistente y aumenta el límite solo si hace falta.
