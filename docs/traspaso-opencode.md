# Traspaso

**Sin pendientes** (28 de octubre de 2026).

Todo lo que quedaba abierto está hecho, publicado en `main` y verificado:

- La app corre en Vercel + Turso, con el tiempo real por HTTP con sondeo.
- Los 6 pendientes del viernes: contraseñas fuera del repositorio, «Eliminar cuenta», «Eliminar contraseña»,
  revisión de issues, consumo de Turso y la prueba intermitente de `verify:realtime`.
- Ahorros del sondeo y números de consumo y planes (`docs/consumo-turso-sondeo.md`).
- Los 9 issues del repositorio están cerrados y comprobados en el código.

Dónde seguir leyendo:

- `docs/entrega-empresa.md`: servicios, variables, publicar, respaldos, usuarios, límites y transferencia de cuentas.
- `docs/estado-del-proyecto.md`: lo que hace la app y el cumplimiento del enunciado.
- `docs/seguridad.md`: medidas de seguridad y el registro del incidente de contraseñas.

Lo único que depende de la empresa (no es trabajo de código): pasar a Vercel Pro y transferir las cuentas
(lista en `docs/entrega-empresa.md`, sección 9).

Reglas del proyecto: ramas `feat/`, `fix/` o `docs/` desde `testing`, PR hacia `testing`, y `testing` → `main`
solo con el CI en verde y el visto bueno de Carlos. Nunca contraseñas, tokens ni llaves en el repositorio.
