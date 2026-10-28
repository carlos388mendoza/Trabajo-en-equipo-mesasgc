# Checklist de salida de Railway

Casillas para ir marcando. Solo marcar cuando esté hecho y verificado.

## D) Publicar a Production
- [ ] Merge feat/vercel → testing (CI verde)
- [ ] Merge testing → main (CI verde)
- [ ] Variables de Production en Vercel (7 variables)
- [ ] Rotación del token de Turso mesasgc-prod (invalidar todos → crear nuevo → Vercel → Redeploy)
- [ ] `/api/health` → 200 en Production
- [ ] `/login` → 200 en Production
- [ ] Encabezados de seguridad presentes

## E) Limpieza
- [ ] OpenRouter: borrar llave vieja; revisar Activity desde el 20 oct
- [ ] Turso: revisar actividad de mesasgc-prod desde el 20 oct
- [ ] Railway: borrar proyecto noble-energy
- [ ] Railway: borrar tokens en Account Settings
- [ ] GitHub: desinstalar Railway (Installed GitHub Apps)
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
