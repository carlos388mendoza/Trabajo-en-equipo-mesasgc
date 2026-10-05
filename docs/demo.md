# Guion de la demo (unos 10 minutos)

Para presentar **Table Waitlist** entre los dos:

- **Carlos (Miembro A):** editor, mapa, tiempo real y permisos.
- **Su compañero (Miembro B):** modo rápido, estadísticas e IA.

Todos los usuarios de prueba entran con la contraseña **`12345abc`**.

## 1. Qué es, en dos frases

Table Waitlist es una aplicación web para manejar en tiempo real la lista de
espera de los restaurantes de Grupo Comidas: se anota a los clientes, se les
avisa y se les sienta en un plano de mesas que cada local dibuja a su medida.
Cada rol ve solo lo suyo, y la dirección tiene un mapa general de todos los
restaurantes y estadísticas con un asistente de IA.

## 2. Orden de la demo

Los tiempos son orientativos: suman unos 10 minutos.

### 2.1 Login y roles (Carlos, 1 min)

**Usuario:** ninguno todavía. Abre `/login`.

- **Enseña:** el logo de Grupo Comidas y el formulario de correo y
  contraseña. No hay registro público: los usuarios los crea un admin.
- **Di:** «Hay tres roles, y un usuario puede tener varios; los permisos se
  suman»:

  | Correo | Rol | Adónde entra |
  |---|---|---|
  | `admin@grupocomidas.test` | admin | Mapa general, `/admin`, todo |
  | `chinawok@grupocomidas.test` | restaurante (los 2 China Wok) | Sus dos locales: modo sencillo y plano |
  | `analitica@grupocomidas.test` | analitica | Estadísticas y mapa, solo lectura |

- **Haz:** entra como **admin**. Llega directo a `/mapa`.

### 2.2 Mapa general (Carlos, 1,5 min)

**Usuario:** `admin@grupocomidas.test`.

- **Enseña el mapa radar:** es un dibujo propio de San Pedro Sula y
  Tegucigalpa, con los 8 restaurantes de las 4 marcas (China Wok, Pizza Hut,
  KFC y Denny's).
- **Explica el marcador:**
  - el color es la marca;
  - el número, los clientes en espera;
  - el anillo, el % de mesas ocupadas;
  - debajo, la espera media.
- **Explica la alerta:** más de 20 minutos, halo amarillo con un triángulo;
  más de 40, halo rojo más grueso con un octógono. «Se distingue por la
  forma, no solo por el color.»
- **Filtra:** por marca (toca **KFC**) y por ciudad. Quita los filtros.
- **Toca KFC Boulevard Morazán** (está en rojo): el zoom entra al **plano en
  vivo**, con mesas libres, ocupadas y reservadas y el nombre de cada
  cliente. Vuelve con **«Volver al mapa general»**.
- **Di:** «El mapa se actualiza solo por una sala de Socket.IO que lleva
  únicamente números, nunca nombres de clientes».

### 2.3 Editor de mesas (Carlos, 2 min)

**Usuario:** `admin`. Abre `/restaurante/rest_centro/editor`, Comedor
principal.

- **Arrastrar:** mueve una mesa y redimensiona otra con las esquinas.
- **Tipos de elementos:** en la paleta hay mesa con sillas, mesa con
  butacas, área de juegos, baño, caja y los tres nuevos: **barra** (con
  banquetas), **puerta** (con su arco de apertura) y **pared** (bloque
  sólido). Toca cada uno para añadirlo y arrástralo a su sitio.
- **Girar el plano completo:** pulsa **Girar ↻**. Gira toda la zona, y el
  minimapa también. Pulsa **Guardar** y recarga la página: sigue girado. «El
  giro se guarda en la base de datos y lo respeta el plano en vivo.»
- **Deshacer:** Ctrl+Z vuelve atrás un movimiento.
- **Copiar plano:** pulsa **Copiar plano** y elige un restaurante. Copia
  todas las zonas, con su giro. Si el destino tiene mesas ocupadas, lo
  rechaza.
- **Antes de seguir:** vuelve a girar a 0° y guarda, para que el resto de la
  demo se vea como siempre.

### 2.4 Tiempo real y conflicto de mesas (Carlos, 1,5 min)

**Usuario:** `admin`, con **dos pestañas** abiertas en
`/restaurante/rest_centro/editor`. Abajo a la izquierda, las dos dicen «en
vivo».

1. En una terminal aparte:

   ```bash
   npm run demo:host -- sentar tbl_c_1 wl_1
   ```

   La Mesa 1 se pinta **ocupada en las dos pestañas a la vez**, con el nombre
   del cliente (Ana Torres).
2. **El conflicto:**

   ```bash
   npm run demo:host -- carrera tbl_c_2 wl_2 wl_3
   ```

   Dos hosts piden la misma mesa a la vez. Uno gana y el otro recibe **«Esta
   mesa ya fue asignada»**.
3. **Di:** «Gana el primero que llega a la base de datos: es un solo UPDATE
   condicional, bloqueo optimista, no un candado».
4. Libera la mesa para dejarlo como estaba:

   ```bash
   npm run demo:host -- liberar tbl_c_1 wl_1
   ```

Si quieres, abre `/mapa` en una tercera pestaña antes del paso 1: el
marcador de China Wok Centro cambia sin recargar.

### 2.5 Modo rápido (compañero, 1,5 min)

**Usuario:** cierra sesión y entra como `chinawok@grupocomidas.test`. En
`/inicio` elige **China Wok Centro** (o usa «Modo sencillo» de la cabecera) y
llega a `/restaurante/rest_centro/rapido`.

- **Agregar:** un cliente con nombre, personas y una nota.
- **Tarjetas tipo Tinder:** desliza la tarjeta de arriba **a la derecha
  para «listo»** y **a la izquierda para «ausente»**. Funciona con el dedo y
  con el ratón, y la tarjeta gira y muestra el sello.
- **Deshacer:** con el botón o con **Ctrl+Z**; el cliente vuelve a la fila.
- **Di:** «Todo va en vivo por Socket.IO: si otra tablet del mismo local
  tiene la lista abierta, ve el cambio al momento, y el mapa general también».

### 2.6 Estadísticas y asistente IA (compañero, 1 min)

**Usuario:** cierra sesión y entra como `analitica@grupocomidas.test`. Llega
a `/analiticas`.

- **Enseña:** los últimos **14 días en hora de Honduras**: grupos sentados,
  espera promedio, día más rápido y más lento, **tiempo hasta avisar** (sale
  de `called_at`, la hora en que se marcó «listo»), la comparación por
  restaurante y el top 10 de clientes.
- **Si ves ceros:** «grupos sentados» cuenta a los que se sentaron con mesa.
  Los que sentaste con `demo:host` en el paso 2.4 deberían aparecer; si no,
  pulsa «Actualizar».
- **Asistente IA:** toca una de las preguntas sugeridas, por ejemplo «¿Cuál
  fue el día más lento?».
- **Di:** «Tiene un límite de 10 preguntas por minuto y por usuario».

### 2.7 Permisos (Carlos, 1 min)

**Usuario:** entra como `chinawok@grupocomidas.test`.

- **Enseña:** en el encabezado solo salen **sus** dos restaurantes (el
  selector) y no hay «Mapa» general: el plano en vivo de cada local está en la
  navegación del restaurante (`/restaurante/rest_centro/mapa`).
- **Escribe a mano en la barra de direcciones:**
  - `/mapa` → va a **`/sin-acceso`**;
  - `/restaurante/rest_norte/mapa` → **`/sin-acceso`**;
  - `/restaurante/rest_norte/editor` → **`/sin-acceso`**.
- **Di:** «Ocultar un botón no protege nada: cada página, action, API y
  evento de Socket.IO vuelve a comprobar el permiso en el servidor».
- **Si da tiempo:** como analitica, el zoom del mapa **no muestra nombres
  de clientes**; el servidor los quita antes de responder.

### 2.8 Temas (Carlos, 30 s)

**Usuario:** cualquiera. Abre `/ajustes`.

- **Enseña:** **Claro**, **Oscuro**, **Sistema** y **Personalizado**. En
  Personalizado se eligen cuatro colores y la app avisa si algo se lee mal.
- **Termina en Oscuro** y abre `/mapa` o el editor: el radar luce mejor.

## 3. Cómo preparar la demo antes

**El día antes:**

1. Usa la rama que tenga todo. Hoy es `feat/layout-rotation`; cuando se
   fusionen los PR, `testing`. Instala con `npm install`.
2. `.env.local` tiene que tener `TURSO_DATABASE_URL=file:./local.db` y un
   `BETTER_AUTH_SECRET`. No hace falta `OPENROUTER_API_KEY`: sin ella, el
   asistente contesta en local.
3. **Solo en una base nueva** (un clon limpio, sin `local.db`), aplica las
   migraciones:

   ```bash
   npm run db:migrate
   ```

   En el portátil de Carlos no hace falta: su `local.db` ya tiene las
   migraciones 0002 y 0003, y como se creó con `db:push`, `db:migrate`
   fallaría allí.
4. Siembra los datos:

   ```bash
   npm run seed:reset
   ```

   Deja 8 restaurantes con mesas, clientes y los 5 usuarios de prueba.
5. **Carga además los datos de demostración** (README §17), para que
   `/analiticas` y el asistente tengan ocho semanas de historia que contar:

   ```bash
   npm run db:demo
   ```

   Pide escribir «si». En el modo sencillo las cartas de demostración llevan
   la etiqueta «Demo». Al terminar, bórralos con `npm run db:demo:borrar`
   (pide escribir `BORRAR`).
   Si prefieres la demo limpia, sáltate este paso (pero entonces las
   estadísticas salen casi vacías).
6. Pasa las comprobaciones, para no llevarte sorpresas:

   ```bash
   npm run verify:realtime
   ```

   Opcionalmente, también `npm run verify:editor` y `npm run verify:auth`.

**15 minutos antes:**

1. Otra vez `npm run seed:reset`: las esperas del mapa cuentan desde ese
   momento, así que salen los tres colores (normal, amarillo y rojo). Si
   cargaste el lote de demostración, `db:demo` también es idempotente: volver a
   correrlo no duplica nada y deja las esperas como estaban.
2. Arranca la app con `npm run dev` (Next y Socket.IO en el puerto 3000).
3. Abre y deja listas:
   - **Pestaña 1:** `/login`.
   - **Pestañas 2 y 3:** `/restaurante/rest_centro/editor` (se entra como
     admin al empezar).
   - **Una terminal** en la carpeta del proyecto, para `demo:host`.
4. **Restaurante para la demo:** **`rest_centro`** («China Wok Centro»). Sus
   mesas `tbl_c_1` y `tbl_c_2` están siempre libres para `demo:host`, y sus
   clientes `wl_1`, `wl_2` y `wl_3` esperan. Para el zoom del mapa, **KFC
   Boulevard Morazán**, que sale en rojo.
5. **Tema:** Claro para empezar; el cambio a Oscuro se enseña al final.

## 4. Si algo falla en vivo

| Qué pasa | Qué hacer |
|---|---|
| Una página se queda en blanco o cargando la primera vez | Es Next compilando esa ruta. Espera 5 segundos y recarga. |
| El editor dice «sin conexión» | El servidor de tiempo real va con `npm run dev`, no con `npm run dev:next`. Revisa la terminal y reinicia. |
| `demo:host` dice «Esta mesa ya fue asignada» con `sentar` | La mesa ya estaba ocupada. Libérala con `liberar` o usa `tbl_c_2`. |
| `demo:host` dice que el cliente ya no está en la lista | Ya se sentó antes. Usa otro (`wl_2`, `wl_3`) o haz `npm run seed:reset`. |
| El mapa no enseña colores de alerta | Las esperas se calculan desde el seed. Haz `npm run seed:reset` y recarga `/mapa`. |
| No deja entrar con un usuario | Contraseña `12345abc`. Si un admin lo desactivó, `seed:reset` no lo reactiva: hazlo en `/admin`. |
| Quedó una sesión abierta de otro usuario | Cierra sesión arriba a la derecha. La cookie es de `localhost`, sirve para cualquier puerto. |
| Todo va mal | Ten capturas de respaldo, y explica el flujo con el guion mientras alguien reinicia con `npm run seed:reset` y `npm run dev`. |

## 5. Preguntas que podría hacer el profesor

**¿Qué es el bloqueo optimista y por qué lo usan?**
No se bloquea la mesa antes de asignarla. Se asigna con una sola sentencia
condicional:
`UPDATE tables SET current_entry_id = ? … WHERE id = ? AND current_entry_id IS NULL`.
La base de datos la ejecuta de forma atómica. Si dos hosts la lanzan a la
vez, uno cambia una fila y el otro cero: el que cambió cero perdió y recibe
«Esta mesa ya fue asignada», y solo a él se le avisa. Es más simple que un
candado y no deja mesas bloqueadas si alguien cierra la pestaña. Además, un
índice único impide que un cliente esté en dos mesas. Lo prueba
`verify:realtime`, con 2 y con 10 hosts a la vez.

**¿Cómo funciona el RBAC?**
Todas las reglas están en un solo archivo, `lib/auth/rbac.ts`, con la
función `can(usuario, acción, restaurante)`. Un usuario puede tener varios
roles y sus permisos se suman. El rol restaurante solo vale en sus
restaurantes (tabla `user_restaurants`). La comprobación de verdad se hace en
el servidor, en cada página, server action, API y evento de Socket.IO. El
`proxy.ts` solo mira si hay cookie. Sin permiso, una página redirige a
`/sin-acceso` y una API responde 403. La tabla completa está en
`docs/rbac.md`, y `verify:auth` levanta la app real y lo prueba por rol.

**¿Por qué Socket.IO y por qué un `server.ts` propio?**
Hace falta que el servidor avise a las tablets cuando algo cambia, y
Socket.IO trae reconexión automática y salas (*rooms*): hay una sala por
restaurante, así cada local solo recibe sus eventos, y otra sala `overview`
para el mapa general. Next por sí solo no mantiene conexiones WebSocket
abiertas. Por eso `server.ts` sirve Next y Socket.IO en el mismo servidor y
el mismo puerto: Railway expone un solo puerto, y así el navegador se conecta
al mismo origen, sin CORS.

**¿Tienen CI/CD?**
Sí. GitHub Actions corre en cada pull request hacia `testing` o `main` y en
cada push a esas ramas: typecheck, lint, build y las cuatro verificaciones
(`verify:editor`, `verify:realtime`, `verify:auth` y `verify:demo`). No usa
ningún *runner* de tests: son scripts que levantan una SQLite temporal y aplican
las migraciones del repositorio, así que nunca tocan Turso ni OpenRouter. Las dos
ramas tienen un *ruleset* que exige el CI en verde y **no permite borrarlas ni
hacer *force push***, ni siquiera para los administradores. El despliegue a
Railway solo se dispara al fusionar `testing` → `main`, y con «Wait for CI»
activo, así que Railway tampoco despliega nada con el CI en rojo.

**Otras que pueden salir:**

- **¿Y si quieren datos de mentira para probar?** Hay un lote que se carga con
  `npm run db:demo` y se borra con `npm run db:demo:borrar` (escribiendo
  `BORRAR`). Cada fila que inserta lleva `is_demo` y
  `demo_batch_id`, dos columnas de una migración que solo añade cosas
  (`0007`). El borrado usa esas columnas y **nunca el nombre**, así que
  renombrar una zona de demostración no la salva ni renombrar una real la mete
  en el lote. Va en una transacción y, si algún dato **real** dependiera de algo
  de demostración, **aborta sin escribir nada**: es más preferable fallar a que
  se lleve por delante algo que no era suyo. Mientras haya datos de
  demostración, un aviso lo dice en todas las pantallas y desaparece solo
  cuando ya no queda nada. Nunca crea ni toca usuarios ni contraseñas.
- **¿Por qué SQLite y Turso?** Es SQLite en la nube, con la misma base en
  local (`local.db`) y en producción. Las migraciones se generan con
  `drizzle-kit generate` y son solo aditivas.
- **¿Qué ve analitica?** Estadísticas y el mapa de todos, pero nunca nombres
  de clientes: el servidor los quita del plano en vivo.
- **¿Qué pasa si se cae la conexión?** El cliente se reconecta y vuelve a
  entrar en su sala. El mapa además pide los contadores cada 30 s como
  respaldo.
