# Despliegue en Railway

Esta guía configura Table Waitlist en Railway con el repositorio de GitHub y la rama `main`.

## 1. Crear el proyecto desde GitHub

1. Entra en [railway.app](https://railway.app/) e inicia sesión.
2. Pulsa **New Project** y elige **Deploy from GitHub repo**.
3. Selecciona `Trabajo-en-equipo-mesasgc`.
4. En el servicio, abre **Settings → Source** y selecciona la rama `main` como rama de despliegue.
5. Genera un dominio público de Railway desde la sección de dominios del servicio. Lo necesitarás para `BETTER_AUTH_URL`.

Este repositorio incluye `railway.json` con los comandos previstos. Sin embargo, Railway ya no permite activar Config as Code (`railway.json`) en servicios nuevos. Como vas a crear un servicio nuevo, configura sus comandos manualmente en **Settings**: Build Command `npm ci && npm run build`, Pre-deploy Command `npm run db:migrate`, Start Command `npm start` y Healthcheck Path `/api/health`. El archivo queda como referencia para esos valores. Railway mantiene la configuración en `railway.json` solo para servicios antiguos, hasta el 1 de diciembre de 2026; revisa la [documentación de Config as Code](https://docs.railway.com/config-as-code/reference).

Las migraciones de Drizzle son incrementales. No ejecutan el seed ni `db:push`.

## 2. Agregar las variables

Abre el servicio en Railway y entra a **Variables**. Agrega cada nombre y su valor. Las claves se escriben directamente en Railway; no las compartas en GitHub, documentos del repositorio ni chats.

| Variable | Valor y dónde conseguirlo |
|---|---|
| `TURSO_DATABASE_URL` | URL de la base Turso que ya existe. Cópiala de Turso, en la información/conexión de esa base. |
| `TURSO_AUTH_TOKEN` | Token de acceso de esa misma base Turso. Créalo o cópialo desde Turso y pégalo directamente en Railway. |
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
5. Si el healthcheck falla, confirma que el servicio usa el `railway.json` del repositorio y que `/api/health` responde `{"ok":true}`.

## 5. Controlar el gasto del asistente

En OpenRouter, configura un límite de gasto bajo para empezar y alertas de consumo. Revisa el uso después de probar el asistente y aumenta el límite solo si hace falta.
