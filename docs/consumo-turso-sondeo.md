# Consumo de Turso del sondeo (28 de octubre de 2026)

Revisión **del código**, sin tocar datos ni medir en producción. Las cifras son
**estimaciones** a partir de las consultas que hace cada pregunta; los límites del
plan gratis de Turso y de Vercel cambian, así que confírmalos en sus paneles.

## Qué hace cada pregunta (`GET /api/tiempo-real`)

Cada pantalla abierta pregunta cada **2 s** (visible) o **15 s** (en segundo plano).
Cada pregunta gasta, en `lib/realtime/http.ts`:

| Paso | Consultas a Turso |
|---|---|
| `getSession` de Better Auth (sin `cookieCache`) | 2 (sesión y usuario) |
| `identifyRequest` → `loadAuthUser` | 3 (usuario, roles, restaurantes) |
| `allowedRooms` → `canJoinRestaurant` → `loadAuthUser` otra vez | 3 |
| `readSince`: mínimo y máximo de `realtime_events` | 1 |
| `readSince`: avisos nuevos (casi siempre 0 filas) | 1 |
| **Total** | **≈ 10 por pregunta** |

Cada consulta lee pocas filas (por llave o índice): ≈ 12–25 filas leídas por pregunta.
Las **escrituras** son solo las acciones reales (1 fila en `realtime_events` por aviso)
y el borrado de avisos viejos (5 % de las escrituras, por el índice de fecha).

## Estimación

- Una pantalla visible: 1 800 preguntas/hora → ≈ **18 000 consultas y 22 000–45 000 filas leídas por hora**.
- Ejemplo: 16 pantallas (8 restaurantes × 2) abiertas 10 h al día, 30 días → ≈ 5 millones de filas al día,
  **≈ 150 millones al mes**. Si el plan gratis incluye del orden de 500 millones de filas leídas al mes,
  alcanza con margen, pero no con diez veces más pantallas.
- El límite que se agota **antes** es el de Vercel Hobby: 1 millón de invocaciones al mes ≈ 550 horas-pantalla
  (ya anotado en `traspaso-opencode.md`). Con el ejemplo de arriba (4 800 horas-pantalla) **no alcanza**:
  el sondeo es adecuado para una demo, no para todos los restaurantes todo el día.
- Pantallas en segundo plano (15 s) gastan ≈ 1/7 y las del mapa general preguntan cada 5 s / 30 s.

## Dónde se puede ahorrar (sin tocar el comportamiento visible)

1. **Cargar el usuario una sola vez por pregunta.** `identifyRequest` y `canJoinRestaurant` llaman las dos a
   `loadAuthUser`: pasar el usuario ya cargado ahorra 3 de las 10 consultas.
2. **`cookieCache` de Better Auth** (1–5 min) ahorra las 2 de `getSession`. Ojo: `identifyRequest` ya
   vuelve a comprobar `active` en la base, así que un usuario desactivado sigue sin poder usar el sondeo.
3. **Una sola consulta en `readSince`**: pedir los avisos y, solo si vienen vacíos, el máximo; o guardar el
   último id en memoria de la instancia con un tope de 1 s.
4. **Subir el intervalo visible de 2 s a 3–4 s** reduce todo (consultas e invocaciones de Vercel) a la mitad,
   a costa de 1–2 s más de retraso al ver un cambio de otro dispositivo.
5. **Pausar el sondeo** de una pantalla sin actividad (p. ej. 10 min sin tocar) y reanudarlo al tocarla.

## Cómo medirlo de verdad (para Carlos)

1. En Turso → `mesasgc-preview` (nunca producción) → *Usage*: apunta «rows read» y «rows written».
2. Deja 2 pantallas del restaurante de prueba abiertas **1 hora** sin tocar nada.
3. Vuelve a mirar *Usage*. La diferencia ÷ 3 600 preguntas es el costo real por pregunta; compáralo con
   las 12–25 filas estimadas.
4. En Vercel → *Usage*: invocaciones de `/api/tiempo-real` en esa hora (esperadas ≈ 3 600).

Recomendación: aplicar 1 y 2 en una rama aparte (cambio pequeño y seguro) y decidir 4 con la medición.
