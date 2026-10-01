# Despliegue en Railway

Esta guía configura Table Waitlist en Railway con el repositorio de GitHub y la rama `main`.

## 1. Crear el proyecto desde GitHub

1. Entra en [railway.com](https://railway.com/new) e inicia sesión.
2. Elige **Deploy from GitHub repo**. Si lo pide, instala la app de Railway en GitHub solo para `carlos388mendoza/Trabajo-en-equipo-mesasgc` (**Only select repositories**).
3. Selecciona `Trabajo-en-equipo-mesasgc` y pulsa **Deploy Now**. El primer despliegue puede fallar: todavía no hay variables ni comandos.
4. En el servicio, abre **Settings → Source**, confirma la rama `main` y marca **Wait for CI**. Así Railway solo despliega cuando pasa el CI de GitHub.
5. Genera el dominio público (`railway domain` en la CLI, o desde **Settings → Networking**). Lo necesitarás para `BETTER_AUTH_URL`.
6. Escribe a mano los comandos de la tabla siguiente.

Producción hoy: proyecto `noble-energy`, servicio `Trabajo-en-equipo-mesasgc`, región US East, dominio `https://trabajo-en-equipo-mesasgc-production.up.railway.app`.

### Los comandos se escriben a mano en Railway

**Railway no lee `railway.json` en este servicio.** Desde el 28 de agosto de 2026, los servicios nuevos ya no pueden usar *Config as Code* (`railway.json`): Railway lo sustituye por *Infrastructure as Code* (`.railway/railway.ts`). Nuestro servicio se creó el 30 de septiembre, así que en el primer despliegue solo usó el comando de build. **No corrió el Pre-deploy ni el healthcheck, y la base quedó vacía.**

Por eso los valores se escriben a mano en el servicio, en **Settings**:

| Sección de Settings | Campo | Valor | Qué hace |
|---|---|---|---|
| Build | Custom Build Command | `npm ci && npm run build` | Instala las dependencias y compila la app |
| Deploy | Pre-deploy Command | `npm run db:migrate && npm run db:catalog` | Aplica las migraciones que falten y carga el catálogo de elementos del editor (sin él, la paleta sale vacía) |
| Deploy | Custom Start Command | `npm start` | Arranca Next y Socket.IO en el puerto que da Railway |
| Deploy | Healthcheck Path | `/api/health` (timeout `300`) | Railway espera un 200 antes de dar el despliegue por bueno |
| Deploy | Restart Policy | *On Failure*, 5 reintentos | Reinicia el contenedor si se cae |

`railway.json` se queda en el repositorio **solo como referencia** de esos valores: si cambias uno, cámbialo en los dos sitios. Los valores de Railway son los que mandan.

Después de cada cambio de configuración, comprueba en el log del despliegue estas tres líneas:

- `migrations applied successfully!` (Pre-deploy, `db:migrate`);
- `catálogo de elementos: 8 tipos listos` (Pre-deploy, `db:catalog`);
- `Healthcheck succeeded!` (log de build).

> **Pendiente:** migrar esta configuración a *Infrastructure as Code* (`.railway/railway.ts`, ver `railway config migrate` y la [guía de migración](https://docs.railway.com/infrastructure-as-code#migrating-from-config-as-code)). Así los comandos vuelven a vivir en el repositorio y se revisan por PR. Los servicios antiguos pueden usar `railway.json` hasta el 1 de diciembre de 2026.

Las migraciones de Drizzle son incrementales. El despliegue **nunca** ejecuta el seed ni `db:push`.

## 1b. La base de datos de producción

**La base de Turso de producción debe ser nueva y vacía** (por ejemplo, `mesasgc-prod`). Railway aplica las migraciones desde cero en el primer despliegue.

**No uses la base de desarrollo creada con `db:push`.** Una base creada así no tiene la tabla `__drizzle_migrations`. El primer `db:migrate` intentaría crear tablas que ya existen, fallaría y el despliegue no arrancaría. Además, esa base tiene los usuarios de prueba con la contraseña pública `12345abc`.

1. En Turso, crea una base nueva, por ejemplo `mesasgc-prod`, y no le cargues nada.
2. Copia su URL y crea un token para ella: van en `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` (ver 2).
3. En el primer despliegue, revisa el log del paso de Pre-deploy: tiene que decir que las migraciones se aplicaron (`migrations applied`) y, después, `catálogo de elementos: 8 tipos listos`.
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

1. Instala e inicia sesión en [Railway CLI](https://docs.railway.com/cli) (`npm i -g @railway/cli` y `railway login`). En Windows con nvm, si PowerShell no encuentra `railway`, usa `& "$(npm prefix -g)\railway.cmd"` en su lugar.
2. En PowerShell, entra a la carpeta del proyecto, ponla al día con `main` y enlaza la CLI con el proyecto y el servicio:

   ```powershell
   git switch main; git pull
   railway link --project noble-energy --service Trabajo-en-equipo-mesasgc --environment production
   ```

3. Corre el script con las variables de producción:

   ```powershell
   railway run npm run create-admin
   ```

   `railway run` ejecuta el script **en tu computadora** con las variables del servicio, así que se conecta a la base de producción. `dotenv` no pisa esas variables con las de tu `.env.local`. Otra opción es `railway ssh` y, dentro del contenedor, `npm run create-admin`.

4. Sigue las preguntas: correo, nombre y contraseña. La contraseña no se muestra al escribirla y necesita el largo mínimo que pide la app. Usa una contraseña nueva y segura, distinta de `12345abc`. No la guardes en este repositorio ni la compartas por chat.

El comando crea solo al administrador inicial; no ejecutes el seed en producción.

### Otros usuarios desde la terminal

Para crear (o actualizar) cualquier otro usuario sin entrar a `/admin`, por ejemplo los del piloto:

```powershell
railway run npm run create-user -- --correo dennys@grupocomidas.test --nombre "Denny's" --rol restaurante --marca "Denny's"
```

Muestra la base (solo el host) y un resumen, pide la contraseña dos veces sin mostrarla y confirmar con «si». Si el correo ya existe, solo cambia nombre, roles y restaurantes, sin tocar la contraseña. Detalles en el README («`npm run create-user`»).

### Si nadie puede entrar (contraseña olvidada)

`create-admin` **no cambia la contraseña** de un correo que ya existe: solo le asegura el rol admin y lo activa. Para cambiarla sin entrar en `/admin`:

```powershell
railway run npm run reset-password
```

- Muestra a qué base se conecta (solo el host, nunca el token).
- Pide el correo y la contraseña nueva **dos veces, sin mostrarla**. No la acepta por variables de entorno ni por argumentos, para que no quede en el historial.
- Exige al menos 8 caracteres, sin espacios al principio ni al final, y pide confirmar con «si».
- Solo cambia la contraseña de ese usuario y cierra sus sesiones. No crea usuarios ni cambia roles, y avisa si el usuario está desactivado.

Antes de cambiarla, conviene mirar en los logs de Railway si hay `[Better Auth]: Invalid password` (contraseña incorrecta) o respuestas 429 (demasiados intentos).

## 3b. Cargar las marcas y los restaurantes

La app todavía no tiene pantalla para crear restaurantes, marcas ni zonas. Se cargan una vez, con la CLI ya enlazada (sección 3):

```powershell
railway run npm run db:restaurantes
```

- Crea las 4 marcas (China Wok, Pizza Hut, KFC y Denny's), los 8 restaurantes con su ciudad y su posición en el mapa, y una zona vacía, «Comedor principal», en cada uno.
- **No crea mesas, clientes ni usuarios**, y no borra ni actualiza nada: lo que ya existe se queda como está, y a un restaurante que ya tiene zonas no le añade otra.
- Repetirlo no duplica nada: la segunda vez dice «0» en todo.

Después, el admin crea desde `/admin` los usuarios de cada restaurante, y cada host dibuja su plano en el editor, sobre la zona vacía.

## 4. Revisar un despliegue fallido

1. Abre el proyecto y servicio en Railway.
2. Entra a **Deployments**, selecciona el despliegue más reciente y abre sus logs de **Build** y **Deploy**.
3. Si falla la compilación, revisa el primer error de Build. Si falla al iniciar, confirma que están las seis variables y que `BETTER_AUTH_URL` coincide con el dominio HTTPS.
4. Si falló la migración, verifica la URL y el token de Turso y el permiso de escritura. Corrige la variable o el acceso y vuelve a desplegar; no intentes arreglarlo con `db:push`.
5. Si el healthcheck falla, confirma en **Settings** que los comandos coinciden con la tabla de la sección 1 (Healthcheck Path `/api/health`) y que `/api/health` responde `{"ok":true}`.
6. Si el despliegue sale bien pero no se puede iniciar sesión, mira si en el log aparece `migrations applied successfully!`. Si no aparece, el Pre-deploy no está configurado: escríbelo en **Settings → Deploy** (sección 1) y vuelve a desplegar. `/api/health` no consulta la base, así que responde 200 aunque esté vacía.
7. Si el Pre-deploy dice que una tabla ya existe, la base no era nueva (ver 1b). Crea una base vacía, cambia `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` y vuelve a desplegar.

## 5. Controlar el gasto del asistente

En OpenRouter, configura un límite de gasto bajo para empezar y alertas de consumo. Revisa el uso después de probar el asistente y aumenta el límite solo si hace falta.
