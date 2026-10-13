# Manual del administrador

Todo se hace en **/admin** (arriba, **Administración**). Solo el rol
**admin** entra ahí. Hay tres partes: **Usuarios**, **Marcas y restaurantes**
y **Configuración**.

> No compartas contraseñas por chat ni por correo. Cada persona tiene su
> propio usuario.

## 1. Usuarios

### Los roles

| Rol | Qué puede hacer |
|---|---|
| **Administrador** | Todo, en todos los restaurantes, incluido /admin. |
| **Restaurante** (host) | Modo sencillo, plano en vivo y editor **solo en sus restaurantes**. |
| **Analítica** | Estadísticas, asistente de IA y mapa de todos los restaurantes. No atiende clientes ni ve sus nombres en el plano. |

Un usuario puede tener más de un rol y más de un restaurante.

### Crear un usuario

1. En **Usuarios**, toca **Nuevo usuario**.
2. Escribe el **nombre** y el **correo**.
3. Elige los **roles**. Para el rol restaurante, marca sus **restaurantes**.
4. La **contraseña temporal** se genera sola (**Generar otra** para cambiarla).
   Mínimo 8 caracteres.
5. Guarda y **entrega la contraseña en persona**. Pídele que no la comparta.

### Cambiar roles o restaurantes (acceso)

1. En la fila del usuario, toca **Acceso**.
2. Cambia los roles o los restaurantes y guarda.
3. El cambio vale desde su siguiente acción. No puedes quitarte a ti mismo el
   rol de admin.

### Cambiar una contraseña

1. En la fila del usuario, toca **Contraseña**.
2. Escribe la **nueva contraseña** dos veces y guarda.
3. **Se cierran sus sesiones abiertas**: tendrá que volver a entrar con la
   nueva.

### Desactivar o activar

1. En la fila del usuario, toca **Desactivar** y confirma.
2. No puede volver a entrar y se cierran sus sesiones. **No se borra nada**:
   su historial sigue en las estadísticas.
3. Para que vuelva: **Activar**. No puedes desactivarte a ti mismo.

## 2. Marcas y restaurantes

### Marcas

1. **Nueva marca**: nombre y color (sale en el mapa y en las estadísticas).
2. **Editar** para cambiarlos, o **Desactivar** (no borra nada).

### Restaurantes

1. **Nuevo restaurante**: nombre, marca, ciudad y ubicación en el mapa.
2. Sale de inmediato en el mapa, en las estadísticas y en los accesos de los
   usuarios, con una zona vacía «Comedor principal» lista para dibujar.
3. Desde su fila: **Modo sencillo**, **Plano** (el editor), **Editar** y
   **Desactivar**. Desactivar no borra nada; sus hosts dejan de tener acceso.

## 3. Liberar mesas y eliminar clientes viejos (cualquier restaurante)

El admin puede hacer en **todos** los restaurantes lo mismo que el host en
los suyos (manual del host, «Ver clientes» y «Plano en vivo»):

1. Elige el restaurante arriba (o en el mapa) y abre **Modo sencillo** →
   **Ver clientes**.
2. **Todos** + **Ocupando mesa**: salen las mesas ocupadas, aunque sean de
   hace días.
3. Marca las casillas → **Liberar mesas**; o **Limpiar pendientes antiguos**
   (12 h, 24 h o 7 días) para cerrar lo viejo de una vez.
4. **Eliminar** solo para errores: borra al cliente de las estadísticas.
   Marcar ausente y liberar mesa guardan las cifras.
5. **Primero se libera la mesa, luego se elimina.** A un cliente que está
   en una mesa no se le puede eliminar: «Este cliente está en la Mesa 3.
   Primero libera la mesa para poder eliminarlo.» → **Liberar mesa** →
   **Eliminar** → **Aceptar**. En grupo: «Liberar sus mesas» o «Eliminar solo
   los N sin mesa». El servidor lo exige también (no se puede saltar).
6. En el **Plano en vivo**: toca una mesa → su panel (**Sentar**, **Liberar
   mesa**, y después **Eliminar cliente**). **Liberar todas las mesas**
   (escribe LIBERAR).
8. **Meseros por color.** Cada mesero se reconoce solo por su color (rojo,
   azul, amarillo, verde, morado, naranja, rosa, turquesa, café, gris
   oscuro, lima, lavanda), en el plano, Ver clientes, los avisos y las estadísticas
   («Mesero azul»). No hay nombres de meseros que escribir.
7. **Deshacer** vale para la última acción del restaurante, también si el
   servidor se reinició hace menos de 10 minutos.

Analítica no ve estos botones y el servidor se lo rechaza.

## 4. Configuración (privacidad)

Tres opciones que decide la dirección, cada una con el valor más seguro por
defecto. Están explicadas en palabras sencillas en `docs/configuracion.md`.

| Opción | Por defecto |
|---|---|
| La IA usa alias en lugar de nombres de clientes | Activado |
| Analítica puede ver los nombres del top 10 de clientes | Desactivado |
| Guardar el historial de clientes por | 1 año |

1. Cambia lo que haya decidido la dirección.
2. Toca **Guardar configuración**.
3. **Aplicar ahora** anonimiza de inmediato lo que ya venció. Si no, se hace
   sola una vez al día.

## 5. Si nadie puede entrar a /admin (recuperación)

Si el admin olvidó su contraseña, se cambia desde la terminal, con la CLI de
Railway, contra la base de producción:

```powershell
& "$(npm prefix -g)\railway.cmd" run npm run reset-password
```

1. Pregunta el **correo** y la **contraseña nueva** dos veces, sin mostrarla.
2. Solo cambia la contraseña de ese usuario y cierra sus sesiones. No crea
   usuarios ni cambia roles, y no reactiva a un usuario desactivado.
3. Entra con la nueva contraseña y cámbiala de nuevo en /admin si hace falta.

Para crear un usuario desde la terminal (por ejemplo, el primer admin):

```powershell
& "$(npm prefix -g)\railway.cmd" run npm run create-user -- --correo nombre@grupocomidas.test --nombre "Nombre" --rol admin
```

Más detalle: `docs/despliegue.md` (sección 3) y `docs/salida-a-produccion.md`.

## 6. Respaldos

Antes de cada publicación con cambios en la base, y una vez a la semana
durante el piloto, saca un respaldo. Los pasos están en
`docs/respaldos.md`.
