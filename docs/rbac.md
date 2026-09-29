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
| `/mapa` (mapa general, todas las marcas) | Sí | — | Sí (solo lectura) |
| `/restaurante/[id]/mapa` (plano en vivo, solo lectura) | Sí | Suyos | Sí, sin nombres |

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
| `mapa:ver` | `/mapa`, la action `loadOverviewCounters` y la sala `overview` de Socket.IO | Sí | — | Sí |
| `plano:ver` | `/restaurante/[id]/mapa` y la action `loadLivePlan` (estados y ocupación) | Sí | Suyos | Sí |
| `plano:clientes` | Nombre del cliente de cada mesa en el plano en vivo | Sí | Suyos | — |

Dos casos que vale la pena tener presentes:

- **Copiar la estructura a otro restaurante** exige `editor:guardar` en los
  **dos** restaurantes, y copiar una zona también en el de la zona de destino.
- **Entrar en la room de Socket.IO de un restaurante** exige `editor:ver` o
  `rapido:ver` en él. Por eso analitica no entra en ninguna: no edita nada en
  vivo, y en esas rooms viajan los ids de los clientes.

## Mapa general y plano en vivo

- **Analitica no ve nombres de clientes.** En el plano en vivo ve el estado de
  cada mesa (libre, ocupada, reservada) y la ocupación, nada más. Los nombres
  los ven el admin y el propio restaurante (`plano:clientes`).
- **Se quitan en el servidor.** Sin `plano:clientes`, `getLivePlan`
  (`lib/map/queries.ts`) cambia el id del cliente por `"oculto"` y borra el
  nombre y la hora antes de responder. Ocultarlos en el navegador no
  protegería nada: se verían en la respuesta.
- **La sala `overview`** (mapa general) exige `mapa:ver`. Solo lleva
  contadores por restaurante: mesas totales, ocupadas y reservadas, clientes
  en espera y la hora media de llegada. Nunca nombres ni ids de clientes.
- **Se vuelve a comprobar al avisar.** Antes de cada envío, `emitOverview`
  comprueba `mapa:ver` de cada usuario de la sala. Si un admin le quitó el
  rol con el mapa abierto, su socket sale de la sala en ese momento.
- **Los permisos se suman también aquí.** «restaurante + analitica» (el
  gerente) ve el mapa general y el plano de todos los restaurantes, pero solo
  ve nombres en los suyos.

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
| Solo admin | Pantalla para elegir: `/admin` o `/mapa` |
| Solo restaurante, con 1 restaurante | `/restaurante/[id]/rapido` |
| Solo analitica | Pantalla para elegir: `/analiticas` o `/mapa` |
| Varios roles o varios restaurantes | Pantalla para elegir |

El enlace «Mapa» del encabezado lleva a `/mapa` a quien tiene `mapa:ver`, y a
`/restaurante/[id]/mapa` al host que tiene un solo restaurante.

## Reglas propias de `/admin`

- **No hay registro público:** los usuarios solo los crea un admin (o
  `npm run create-admin`).
- **Un admin no puede quitarse su propio rol de admin ni desactivarse.**
- **Un usuario con el rol restaurante necesita al menos un restaurante.** Con
  otros roles, los restaurantes se ignoran.
- **Restablecer la contraseña cierra las sesiones abiertas de ese usuario.**
