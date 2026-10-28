# Seguridad

Revisión realizada el **26 de octubre de 2026** tras el aviso de Railway sobre
posible exposición de variables de entorno (octubre de 2026).

## 1. Qué se revisó (solo lectura)

- **Commit bf19e8c (28 de septiembre):** contenía credenciales en `.env.example`,
  pero apuntaban a la base de Turso y a la cuenta de OpenRouter de un compañero,
  NO a producción. Producción usa el host `mesasgc-prod-…turso.io` y una clave
  propia de OpenRouter, creadas después. Comprobado el 26 de octubre comparando
  solo el host de la URL del commit con el de producción: el del commit es
  `base-mesas-gc-vbgjptt89g-beep…turso.io`, el de producción
  `mesasgc-prod-carlos388mendoza…turso.io`. Son distintos. El compañero ya borró su base y su
  clave. No se reescribió el historial: con revocar basta.
- **GitHub:** colaboradores (Carlos, admin; y vbgjptt89g-beep, escritura), sin
  deploy keys ni webhooks, ruleset `proteger-main-testing` activo.
- **PRs directos a `main`:** el PR #91 del compañero entró a `main` sin pasar
  por `testing`. Ver sección 5.

## 2. Rotación de claves (hecha)

Las tres claves de producción se trataron como posiblemente expuestas y se
rotaron:

- **TURSO_AUTH_TOKEN:** invalidados todos los tokens de `mesasgc-prod`, creado uno
  nuevo y puesto en Railway → Variables.
- **OPENROUTER_API_KEY:** creada una nueva, borrada la vieja, puesta en Railway.
- **BETTER_AUTH_SECRET:** generado uno nuevo (48 bytes, base64) y puesto en
  Railway por el usuario (pegado desde el portapapeles, sin imprimirlo). Al
  cambiarlo, todas las sesiones se invalidan y hay que volver a entrar.

La CLI de Railway está bloqueada por una directiva de Windows en esta máquina:
la rotación se hizo desde la web. El despliegue quedó en SUCCESS y
`/api/health` y `/login` responden 200.

## 3. Refuerzos aplicados en la app (PR de seguridad)

- **Límite de intentos FALLIDOS de inicio de sesión** (`lib/auth/login-limit.ts`,
  corregido el 27 de octubre): 5 fallos por correo y 30 por conexión (IP) en
  15 minutos bloquean 15 minutos, con un mensaje que dice cuánto esperar.
  - Solo cuentan los fallos: entrar bien no suma y borra los fallos de ese
    correo. Así las tablets de un restaurante, que comparten IP, pueden volver
    a entrar todas a la vez (por ejemplo, tras rotar `BETTER_AUTH_SECRET`).
  - Se aplica en los DOS caminos de entrada: el formulario de `/login` (una
    server action que llama a Better Auth por dentro) y la ruta HTTP
    `/api/auth/sign-in/email`.
  - La primera versión (26 de octubre) estaba en `proxy.ts` y no funcionaba:
    el `matcher` del proxy excluye `/api/auth`, el formulario no pasa por esa
    ruta, y además contaba también los inicios de sesión correctos.
  - Además, en producción Better Auth trae su propio límite en la ruta HTTP
    (3 intentos cada 10 segundos por IP).
  - En memoria del servidor: vale para una sola instancia (Railway hoy).
  - Lo prueban `verify:auth` (sección «Límite de intentos fallidos…»).
- **Cookies de sesión:** Better Auth ya las pone `httpOnly`, `SameSite=Lax` y
  `Secure` cuando `BETTER_AUTH_URL` es https. No se cambió.
- **Cabeceras de seguridad** en `next.config.mjs` y `proxy.ts`:
  `Content-Security-Policy` (frame-ancestors 'self' y permisos mínimos),
  `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin` y
  `Strict-Transport-Security`.
- **npm audit:** actualizados `next` y `zod` a versiones sin vulnerabilidades
  altas/críticas. Quedan 4 moderadas en `esbuild` (solo desarrollo, vía
  `drizzle-kit`); arreglarlas exige un downgrade de `drizzle-kit` (breaking), así
  que se dejan.
- **`/admin`:** muestra «Última revisión de seguridad: 26 de octubre de 2026».
- **Logs sin datos personales ni secretos** (`lib/log.ts`): los errores del
  servidor se imprimen con `logServerError`, que quita los parámetros de las
  consultas (nombres, teléfonos), correos, tokens y claves. Antes se imprimía
  el error entero, y los de la base traen la consulta con sus parámetros.

## 4. Cómo rotar cada clave desde la web (sin CLI)

- **Turso:** Turso → base `mesasgc-prod` → Tokens → invalidar y crear uno nuevo
  → Railway → Variables → `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` → Deploy Changes.
- **OpenRouter:** OpenRouter → Keys → crear nueva y borrar la vieja → Railway →
  Variables → `OPENROUTER_API_KEY` → Deploy Changes. Comprobar que la vieja deja
  de tener consumo.
- **BETTER_AUTH_SECRET:** generar 48 bytes en base64, pegar en Railway →
  Variables → `BETTER_AUTH_SECRET` → Deploy Changes. Avisar que todos tendrán
  que volver a iniciar sesión. Para generarlo sin que se vea, en PowerShell:
  `$b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Fill($b); Set-Clipboard ([Convert]::ToBase64String($b))`,
  pegarlo en Railway y después vaciar el portapapeles (`Set-Clipboard $null`).

## 5. Evitar PRs directos a `main`

El PR #91 entró directo a `main` sin pasar por `testing` (solo cambiaba la
confirmación al cerrar sesión, lo mismo que #90 en `testing`; no hay que
revertir nada). Para que no se repita:

- `.github/workflows/protect-main.yml`: el check «La rama de origen debe ser
  testing» falla si un PR a `main` no viene de la rama `testing` de este
  mismo repositorio. El nombre de la rama se lee de una variable de entorno, no
  metido en el script (así un nombre de rama hecho a propósito no puede
  ejecutar comandos en el CI).
- Ruleset **solo-testing-a-main** (solo para `main`): ese check es
  obligatorio, así que GitHub no deja fusionar un PR a `main` desde otra rama.
  El ruleset `proteger-main-testing` sigue igual para las dos ramas.

## 6. Si vuelve a pasar

1. Revocar la clave afectada desde la consola del proveedor.
2. Poner la nueva en Railway → Variables → Deploy Changes.
3. Revisar usuarios, sesiones y cambios recientes (ver sección 1).
4. Anotar la fecha de la revisión en `/admin` y en este documento.

## 7. Contraseña de desarrollo en producción (27 de octubre de 2026)

**Por qué es un riesgo.**

- El repositorio es **público**.
- La contraseña de desarrollo está escrita en `scripts/seed.ts` (`TEST_PASSWORD`), en las pruebas y en el historial de git, y no se puede borrar del historial.
- Los correos de los usuarios de ejemplo (`admin@`, `analitica@` y uno por marca, todos `@grupocomidas.test`) también están en el seed y en las pruebas. En producción se usan los mismos.

Si un usuario de producción tiene esa contraseña, cualquiera que lea el código puede entrar como él desde cualquier lugar. El límite de 5 fallos no lo frena, porque acierta a la primera.

- **Con el administrador** podría hacer todo esto:
  - crear, desactivar o cambiar la contraseña de cualquier usuario, incluso dejar fuera al administrador real;
  - borrar o cambiar planos y restaurantes;
  - ver los nombres de los clientes;
  - cambiar la configuración de privacidad;
  - gastar crédito de OpenRouter con el asistente.
- **Con el de una marca** podría ver y cambiar la lista de espera y el plano de sus locales.
- **Con analítica** podría ver las estadísticas.

**Qué hace la app desde este PR.** Avisa, pero no impide guardar ni usar la contraseña:

- Al crear un usuario o cambiarle la contraseña en `/admin` con una pública o muy débil, el mensaje lo avisa.
- `/admin` → **Revisar contraseñas** dice qué usuarios activos tienen una contraseña de las que están en el código. Compara contra el hash, tarda unos segundos y nunca muestra la contraseña.
- Si alguien entra a producción con una contraseña pública o muy débil:
  - sale un aviso rojo bajo el encabezado durante 12 horas;
  - el log de Railway muestra `[login] se entró a producción con una contraseña…`, sin el correo.
- El README y los documentos ya no escriben la contraseña ni los correos de producción. Solo quedan en el seed y en las pruebas, que no corren en producción.

**Para quitar el riesgo de verdad**, lo mejor es una de estas dos cosas:

- usar una contraseña distinta, al menos en el **administrador**;
- dar a los usuarios de producción correos reales que no estén en el repositorio.

**Cambiarla a una segura en un minuto:**

1. En `/admin` → **Usuarios**, pulsa **Contraseña** en el usuario.
2. Pulsa **Generar otra**: crea una aleatoria y legible y rellena los dos campos. Para verla y copiarla, usa el botón del ojo.
3. Pulsa **Restablecer contraseña**. Sus sesiones abiertas se cierran solas.
4. Pásasela a la persona por un canal privado, nunca por el chat del grupo.
5. Para comprobarlo, pulsa **Revisar contraseñas**: debe decir que ningún usuario usa una del código.


## Incidente de Railway (octubre 2026)

- El 20-21 de octubre de 2026 Railway confirm� acceso a variables de entorno de clientes.
- Todas las llaves que estuvieron en Railway se consideran EXPUESTAS: token de Turso de mesasgc-prod, llave de OpenRouter y BETTER_AUTH_SECRET.
- Las llaves se rotaron v�a la web UI de Railway (la CLI estaba bloqueada por App Control de Windows).
- La app se migr� a Vercel Hobby. Railway queda descartado para siempre.
- Pasos de limpieza final: hechos el 28 de octubre de 2026 (ver docs/entrega-empresa.md).
- Las migraciones solo corren en Production (build de Vercel). Nunca db:push ni seed en producci�n.

