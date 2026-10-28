# Checklist de salida de Railway

Casillas para ir marcando. Solo marcar cuando esté hecho y verificado.

## D) Publicar a Production
- [ ] Merge feat/vercel → testing (CI verde)
- [ ] Merge testing → main (CI verde)
- [ ] Variables de Production en Vercel (7 variables)
- [x] Tokens viejos de Turso mesasgc-prod invalidados (28 oct, confirmado por Carlos)
- [ ] `/api/health` → 200 en Production
- [ ] `/login` → 200 en Production
- [ ] Encabezados de seguridad presentes

## E) Limpieza
- [x] OpenRouter: llave vieja borrada (pendiente aparte: revisar Activity desde el 20 oct)
- [ ] Turso: revisar actividad de mesasgc-prod desde el 20 oct
- [x] Railway: proyecto noble-energy borrado (Railway eliminado por completo)
- [x] Railway: sin tokens (borrados)
- [x] GitHub: Railway App desinstalada
- [ ] GitHub: revocar Railway (Authorized OAuth Apps)
- [ ] GitHub: borrar secretos de Railway en el repo
- [ ] GitHub: quitar entornos de Railway

## F) Después
- [ ] Todos vuelven a iniciar sesión
- [ ] Cambiar contraseña 12345abc del admin y analítica
- [ ] Pulsar "Revisar contraseñas" en /admin
- [ ] Copiar planos vacíos (KFC, Pizza Hut Norte)
- [ ] Mandar link nuevo de Vercel a Grupo Comidas
- [ ] (Opcional) Borrar base mesasgc-preview
