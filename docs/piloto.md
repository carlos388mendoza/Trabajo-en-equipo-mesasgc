# Piloto: lista de verificación

Para el encargado del piloto y el equipo. La planificación completa (qué
restaurantes, cuánto dura, qué medir y cuándo pasar a más locales) está en
`docs/salida-a-produccion.md`, sección 3. Aquí va lo que hay que **marcar**.

## Antes del piloto

### Equipo técnico (Carlos)

- [ ] Railway en el plan **Hobby** con un método de pago (la prueba gratuita
      se acaba; ver «Lo que hace Carlos» en `docs/estado-del-proyecto.md`).
- [ ] OpenRouter con **crédito cargado** (sin crédito, el asistente contesta
      solo con la respuesta básica).
- [ ] **Contraseñas cambiadas** en /admin → «Contraseña» para el admin,
      analítica y los usuarios de cada marca (las de prueba no sirven en
      producción).
- [ ] La dirección **decidió las 3 opciones** de privacidad
      (`docs/configuracion.md`) y están guardadas en /admin → Configuración.
- [ ] **Respaldo** de la base sacado y guardado en un sitio privado
      (`docs/respaldos.md`).
- [ ] `/api/health` y `/login` responden (Railway en verde).

### En cada restaurante del piloto

- [ ] El **plano real** dibujado en el editor (Panel): mesas, nombres y
      puestos de verdad, baños, caja y barra. Guardado.
- [ ] La **zona por defecto** marcada (★ Por defecto).
- [ ] Los **meseros reales**: en el plano en vivo, «Meseros activos» con la
      cantidad de cada turno, y en **Editar zonas** los nombres de los meseros
      y sus mesas.
- [ ] La **tablet** cargada, con **Opera**, la app abierta y la sesión
      iniciada. Probado el plano en grande (tablet acostada + pantalla
      completa de Opera).
- [ ] **Hosts entrenados** con `docs/manual-host.md` (impreso, al lado de la
      tablet): agregar, deslizar, deshacer, Ver clientes, sentar y liberar.
- [ ] La **lista en papel** de respaldo impresa (última página del manual del
      host) y un bolígrafo al lado de la tablet.
- [ ] Todos saben **a quién avisar** (ver abajo).

## Durante el piloto (cada turno)

- [ ] Al abrir: la tablet dice **Conectado** y el plano se ve al día.
- [ ] Cada cliente que llega entra a la app (no solo al papel).
- [ ] Al sentar, se usa **Sentar** (así se mide la espera y el mesero).
- [ ] Al irse el grupo, **Liberar mesa** (si no, la mesa sigue roja).
- [ ] El encargado anota en la hoja del día qué falló o qué costó.

## Si se cae el internet

1. La tablet dice **Sin conexión**. **Se puede seguir**: agregar, avisar y
   marcar ausente se guardan en la tablet y se mandan solos al volver la red
   («Sincronizado»).
2. Si la tablet se apaga, no carga o lleva **más de 10 minutos** sin red:
   **pasa a la lista en papel** (`docs/manual-host.md`, sección 4).
3. Al volver la app: pasa a la app a los que **siguen esperando**. No hace
   falta pasar a los que ya se sentaron o se fueron.
4. Anótalo en la hoja del día (hora en que se cayó y en que volvió).

## A quién avisar

| Qué pasa | A quién | Cómo |
|---|---|---|
| No se puede entrar, la app no carga en ninguna tablet | Carlos (equipo técnico) | Llamada o WhatsApp |
| Algo no funciona como debería (un botón, una mesa, un dato raro) | Carlos | Un reporte (abajo) |
| Un host olvidó su contraseña | El administrador | Le cambia la contraseña en /admin |
| Dudas de uso | El encargado del piloto | En persona; manual del host |

## Cómo reportar un problema

En GitHub: **Issues → New issue → «Reporte del piloto»**. La plantilla pide:

- el restaurante;
- el dispositivo y el navegador (tablet + Opera, celular…);
- qué pasó y qué esperabas;
- una captura de pantalla si se puede.

Si el host no tiene GitHub, el encargado lo pasa con los mismos datos. **No
pongas contraseñas** ni datos de clientes en el reporte.

## Después del piloto

- [ ] Reunión corta con encargados y hosts: qué fue bien, qué costó.
- [ ] Revisar las cifras en Estadísticas (espera promedio, tiempo hasta
      avisar, ausentes) con la meta de `docs/salida-a-produccion.md`.
- [ ] Repasar los reportes abiertos y decidir qué se arregla antes de crecer.
- [ ] Decidir si se pasa a más restaurantes (criterios en
      `docs/salida-a-produccion.md`, «Cuándo pasar a China Wok y KFC»).
- [ ] Usuarios: pasar de un usuario por marca a **uno por host**, y cambiar
      las contraseñas compartidas.
- [ ] Sacar un respaldo de la base al terminar.
