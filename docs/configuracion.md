# Configuración de privacidad: las 3 decisiones de la dirección

La app guarda el nombre de cada cliente que entra a la lista de espera (y, si
el host lo anota, un teléfono y una nota). Estas tres opciones deciden qué se
hace con esos datos. Están en **/admin → Configuración** y **solo el
administrador** las puede ver y cambiar.

Cada una viene con el valor **más seguro**. Si la dirección no dice nada, se
quedan así.

## 1. «La IA usa alias en lugar de nombres de clientes»

**Por defecto: activado.**

El asistente de las estadísticas («Pregunta sobre tu servicio») usa una
inteligencia artificial de una empresa externa (OpenRouter). Para contestar
preguntas como «¿quiénes son nuestros clientes más frecuentes?» necesita la
lista de los 10 clientes que más vinieron.

- **Activado:** a la empresa externa le llega «Cliente 1», «Cliente 2»… y
  nunca un nombre. La app pone los nombres de vuelta solo en la pantalla de
  quien preguntó. Los teléfonos y las notas no salen nunca, con o sin esta
  opción.
- **Desactivado:** los 10 nombres del top viajan a la empresa externa. La
  respuesta puede ser un poco más natural, pero los nombres salen de la
  empresa.

**Recomendación:** dejarlo activado. El asistente funciona igual de bien.

## 2. «Analítica puede ver los nombres del top 10 de clientes»

**Por defecto: desactivado.**

El rol **analítica** ve las estadísticas de todos los restaurantes, pero no
atiende clientes.

- **Desactivado:** en el top 10, analítica ve «Cliente 1 (A. G.)», «Cliente 2
  (L. M.)»… (un número y las iniciales). Tampoco le llegan los nombres a
  través del asistente de IA.
- **Activado:** analítica ve los nombres completos.

El **administrador** ve siempre los nombres. Los **hosts** no tienen
estadísticas.

**Recomendación:** dejarlo desactivado, salvo que analítica necesite llamar o
reconocer a clientes concretos.

## 3. «Guardar el historial de clientes por»

**Opciones:** 90 días · 180 días · **1 año (por defecto)** · Siempre.

Pasado ese tiempo desde que el cliente llegó, la app **borra sus datos
personales**:

- el nombre pasa a ser «Cliente anónimo»;
- el teléfono y la nota se borran.

Lo que **no** se borra:

- la visita en sí: cuántas personas, a qué hora llegó, cuánto esperó, en qué
  mesa se sentó y qué mesero lo atendió. Así **las estadísticas no cambian**;
- quien está esperando ahora o sentado en una mesa: nunca se toca;
- los **datos de demostración** (los clientes inventados para probar), salvo
  que se marque «Aplicar también a los datos de demostración».

La revisión se hace **sola una vez al día**. El administrador también puede
pulsar **Aplicar ahora**. No se puede deshacer: un cliente anonimizado no
recupera su nombre.

**Recomendación:** 1 año. Con 90 o 180 días se guarda menos información
personal; con «Siempre» no se borra nada (no recomendado).

## Qué hay que decidir

| Opción | Valor por defecto | Decisión de la dirección |
|---|---|---|
| La IA usa alias en lugar de nombres de clientes | Activado | ☐ Activado ☐ Desactivado |
| Analítica puede ver los nombres del top 10 | Desactivado | ☐ Activado ☐ Desactivado |
| Guardar el historial de clientes por | 1 año | ☐ 90 días ☐ 180 días ☐ 1 año ☐ Siempre |

Con la decisión tomada, el administrador entra en **/admin → Configuración**,
cambia lo que haga falta y pulsa **Guardar configuración**.

---

*Para el equipo técnico:* las opciones viven en la tabla `app_settings`
(migración `0010`, solo aditiva) y en `lib/settings/privacy.ts`. El permiso es
`configuracion:gestionar` (solo admin). La retención corre en `server.ts` un
minuto después de arrancar y luego cada 24 horas, y la prueba `verify:auth`.
