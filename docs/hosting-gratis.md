# OBSOLETO — Hosting gratis: opciones y plan de cambio

> **OBSOLETO.** La app se migró a Vercel Hobby. Railway queda descartado para
> siempre. Ver `docs/despliegue-vercel.md` para los pasos actuales.

Revisado el 27 de octubre de 2026. Los planes gratis cambian seguido: antes de mover nada, confirma los datos en la página de precios de cada uno.

**Todavía no se migra nada.** Este documento es el plan. Railway sigue funcionando hasta el último paso.

## Qué necesita la app

- Un proceso Node **siempre encendido**, o que despierte rápido: `server.ts` levanta Next y Socket.IO en el mismo puerto.
- **WebSockets** de larga duración. Las salas de Socket.IO viven en memoria, así que hace falta **una sola instancia**.
- Correr `npm run db:migrate && npm run db:catalog` antes de arrancar (hoy lo hace `preDeployCommand` en `railway.json`).
- La base de datos está en **Turso**, fuera del hosting. No hay que mover datos.
- Unos 300–500 MB de RAM en marcha. El build de Next necesita más, pero corre aparte.

## Comparación

| Opción | ¿Gratis de verdad? | ¿Pide tarjeta? | ¿Se duerme? | WebSockets | ¿Uso de empresa? | Trabajo de mudanza |
|---|---|---|---|---|---|---|
| **Northflank Sandbox** | Sí: hasta 20 US$/mes de recursos, 2 servicios y 1 base | **No** («No card needed») | **No** («Always on, no sleeping») | Sí (servicio HTTP normal) | Sus documentos dicen que el plan gratis «no debe usarse para producción»; no lo prohíben de forma explícita | Bajo: Dockerfile o buildpack desde GitHub |
| **Render Free** | Sí: 750 horas al mes por workspace | No para el plan gratis | **Sí**: tras 15 min sin tráfico; despertar tarda **cerca de 1 minuto**. Los mensajes por WebSocket abiertos cuentan como tráfico | Sí | Render dice que el plan gratis no es para producción | Bajo |
| **Oracle Cloud Always Free** | Sí: Ampere A1 con 2 OCPU y 12 GB en total, o 2 VM AMD de 1 GB | **Sí** (verificación con tarjeta al registrarse) | No, pero **Oracle reclama la VM** si 7 días seguidos usa menos del 20 % de CPU, red y memoria (esta app usa muy poco) | Sí | Sí | **Alto**: hay que administrar un servidor Linux (Node, proxy, HTTPS, reinicios y actualizaciones) |
| **Google Cloud Run** | Hay una cuota gratis mensual, pero mantener 1 instancia encendida (necesario para Socket.IO) se cobra | **Sí** (cuenta de facturación) | Por defecto escala a 0; cada WebSocket se corta al llegar al límite del request (5 min por defecto, 60 como máximo) | Con límites | Sí | Medio-alto |
| **Koyeb** | 1 instancia de 0,1 vCPU y 512 MB | Fuentes contradictorias; reportan un cargo retenido de 29 US$ desde febrero de 2026 | Sí, tras 1 h sin tráfico | Sin confirmar | — | Bajo, pero 0,1 vCPU es poco para Next |
| **Fly.io** | Ya no tiene plan gratis (solo una prueba corta) | Sí | — | Sí | — | — |
| **Railway** (hoy) | Al acabar la prueba pasa al plan Free con **1 US$ de crédito al mes**. Esta app gasta unos 3 US$/mes, así que se detendría a mitad de mes | No | No mientras haya crédito | Sí | Sí | — |

## Recomendación: Northflank Sandbox

Es la única opción que, sin tarjeta, deja el servidor **siempre encendido**: las tablets no esperan un minuto por la mañana y las salas de Socket.IO no se pierden. Además construye directamente desde GitHub, como Railway.

**Riesgos que hay que aceptar:**

- Northflank dice que el plan gratis no es para producción, y el soporte es «best effort».
- Los recursos del plan son limitados. Si el servidor se queda corto de memoria, se nota en los logs: reinicios con «out of memory».
- Si cambian el plan gratis, habría que mudarse otra vez. El plan B es Render Free, aceptando que se duerme.

## Plan paso a paso (no se ejecuta hasta que Carlos diga «sí, migra»)

### A. En el código (lo hago yo, en un PR a `testing`)

1. **`Dockerfile`** con Node 22. Hace `npm ci`, `npm run build` y arranca con `npm run db:migrate && npm run db:catalog && npm start`, que es lo mismo que hoy hacen `preDeployCommand` y `startCommand` en Railway.
2. **`.dockerignore`** para que no entren `.env.local`, `local.db`, `node_modules`, `.next*` ni `respaldos/`.
3. **El servidor escucha en `PORT`** (ya lo hace). `NEXT_PUBLIC_SOCKET_URL` se deja vacía: el socket usa el mismo dominio.
4. **`railway.json` no se toca**, así Railway sigue igual.
5. **Prueba en local** con `docker build`, si Docker funciona en esta computadora. Si no, la primera construcción en Northflank sirve de prueba.

### B. En la web (lo haces tú)

1. **Crear la cuenta.** Entra a northflank.com → **Start free** con tu cuenta de GitHub. No pongas tarjeta.
2. **Crear el proyecto.** **Create project**, región de EE. UU. (más cerca de Honduras y de Turso, `aws-us-east-1`).
3. **Crear el servicio.** **Create service** → **Combined service** (construye y despliega).
   - Repositorio: `carlos388mendoza/Trabajo-en-equipo-mesasgc`, rama **`main`**.
   - Tipo de build: **Dockerfile**.
   - Plan de recursos: el más grande que permita el Sandbox.
   - **Instancias: 1** (Socket.IO necesita una sola).
4. **Puerto.** Puerto **3000**, HTTP, **público**. Northflank da una URL `https://…northflank.app`.
5. **Variables (Runtime variables).** Copia los valores desde Railway → Variables, sin pegarlos en ningún chat:
   - `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BETTER_AUTH_SECRET` y `OPENROUTER_API_KEY`;
   - `BETTER_AUTH_URL` = la URL nueva de Northflank;
   - `NODE_ENV` = `production` y `PORT` = `3000`.
6. **Health check.** Ruta `/api/health`, puerto 3000.
7. **Desplegar.** Espera a que el build termine y abre `https://<tu-url>/api/health`: debe decir `{"ok":true}`.
8. **Probar.** Entra en la URL nueva con tu usuario. Se usa la **misma base** de Turso, así que verás los mismos datos.
   - Prueba el modo sencillo, el plano en vivo y el editor en **una sola tablet**.
   - **No uses las dos URLs a la vez con tablets reales:** cada servidor tiene sus propias salas de Socket.IO, y una tablet en Railway no ve en vivo lo que hace otra en Northflank (los datos sí se guardan bien).

### C. El cambio (un día de poco movimiento, antes de abrir)

1. Pasa todas las tablets a la URL nueva: cambia el favorito o la app de acceso directo y vuelve a iniciar sesión (la cookie es por dominio).
2. Comprueba en dos tablets que una ve en vivo lo que hace la otra.
3. Cuando todo funcione, en Railway → el servicio → **Settings** → **Pause** (o deja que se acabe la prueba).
4. **Para volver atrás:** mientras Railway siga ahí, basta con abrir de nuevo su URL en las tablets.

### D. Después

- Yo actualizo `docs/despliegue.md`, `docs/salida-a-produccion.md` y el manual del host con la URL nueva y los pasos de Northflank.
- La CLI de Northflank **no hace falta**: todo se hace desde la web.

## Fuentes (consultadas el 27 de octubre de 2026)

- Northflank, precios: <https://northflank.com/pricing>
- Northflank, tipos de proyecto: <https://northflank.com/docs/v1/application/billing/project-types>
- Render, plan gratis: <https://render.com/docs/free>
- Render, WebSockets que mantienen despierto el servicio: <https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages>
- Oracle Always Free: <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>
- Cloud Run y WebSockets: <https://docs.cloud.google.com/run/docs/triggering/websockets>
- Koyeb, instancias: <https://www.koyeb.com/docs/reference/instances>
- Railway, prueba gratis: <https://docs.railway.com/reference/pricing/free-trial>
