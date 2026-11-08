# CLAUDE.md — QualityOS

Contexto para sesiones futuras. Leer también `docs/DISENO.md`.

## Quién y qué
- Usuario: Maximiliano, Inspector de Calidad. Estudia Desarrollo de Software:
  **quiere entender el código**, no solo que funcione.
- App: PWA para crear un lote, controlarlo (peso por pico, identificación, inducción,
  QR/packaging/paletizado, control final) y dictaminarlo. Multiempresa sobre Supabase.
- Reconstrucción de la QualityOS en Firebase (el código viejo está en el Drive del usuario,
  carpeta `qualityos`; no se reutiliza, solo se usó como referencia de reglas).

## Mismo modelo que sus otras apps
Scripts clásicos sin módulos ni build, un objeto global por archivo, interfaz en español
rioplatense (voseo), botones de 48 px, funciona sin señal.
Licencia: PolyForm Noncommercial 1.0.0 (NO es MIT como sus otras apps: posible SaaS).
Orden de carga: `vendor/supabase.js → config → reglas → store → nube → imprimir → app`.

## Reglas
- El rol visible es **Inspector de Calidad** (nunca "Checker"). En la base y en los datos
  sigue llamándose `checker`: no renombrarlo sin migración.
- Reglas de negocio solo en `js/reglas.js` (puras). Si una regla también la valida el
  servidor (`supabase/migrations/`), cambiar las dos y sus pruebas.
- Todo acceso a Supabase solo en `js/nube.js`.
- Escapar todo texto del usuario con `esc()` (Imprimir.esc) antes de ir a innerHTML.
- Fechas locales con `Reglas.hoy()`, nunca `toISOString()` para fechas de calendario.
- Cambios de esquema: archivo NUEVO en `supabase/migrations/` (no editar uno ya aplicado),
  con su prueba en `tests/sql/pruebas.sql`.
- **Cada cambio en archivos de la app: subir `VERSION` en `sw.js`.** Si se agrega un
  archivo, sumarlo a `ARCHIVOS` en `sw.js`.
- Comentarios en español explicando el porqué. Nada de features no pedidas: avisar si un
  pedido excede lo acordado.

## Pruebas
```
node --test 'tests/*.test.js'     # reglas
tests/sql/correr.sh               # base (necesita Postgres local; como usuario postgres)
node tests/e2e/flujo.js [carpeta] # interfaz con Supabase simulado; carpeta = capturas
```
