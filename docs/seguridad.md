# Seguridad

Revisión realizada el **26 de octubre de 2026** tras el aviso de Railway sobre
posible exposición de variables de entorno (octubre de 2026).

## 1. Qué se revisó (solo lectura)

- **Commit bf19e8c (28 de septiembre):** contenía credenciales en `.env.example`,
  pero apuntaban a la base de Turso y a la cuenta de OpenRouter de un compañero,
  NO a producción. Producción usa el host `mesasgc-prod-…turso.io` y una clave
  propia de OpenRouter, creadas después. El compañero ya borró su base y su
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

- **Rate limit de login** por IP y por correo: 10 intentos por IP y 5 por correo
  cada 15 minutos, con mensaje claro (429). Implementado en `proxy.ts`.
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
- Los logs no imprimen tokens, contraseñas ni datos personales completos.

## 4. Cómo rotar cada clave desde la web (sin CLI)

- **Turso:** Turso → base `mesasgc-prod` → Tokens → invalidar y crear uno nuevo
  → Railway → Variables → `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` → Deploy Changes.
- **OpenRouter:** OpenRouter → Keys → crear nueva y borrar la vieja → Railway →
  Variables → `OPENROUTER_API_KEY` → Deploy Changes. Comprobar que la vieja deja
  de tener consumo.
- **BETTER_AUTH_SECRET:** generar 48 bytes en base64, pegar en Railway →
  Variables → `BETTER_AUTH_SECRET` → Deploy Changes. Avísar que todos tendrán
  que volver a iniciar sesión.

## 5. Evitar PRs directos a `main`

El PR #91 entró directo a `main`. Recomendación: mantener el ruleset
`proteger-main-testing` activo (ya lo está, sin bypass) y añadir, si hace falta,
una GitHub Action que falle cuando la rama de origen de un PR a `main` no sea
`testing`. Revisar #90 y #91 antes de decidir si se revierte algo.

## 6. Si vuelve a pasar

1. Revocar la clave afectada desde la consola del proveedor.
2. Poner la nueva en Railway → Variables → Deploy Changes.
3. Revisar usuarios, sesiones y cambios recientes (ver sección 1).
4. Anotar la fecha de la revisión en `/admin` y en este documento.