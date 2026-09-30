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
| Solo admin | `/mapa` (a `/admin` llega por el encabezado) |
| Solo restaurante, con 1 restaurante | `/restaurante/[id]/rapido` |
| Solo analitica | `/analiticas` (al mapa llega por el encabezado) |
| Varios roles o varios restaurantes | Pantalla para elegir (el gerente ve también el mapa general) |

La regla está en `landingFor` (`lib/auth/rbac.ts`).

El enlace «Mapa» del encabezado lleva a `/mapa` a quien tiene `mapa:ver`, y a
`/restaurante/[id]/mapa` al host que tiene un solo restaurante.

## Reglas propias de `/admin`

- **No hay registro público:** los usuarios solo los crea un admin (o
  `npm run create-admin`).
- **Un admin no puede quitarse su propio rol de admin ni desactivarse.**
- **Un usuario con el rol restaurante necesita al menos un restaurante.** Con
  otros roles, los restaurantes se ignoran.
- **Restablecer la contraseña cierra las sesiones abiertas de ese usuario.**

## Cumplimiento del enunciado

> «Múltiples roles, manejado como RBAC. Administrador: crear usuarios,
> accede a todas las pantallas de los restaurantes y a sus estadísticas.
> Usuario de restaurante: accede solo a su restaurante, modos sencillo y
> completo. Estadísticas: usuario especializado en las estadísticas de todos
> los restaurantes/marcas, vista completa y opción de ver por restaurante.»

Revisado el 30 de septiembre de 2026 contra la app real en local, con los
usuarios del seed. Todas las pruebas están en `npm run verify:auth` (174/174):
levanta la app y hace peticiones HTTP y de Socket.IO de verdad con la cookie
de cada usuario.

| Requisito | ¿Cumple? | Cómo se probó (`verify:auth`) |
|---|---|---|
| **Admin crea usuarios**, con uno o varios roles y restaurantes | Sí | Sección «RBAC del enunciado»: la server action `createUserAction`, llamada como admin, crea un usuario con los roles restaurante y analitica en `rest_centro` y `rest_norte`. En la base quedan sus 2 roles y sus 2 restaurantes. El usuario entra y ve lo que suman sus roles. |
| **Solo el admin** crea usuarios | Sí | La misma server action, llamada como centro, analitica y gerente, responde «No tienes permiso» y no crea ningún usuario. `/admin` redirige a `/sin-acceso` a los otros roles («Páginas por rol»). No hay registro público («Login»). |
| **Admin entra a cualquier restaurante**, en modo completo (editor) y sencillo (modo rápido) | Sí | «Páginas por rol»: 200 en `rapido` y `editor` de `rest_centro` y `rest_norte`. «RBAC del enunciado»: también en `rest_tgu_kfc` y `rest_sps_dennys`. API de clientes de `rest_norte`: 200. Socket: entra en la room de `rest_norte`. |
| **Admin ve las estadísticas de todos** | Sí | `/analiticas` → 200. `/api/analiticas` devuelve los 8 restaurantes. |
| **Restaurante: solo su restaurante**, por URL | Sí | centro y norte reciben `/sin-acceso` en `rapido`, `editor` y `mapa` del otro restaurante («Páginas por rol»). |
| … por API | Sí | GET, POST y PATCH de `/api/restaurante/<otro>/clientes` → 403 («API por rol»). |
| … por server action | Sí | Guardar el plano de `rest_norte` como centro → «sin permiso» («Server actions del editor»). |
| … por Socket.IO | Sí | centro y norte no entran en la room del otro («Socket.IO»). centro, dentro de su room, no puede sentar en una mesa de `rest_norte` ni resolver a un cliente de `rest_norte`, y ese cliente no cambia («RBAC del enunciado»). |
| **Restaurante: modo sencillo y completo** | Sí | centro: 200 en `/restaurante/rest_centro/rapido` y en `/editor`. Guarda su plano y sienta clientes por socket. |
| **Restaurante no ve `/admin`** ni las analíticas | Sí | `/admin` y `/analiticas` → `/sin-acceso`. `/api/analiticas` y `/api/assistant` → 403. |
| **Analítica: estadísticas de todos**, vista general | Sí | `/analiticas` → 200. `/api/analiticas` devuelve los 8 restaurantes y las 4 marcas. También tiene el mapa general y el asistente. |
| … **con filtro por restaurante y por marca** | Sí | `?restaurantId=rest_norte` → solo `rest_norte`. `?brandId=brand_kfc` → los 2 KFC. `?brandId=brand_kfc&city=Tegucigalpa` → solo KFC Boulevard Morazán. |
| **Analítica no opera mesas ni lista de espera** | Sí | API de clientes (GET, POST y PATCH) → 403. `rapido` y `editor` → `/sin-acceso`. Guardar el plano → «sin permiso». Socket: no entra en rooms, no puede asignar mesas ni añadir a la lista. En el plano en vivo no ve nombres. |
| **Analítica no ve `/admin`** | Sí | `/admin` → `/sin-acceso`, y `createUserAction` → «No tienes permiso». |
| **Múltiples roles: el gerente** (restaurante + analitica) tiene la suma y nada más | Sí | Tiene `rapido` y `editor` de `rest_centro`, `/analiticas`, `/mapa`, el asistente, la room de `rest_centro` y la sala overview. **No** tiene `rest_norte` (páginas, API GET/POST y socket), ni `/admin`, ni `createUserAction`. |
| **Protecciones en el servidor**, no solo botones escondidos | Sí | Todo lo de arriba se prueba **sin la interfaz**: peticiones directas a páginas, API routes, server actions y eventos de Socket.IO con la cookie de cada rol. `can()` (`lib/auth/rbac.ts`) se comprueba en cada página, action, API y evento de socket. `proxy.ts` solo mira si hay cookie. |
