# Consumo del sondeo: Vercel y Turso (actualizado el 28 de octubre de 2026)

Revisión **del código**, sin medir en producción ni tocar datos. Las cifras de uso son
**estimaciones** (marcadas así); los límites de planes se leyeron en las páginas oficiales de
Vercel, Turso, Pusher y Ably el 28 de octubre de 2026 y cambian: confírmalos antes de decidir.

## Qué hace cada pregunta (`GET /api/tiempo-real`)

Cada pantalla abierta pregunta al servidor «¿qué hay después del aviso N?». Cada pregunta es
**1 invocación** de Vercel y varias consultas a Turso.

| Paso | Antes | Después de los ahorros (PR #118) |
|---|---|---|
| Sesión de Better Auth | 2 consultas | 0 casi siempre (`cookieCache` de 60 s) |
| Usuario, roles y restaurantes (`loadAuthUser`) | 3 + 3 (se cargaba dos veces) | 3 (una sola vez) |
| Mínimo y máximo de `realtime_events` | 1 | 1 |
| Avisos nuevos | 1 | 1 |
| **Consultas por pregunta** | **≈ 10** | **≈ 5** |
| **Filas leídas por pregunta (est.)** | **12–25** | **5–13** |

Ritmo de preguntas por pantalla (cambia en el mismo PR):

| Situación | Antes | Después |
|---|---|---|
| Pantalla visible con movimiento (avisos al menos cada 30 s) | 1 800 / hora | 1 800 / hora |
| Poco movimiento (un aviso cada 2–5 min) | 1 800 / hora | ≈ 600 / hora |
| Sin movimiento | 1 800 / hora | ≈ 240 / hora (una cada 15 s) |
| Pantalla oculta o bloqueada | 240 / hora (cada 15 s) | **0** |

## Escenario: 8 restaurantes × 2–3 tablets × 12 h al día × 30 días

Pantallas: 16 (2 por local), 20 (2,5) o 24 (3). Se usa 20 como central: **7 200 horas-pantalla al mes**
(5 760–8 640). Día típico supuesto de 12 h: 3 h con mucho movimiento, 5 h con poco, 4 h sin movimiento
→ **9 360 preguntas por pantalla y día** después (21 600 antes).

| Por mes | Antes | Después, día típico | Después, peor caso (12 h de mucho movimiento) |
|---|---|---|---|
| Invocaciones de Vercel (20 pantallas) | **≈ 13,0 M** (10,4–15,6 M) | **≈ 5,6 M** (4,5–6,7 M) | ≈ 13,0 M (el ahorro por pregunta no cambia el conteo) |
| Filas leídas en Turso | **≈ 155–325 M** | **≈ 28–73 M** | ≈ 65–170 M |
| Filas escritas en Turso | ≈ 0,2–0,5 M (las acciones reales; no depende del sondeo) | igual | igual |
| Active CPU de Vercel (est. 10–15 ms por pregunta; las consultas a Turso son espera y no cuentan) | ≈ 36–54 h | ≈ 16–23 h | ≈ 36–54 h |

Las escrituras salen de ~8 locales × 200 clientes × 4 acciones × 30 días ≈ 190 mil acciones, con su
aviso en `realtime_events`.

## Contra los planes (límites leídos el 28 de octubre de 2026)

| Recurso | Límite | Antes | Después (día típico) | ¿Cabe? |
|---|---|---|---|---|
| **Vercel Hobby** invocaciones | 1 M al mes | 13,0 M | 5,6 M | **No**, ni con los ahorros |
| **Vercel Hobby** Active CPU | 4 h al mes | 36–54 h | 16–23 h | **No** |
| **Turso gratis** filas leídas | 500 M al mes | 155–325 M | 28–73 M | Sí (antes también, con poco margen en el peor caso) |
| **Turso gratis** filas escritas | 10 M al mes | ≈ 0,3 M | ≈ 0,3 M | Sí |

- **Cuántas pantallas caben en Hobby** (solo por invocaciones): 1 M ÷ (9 360 × 30) ≈ **3,5 pantallas**.
  Con 20 pantallas hacen falta ~5,6 veces el límite. Ni todas las pantallas en el ritmo más tranquilo
  (240/h → 1,7 M al mes) caben.
- **Vercel Pro** (20 USD por asiento al mes, con un crédito mensual de uso incluido; su monto no lo
  verifiqué): invocaciones a **0,60 USD por millón**, Active CPU desde **0,128 USD por hora** (regiones
  de EE. UU.). Estimación del sondeo sin el crédito: antes ≈ 13,0 M × 0,60 + 45 h × 0,128 ≈ **14 USD**;
  después ≈ 5,6 M × 0,60 + 20 h × 0,128 ≈ **6 USD**; más los 20 USD del asiento → **≈ 26 USD al mes** con
  los ahorros (≈ 34 antes). El crédito mensual lo reduce.
- **Turso gratis** alcanza. Plan Developer: 4,99 USD al mes (2,5 mil millones de filas leídas, 25 M escritas)
  si algún día hiciera falta.

## Hobby es solo para uso no comercial

Las condiciones de Vercel dicen que Hobby se limita a **uso personal y no comercial**
([plan Hobby](https://vercel.com/docs/plans/hobby), «fair use guidelines»). La app ya la usa Grupo Comidas
en sus restaurantes: eso es uso comercial. El riesgo no es técnico sino de términos: Vercel puede pausar
el proyecto o la cuenta. La salida correcta es **Vercel Pro** (o cambiar de proveedor). Es decisión de Carlos y
de Grupo Comidas, con la cuenta a nombre de la empresa.

## Opción: Pusher o Ably (no implementada)

| | Plan gratis (leído el 28 oct 2026) | Para este escenario |
|---|---|---|
| Pusher Channels (Sandbox) | 200 mil mensajes al día, 100 conexiones simultáneas | 20–24 pantallas (+ pestañas del mapa): caben en las conexiones; ≈ 6 400 avisos al día × unas 4 pantallas por aviso ≈ 26 mil mensajes al día |
| Ably | 6 M de mensajes al mes, 200 conexiones, 200 canales, 500 mensajes por segundo | ≈ 0,8 M de mensajes al mes |

Si se implementara: el servidor publicaría cada aviso a Pusher o Ably justo después de guardarlo
(una llamada HTTP dentro del mismo POST), y el cliente se suscribiría a un canal por restaurante en vez de
sondear. Las invocaciones de Vercel bajarían de 5,6 M al mes a las de las acciones reales más la
autorización de canales: **≈ 0,2–0,3 M al mes (−95 %)**, y las filas leídas en Turso bajarían igual.
Con eso se cabría en el millón de invocaciones de Hobby, pero Hobby seguiría siendo uso no comercial.
Cambios de código: `lib/realtime/bus.ts` (publicar), `lib/realtime/client.ts` (suscripción y reconexión
con recarga), una ruta de autorización de canal privado por restaurante, y mantener `realtime_events` solo
como respaldo para recuperar avisos perdidos. Antes de decidir hay que revisar en los términos de cada
servicio si el plan gratis permite uso comercial (no lo verifiqué). Vercel también anuncia soporte
general de WebSockets en sus funciones; no se evaluó aquí.

## Cómo medirlo de verdad

1. Turso → `mesasgc-preview` (nunca producción) → *Usage*: apunta filas leídas y escritas.
2. Deja 2 pantallas del restaurante de prueba **1 hora** con la Preview que incluya los ahorros.
3. Compara con la hora anterior a los ahorros. Esperado con la pantalla sin movimiento: ≈ 240
   preguntas por pantalla y hora (antes 1 800).
4. En Vercel → *Usage*: invocaciones de `/api/tiempo-real` en esa hora.

## Lo que cuesta el ahorro (compromisos)

- Un cambio hecho en otro dispositivo puede tardar **hasta 15 s** en verse en una pantalla que lleva rato sin movimiento.
- Cerrar sesión desde otro dispositivo, cambiar o eliminar la contraseña: una cookie ya copiada puede seguir
  funcionando hasta **60 s**. Desactivar o eliminar la cuenta corta al instante.
- Una pantalla oculta o bloqueada no se entera de nada hasta volver; si estuvo oculta 1 min o más, recarga el estado completo.
