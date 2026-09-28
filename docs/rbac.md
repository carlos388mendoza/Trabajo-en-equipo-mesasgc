# Permisos por rol (RBAC)

La fuente de verdad es `lib/auth/rbac.ts`: esta tabla la resume. Si cambia una
regla, cambia allí (y aquí).

Hay tres roles:

- **admin**
- **restaurante**
- **analitica**

Un usuario puede tener varios a la vez, y **sus permisos se suman**. Por
ejemplo, con «restaurante + analitica» edita sus restaurantes y ve las
estadísticas de todos.

Qué significa cada marca:

- **Sí**: en todos los restaurantes.
- **Suyos**: solo en los restaurantes que tiene asignados (tabla
  `user_restaurants`).
- **—**: no tiene acceso. En una página redirige a `/sin-acceso`; en una API
  responde **403**.

## Pantallas

| Pantalla | admin | restaurante | analitica |
|---|:---:|:---:|:---:|
| `/login` (sin sesión) | Sí | Sí | Sí |
| `/inicio`, `/ajustes`, `/sin-acceso` | Sí | Sí | Sí |
| `/admin` (usuarios) | Sí | — | — |
| `/restaurante/[id]/rapido` (modo sencillo) | Sí | Suyos | — |
| `/restaurante/[id]/editor` (plano, modo completo) | Sí | Suyos | — |
| `/analiticas` (vista global y por restaurante) | Sí | — | Sí |

## Acciones

| Acción (`can`) | Qué protege | admin | restaurante | analitica |
|---|---|:---:|:---:|:---:|
| `usuarios:gestionar` | Crear, editar, restablecer contraseña y desactivar usuarios (`app/admin/actions.ts`) | Sí | — | — |
| `editor:ver` | Ver el plano; nombre del cliente en vivo | Sí | Suyos | — |
| `editor:guardar` | Guardar y copiar la estructura (server actions del editor) | Sí | Suyos | — |
| `rapido:ver` | `GET /api/restaurante/[id]/clientes` | Sí | Suyos | — |
| `rapido:modificar` | `POST …/clientes` y `PATCH …/clientes/[clienteId]` | Sí | Suyos | — |
| `mesas:asignar` | Socket.IO `table:assign` y `table:release` | Sí | Suyos | — |
| `analiticas:ver` | `GET /api/analiticas` | Sí | — | Sí |
| `asistente:usar` | `POST /api/assistant` (10 preguntas por minuto y por usuario) | Sí | — | Sí |

Dos casos que vale la pena tener presentes:

- **Copiar la estructura a otro restaurante** exige `editor:guardar` en los
  **dos** restaurantes, y copiar una zona también en el de la zona de destino.
- **Entrar en la room de Socket.IO de un restaurante** exige `editor:ver` o
  `rapido:ver` en él. Por eso analitica no entra en ninguna: no edita nada en
  vivo.

## Sin sesión

| Dónde | Qué pasa |
|---|---|
| Páginas | `proxy.ts` redirige a `/login?next=…`. La página vuelve a comprobarlo en el servidor. |
| API routes | **401** con «Tu sesión terminó. Vuelve a entrar.» |
| Server actions | Devuelven el mismo mensaje. Si se llaman sin cookie, el proxy redirige a `/login`. |
| Socket.IO | El handshake rechaza la conexión. |

## Usuario desactivado

- No puede iniciar sesión: «Usuario desactivado».
- Al desactivarlo se cierran sus sesiones, así que tampoco puede usar una
  cookie vieja.
- El socket lo rechaza en el handshake y, si ya estaba conectado, en el
  siguiente evento.

## Destino después del login (`/inicio`)

| Usuario | Va a |
|---|---|
| Solo admin | `/admin` |
| Solo restaurante, con 1 restaurante | `/restaurante/[id]/rapido` |
| Solo analitica | `/analiticas` |
| Varios roles o varios restaurantes | Pantalla para elegir |

## Reglas propias de `/admin`

- **No hay registro público:** los usuarios solo los crea un admin (o
  `npm run create-admin`).
- **Un admin no puede quitarse su propio rol de admin ni desactivarse.**
- **Un usuario con el rol restaurante necesita al menos un restaurante.** Con
  otros roles, los restaurantes se ignoran.
- **Restablecer la contraseña cierra las sesiones abiertas de ese usuario.**
