# Salida a producción de Table Waitlist

Documento para la dirección de Grupo Comidas. Explica qué hay que tener
listo antes de usar la aplicación con clientes reales, cómo probarla primero
en un solo restaurante y qué hacer si falla.

## 1. Qué es y qué problema resuelve

Table Waitlist reemplaza la lista de espera en papel de cada restaurante: el
host anota al cliente en una tablet, lo avisa cuando hay mesa y lo sienta en
un plano del local. Todas las tablets del mismo restaurante ven los cambios
al instante, y la aplicación impide que dos personas den la misma mesa a la
vez. La dirección ve en un mapa general, en vivo, qué restaurantes están
llenos o con esperas largas, y tiene estadísticas de espera por día y por
restaurante.

## 2. Lista de revisión antes de producción

Cada punto tiene un responsable. «Equipo» es Carlos y su compañero;
«Dirección» es quien decide en Grupo Comidas.

### 2.1 Usuarios y accesos

- [ ] **(Equipo)** No cargar datos de prueba. En producción no se ejecuta el
      seed, y los 5 usuarios de prueba (contraseña `12345abc`) solo se crean en
      desarrollo.
- [ ] **(Equipo)** Si algún usuario de prueba llegó a la base real,
      **desactivarlo** desde `/admin`. La aplicación no borra usuarios: los
      desactiva y les cierra la sesión.
- [ ] **(Equipo)** Crear el **primer administrador real** con
      `npm run create-admin`. Pide el nombre, el correo y la contraseña, y
      no deja ninguna contraseña escrita en el código.
- [ ] **(Dirección)** Decidir **quién es administrador**. Recomendamos como
      mucho 2 personas.
- [ ] **(Equipo)** El administrador crea, desde `/admin`, un usuario por
      host con el rol **restaurante** y su restaurante asignado. No se
      comparten usuarios entre personas.
- [ ] **(Dirección)** Decidir quién tiene el rol **analitica** (estadísticas
      y mapa, solo lectura).

### 2.2 Configuración del servidor (Railway)

La aplicación vive en Railway. Estas variables se cargan en el panel de
Railway, **nunca en el código**:

| Variable | Qué es | Quién la pone |
|---|---|---|
| `TURSO_DATABASE_URL` | Dirección de la base de datos de producción | Equipo |
| `TURSO_AUTH_TOKEN` | Llave de acceso a esa base | Equipo |
| `BETTER_AUTH_SECRET` | Clave que firma las sesiones. Única y larga, distinta de la de desarrollo | Equipo |
| `BETTER_AUTH_URL` | La dirección pública de la aplicación (con `https://`) | Equipo |
| `OPENROUTER_API_KEY` | Llave del asistente de IA. Opcional: sin ella, el asistente responde solo las preguntas básicas | Dirección decide, Equipo la carga |
| `OPENROUTER_MODEL` | Modelo de IA que se usa | Equipo |

- [ ] **(Equipo)** Aplicar las migraciones de la base con
      `npm run db:migrate` (nunca `db:push` contra la base real).
- [ ] **(Equipo)** Comprobar que el CI de GitHub sale en verde en `testing`
      antes de pasar a `main`, que es la rama que se publica.

### 2.3 Respaldos de la base de datos (Turso)

- [ ] **(Equipo)** Activar los respaldos automáticos o la restauración a un
      momento anterior que ofrezca el plan de Turso contratado, y anotar cada
      cuánto se hacen y cuánto tiempo se guardan.
- [ ] **(Equipo)** Probar **una vez** a restaurar un respaldo en una base
      aparte, antes del piloto. Un respaldo que nunca se probó no es un
      respaldo.
- [ ] **(Dirección)** Decidir cuánto tiempo se guarda el historial de
      clientes (ver 2.5).

### 2.4 Gasto del asistente de IA (OpenRouter)

- [ ] **(Dirección)** Fijar un **límite de gasto mensual** en la cuenta de
      OpenRouter, desde su panel, y quién recibe los avisos.
- [ ] **(Equipo)** La aplicación ya limita a **10 preguntas por minuto y por
      usuario**, y solo pueden usar el asistente los roles admin y analitica.
- [ ] **(Dirección)** Si no se quiere gasto de IA durante el piloto, basta
      con no cargar `OPENROUTER_API_KEY`.

### 2.5 Datos personales: qué guardamos y quién los ve

**Qué se guarda de cada cliente:**

| Dato | ¿Se pide hoy? | Para qué |
|---|---|---|
| Nombre | Sí | Llamarlo cuando hay mesa |
| Tamaño del grupo | Sí | Elegir la mesa y las estadísticas |
| Nota | Opcional | Detalles como «silla para bebé» |
| Horas de llegada, aviso y asiento | Sí, automáticas | Medir la espera |
| Teléfono | **No.** La base tiene el campo, pero la aplicación no lo pide | — |

No se guardan correos, documentos de identidad ni datos de pago de los
clientes.

**Quién ve qué:**

| Rol | Nombres de clientes | Estadísticas |
|---|---|---|
| **Host (restaurante)** | Solo los de **su** restaurante | No |
| **Analitica** | En el mapa y el plano en vivo, **no**. En las estadísticas, **sí**: el «top 10 de clientes» se agrupa por nombre | Todos los restaurantes |
| **Administrador** | Todos | Todos |

**Decisiones pendientes de la dirección:**

- [ ] **Nombres en las estadísticas.** ¿Está bien que analitica vea el
      «top 10 de clientes» con nombre? Si no, el equipo puede quitarlo o
      mostrarlo anónimo.
- [ ] **Nombres fuera de la empresa.** Con `OPENROUTER_API_KEY` cargada, al
      hacerle una pregunta al asistente se envían a OpenRouter (un servicio
      externo) las estadísticas, **incluidos los nombres del top de
      clientes**. Opciones: aceptarlo, pedir al equipo que los anonimice antes
      de enviarlos, o no activar la IA.
- [ ] **Cuánto tiempo guardar** el historial de clientes antes de borrarlo.
- [ ] **Aviso al cliente.** Si hace falta informar al cliente de que se
      anota su nombre (por ejemplo, un cartel en la entrada), según lo que
      pida el área legal.

## 3. Plan de piloto

**Dónde:** un solo restaurante con buen volumen, y un encargado dispuesto a
dar comentarios. Sugerencia: **China Wok Centro** (Tegucigalpa).

**Cuánto:** una semana completa, de lunes a domingo, incluido un fin de
semana con hora pico.

**Durante el piloto:**

- La lista en papel sigue **al lado de la tablet** como respaldo (ver 6).
- Un miembro del equipo está localizable por teléfono en las horas pico.
- Cada noche, el encargado anota en una hoja qué falló o qué costó.

**Qué medir:**

| Qué | Dónde se ve | Meta orientativa |
|---|---|---|
| Espera promedio | Estadísticas | Que no suba respecto al papel |
| Tiempo hasta avisar | Estadísticas | Que baje: se avisa antes |
| Clientes ausentes | Modo sencillo, «Actividad de hoy» | Saber cuántos se van sin esperar |
| Errores y «Sin conexión» | La hoja del encargado | Ninguno que obligue a volver al papel más de 10 minutos |
| ¿Los hosts la usan? | Charla con el encargado | Que la prefieran al papel |

**Cuándo pasar a los 8 restaurantes:**

- ✅ Durante la semana no hubo que volver al papel por más de 10 minutos
  seguidos.
- ✅ Los hosts la usan sin ayuda después del segundo día.
- ✅ Ningún error que perdiera clientes de la lista.
- ✅ La dirección tomó las decisiones de datos personales (2.5).

Si se cumple todo: añadir **2 restaurantes por semana**, y no los 7 de
golpe, para dar soporte a cada uno. Si no se cumple: corregir lo que falló y
repetir una semana en el mismo restaurante.

## 4. Manual del host (1 página)

> **Imprime esta sección y déjala junto a la tablet.**

**Entrar:** abre la aplicación, escribe tu correo y tu contraseña y pulsa
**Entrar**. Llegas directo a **Modo sencillo**.

**Agregar un cliente**

1. En **Agregar cliente**, escribe el **nombre**.
2. Elige **cuántas personas** son.
3. Si hace falta, escribe una **nota** (por ejemplo, «silla para bebé»).
4. Pulsa **Agregar a la fila**. El cliente entra al final de la fila.

**Cuando hay mesa (o el cliente se fue)**

La tarjeta grande de arriba es el **siguiente en la fila**.

- **Desliza a la derecha** (o pulsa ✓) → **Listo**: ya lo avisaste.
- **Desliza a la izquierda** (o pulsa ✕) → **Ausente**: no estaba o se fue.

**Si te equivocaste:** pulsa **Deshacer** (la flecha curva). Deshace solo la
**última** acción del restaurante, en cualquier tablet, y hay que hacerlo
enseguida. Si pasó mucho rato o alguien hizo otra cosa después, ya no se
puede: corrígelo a mano.

**Si arriba dice «Sin conexión» o «Reconectando»**

1. Espera 10 segundos: casi siempre vuelve sola.
2. Revisa el wifi de la tablet.
3. Recarga la página.
4. Si en 2 minutos no vuelve: **pasa a la lista en papel** y avisa al
   encargado. Cuando vuelva la conexión, pasa a la tablet a los que sigan
   esperando.

**Nunca compartas tu contraseña.** Si alguien nuevo necesita entrar, el
administrador le crea su propio usuario.

## 5. Costos mensuales aproximados

Para llenar con los precios del plan que se contrate. Los precios cambian,
así que se consultan en la página de cada proveedor el día que se decida.

| Servicio | Para qué | Plan elegido | Costo mensual | Quién paga | Notas |
|---|---|---|---|---|---|
| Railway | Servidor donde corre la aplicación | | | | |
| Turso | Base de datos y respaldos | | | | |
| OpenRouter | Asistente de IA (opcional) | | | | Con límite de gasto (2.4) |
| Dominio (opcional) | Dirección propia, por ejemplo `espera.grupocomidas.com` | | | | |
| **Total** | | | | | |

Las tablets y el wifi de cada restaurante no están incluidos.

## 6. Riesgos y qué hacer

| Riesgo | Qué pasa | Qué hacemos |
|---|---|---|
| Se cae internet en el restaurante | La tablet dice «Sin conexión» y no guarda cambios | Pasar a la lista en papel (ver abajo) |
| Se cae el servidor o la base | Nadie puede entrar | Papel en todos los restaurantes; el equipo revisa Railway y Turso |
| Se reinicia el servidor | Se pierde el «Deshacer» pendiente; el resto de la lista queda guardada | Nada: corregir a mano si hacía falta deshacer |
| Una tablet se descarga o se rompe | Ese host no puede usar la aplicación | Otra tablet o un teléfono con el mismo usuario; si no hay, papel |
| Un host olvida su contraseña | No puede entrar | El administrador la restablece en `/admin` |
| Error de un host (marcó ausente a quien estaba) | El cliente sale de la fila | Deshacer enseguida o volver a agregarlo |
| El gasto de IA sube | Factura más alta | El límite de OpenRouter lo corta; la app funciona sin IA |
| Crecer a más restaurantes | La aplicación corre en un solo servidor; varios servidores a la vez necesitarían cambios | Suficiente para los 8 restaurantes; revisarlo antes de crecer mucho más |

**Plan B en plena hora pico: volver a la lista en papel**

1. **Siempre hay una lista en papel y un bolígrafo junto a la tablet**,
   también después del piloto.
2. Si la aplicación falla más de 2 minutos, el host anota a los clientes
   **en papel**, con la hora de llegada, sin esperar a que vuelva.
3. El encargado avisa al equipo (teléfono o mensaje) con la hora y lo que se
   veía en pantalla.
4. Cuando la aplicación vuelve, pasa a la tablet **solo a los que siguen
   esperando**, en el mismo orden.
5. Al cierre, el encargado anota cuánto duró la caída. Así se decide si hay
   que reforzar algo antes de seguir.

La regla es simple: **el cliente nunca espera por la aplicación**. Si la
tablet estorba, se usa el papel.
