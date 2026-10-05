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
| `catalogo:gestionar` | Crear, editar y desactivar marcas y restaurantes (`app/admin/catalog-actions.ts`) | Sí | — | — |
| `editor:ver` | Ver el plano; nombre del cliente en vivo | Sí | Suyos | — |
| `editor:guardar` | Guardar, copiar y pegar la estructura, y **elegir el plano por defecto** (`setDefaultLayoutAction`) | Sí | Suyos | — |
| `meseros:gestionar` | Crear, editar, borrar y **activar** configuraciones de zonas de meseros (`app/restaurante/[id]/meseros/actions.ts`). Verlas solo pide `plano:ver` | Sí | Suyos | — |
| `rapido:ver` | `GET /api/restaurante/[id]/clientes` | Sí | Suyos | — |
| `rapido:modificar` | `POST …/clientes` y `PATCH …/clientes/[clienteId]` | Sí | Suyos | — |
| `mesas:asignar` | Socket.IO `table:assign` y `table:release` | Sí | Suyos | — |
| `analiticas:ver` | `GET /api/analiticas` | Sí | — | Sí |
| `asistente:usar` | `POST /api/assistant` (10 preguntas por minuto y por usuario) | Sí | — | Sí |
| `mapa:ver` | `/mapa`, la action `loadOverviewCounters` y la sala `overview` de Socket.IO | Sí | — | Sí |
| `plano:ver` | `/restaurante/[id]/mapa` y la action `loadLivePlan` (estados y ocupación) | Sí | Suyos | Sí |
| `plano:clientes` | Nombre del cliente de cada mesa en el plano en vivo | Sí | Suyos | — |
| `demo:ver` | Ver que hay datos de demostración y cuántos son. Sin pantalla desde el 5 de octubre: se conserva para `lib/demo` | Sí | — | Sí |
| `demo:borrar` | Borrarlos. Sin pantalla desde el 5 de octubre: se borran con `npm run db:demo:borrar` | Sí | — | — |

Las dos últimas son globales, no de un restaurante. `demo:ver` es de admin y
analítica: quien mira el mapa o las estadísticas tiene derecho a saber si los
números son reales. Desde el 2 de octubre el host ya no la tiene (pedido de la
dirección): en el modo sencillo cada carta de demostración lleva la etiqueta
**«Demo»**, que basta para distinguirla. `demo:borrar` es solo del admin,
porque es la operación que más filas elimina de golpe.

Cinco casos que vale la pena tener presentes:

- **Varios restaurantes, un usuario** (el piloto: `dennys@` con los 2 de
  Denny's y `pizzahut@` con los 2 de Pizza Hut). Con el rol restaurante y
  varios restaurantes asignados, tiene el modo sencillo
  y el completo en **cada uno** y en ningún otro. En `/inicio` ve una
  tarjeta por restaurante, y la cabecera le muestra un selector para cambiar
  entre ellos. Es solo navegación: cada página, API y evento de socket vuelve
  a comprobar `can()`, y el socket usa la room en la que entró, nunca el
  `restaurantId` del payload.

- **Un restaurante desactivado** (`restaurants.active = false`) deja de contar
  en los `restaurantIds` del usuario (`loadAuthUser`), así que su host pierde
  el acceso en páginas, API, actions y socket, sin tocar `can()`. El admin
  sigue entrando. Su asignación en `user_restaurants` se conserva: al
  reactivarlo, el host lo recupera.

- **Copiar la estructura a otro restaurante** exige `editor:guardar` en los
  **dos** restaurantes, y copiar una zona también en el de la zona de destino.
- **Entrar en la room de Socket.IO de un restaurante** exige `editor:ver` o
  `rapido:ver` en él. Por eso analitica no entra en ninguna: no edita nada en
  vivo, y en esas rooms viajan los ids de los clientes.
- **Borrar los datos de demostración** ya no se hace desde la web: solo con
  `npm run db:demo:borrar` en la terminal. El host distingue las cartas de
  demostración por su etiqueta «Demo».

## Datos de demostración

Desde el 5 de octubre (pedido de la dirección) **la interfaz de datos demo ya
no existe**: ni el aviso «Hay datos de demostración cargados», ni el enlace
«Datos demo», ni la sección de `/admin`, ni `/admin/datos-demo` (da 404), ni
su server action. Los datos se quedan, con `is_demo` y `demo_batch_id`, y se
cargan y borran desde la terminal (`npm run db:demo` y `npm run db:demo:borrar`,
o con `railway run` en producción).

- En el modo sencillo cada carta de demostración sigue llevando la etiqueta
  **«Demo»**.
- `demo:ver` y `demo:borrar` siguen en `lib/auth/rbac.ts`: `verify:demo`
  comprueba su matriz, y `verify:auth` que no queda ningún rastro de la
  interfaz y que los datos siguen ahí.

## Zonas de meseros y plano por defecto

Dos requisitos del enunciado: «manejo de zonas de meseros, guardar
configuración por cantidad de meseros activa y la opción de cambiar entre
configuración de zonas fácilmente» y «la configuración de las mesas por
defecto en cada restaurante, las actualizaciones de la estructura de las mesas
las hacen los usuarios de los restaurantes».

| Qué | admin | restaurante | analitica |
|---|:---:|:---:|:---:|
| Ver el selector «Meseros activos», los colores y la leyenda en el plano en vivo | Sí | Suyos | Sí (solo lectura) |
| Cambiar la configuración activa (un toque) | Sí | Suyos | — |
| Crear, editar (nombres, colores, reparto) y borrar configuraciones | Sí | Suyos | — |
| Ver quién atiende al sentar (modo sencillo) | Sí | Suyos | — (no opera) |
| Estadísticas por mesero y preguntarle al asistente | Sí | — | Sí |
| Editar la estructura (mover, añadir, borrar, girar, copiar y pegar) | Sí | Suyos | — |
| Elegir el plano por defecto | Sí | Suyos | — |

- **Se comprueba en el servidor**, como todo lo demás: cada server action
  vuelve a pedir el permiso con el `restaurantId` del payload, y además
  `lib/waiters/configs.ts` comprueba que la configuración, sus zonas y sus
  mesas sean de **ese** restaurante (no vale mandar una configuración ajena
  con el id de un restaurante propio).
- **Tiempo real:** `waiters:changed` va a la room del restaurante. Analítica
  no entra en las rooms: su plano se recarga cuando cambia `waitersKey` en
  los contadores de la sala overview (id y versión de la configuración activa,
  sin datos de clientes).
- Lo prueban `verify:auth` (páginas, server actions por HTTP y el aviso por
  socket a otra tablet), `verify:editor` y `verify:realtime`.

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

Revisado el 1 de octubre de 2026 contra la app real en local, con los
usuarios del seed, y ampliado el 5 de octubre con las zonas de meseros y el
plano por defecto. Todas las pruebas están en `npm run verify:auth` (392/392):
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
| **Zonas de meseros**: varias configuraciones por restaurante, una activa, cambio con un toque | Sí | «Zonas de meseros y plano por defecto»: el host de `rest_centro` activa «3 meseros» por la server action y la otra tablet recibe `waiters:changed`; analítica y norte reciben «No tienes permiso» al activar, guardar, crear o borrar, y una configuración de `rest_centro` no se activa con el id de `rest_norte`. Al sentar, el ack, el aviso y el cliente guardan el mesero. |
| **Plano por defecto**, y la estructura la actualizan los usuarios de su restaurante | Sí | Mismo bloque: centro marca la Terraza como plano por defecto y el editor la abre; norte y analítica no pueden; una zona de otro restaurante no se puede marcar; el admin también puede. Guardar, copiar y pegar la estructura pide `editor:guardar` («Server actions del editor»). |
