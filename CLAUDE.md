# CLAUDE.md — QualityOS

Contexto para sesiones futuras. Leer también `docs/DISENO.md`.

## Quién y qué
- Usuario: Maximiliano, Inspector de Calidad. Estudia Desarrollo de Software:
  **quiere entender el código**, no solo que funcione.
- App: PWA para crear un lote, controlarlo (control en línea y control final) y dictaminarlo,
  para cualquier rubro: QUÉ se controla lo define cada empresa con **plantillas de control**
  (ítems medición / OK-NOK / texto / fecha). Multiempresa sobre Supabase.
- Hoja de ruta y pedidos pendientes del usuario: **`CONTEXTO.md`** (leer al empezar).
- Reconstrucción de la QualityOS en Firebase (el código viejo está en el Drive del usuario,
  carpeta `qualityos`; no se reutiliza, solo se usó como referencia de reglas).

## Mismo modelo que sus otras apps
Scripts clásicos sin módulos ni build, un objeto global por archivo, interfaz en español
rioplatense (voseo), botones de 48 px, funciona sin señal.
Licencia: PolyForm Noncommercial 1.0.0 (NO es MIT como sus otras apps: posible SaaS).
Orden de carga: `vendor/supabase.js → config → reglas → store → demo → nube → imprimir → editor → app`.

## Reglas
- El rol visible es **Inspector de Calidad** (nunca "Checker"). En la base y en los datos
  sigue llamándose `checker`: no renombrarlo sin migración.
- No conformidades: mismo esquema que los lotes (ver "No conformidades" en `docs/DISENO.md`).
  Cualquiera de Calidad las cierra; borrar es de coordinación (lo normal es anular).
- Nada de controles fijos en el código: todo sale de la plantilla que el lote guarda en
  `datos.plantilla` (ver "Plantillas de control" en `docs/DISENO.md`).
- Reglas de negocio solo en `js/reglas.js` (puras). Si una regla también la valida el
  servidor (`supabase/migrations/`), cambiar las dos y sus pruebas.
- Todo acceso a Supabase solo en `js/nube.js`.
- Modo demo (`js/demo.js`): imita a Supabase en el navegador. Si `nube.js` usa algo nuevo de
  Supabase, agregarlo también a `demo.js`. La demo NUNCA puede llegar a la base real
  (`tests/e2e/demo.js` lo verifica).
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
node --test 'tests/*.test.js'     # reglas (lotes y NC)
tests/sql/correr.sh               # base (necesita Postgres local; como usuario postgres)
# Sin Postgres instalado, con Docker:
#   docker run -d --name qos-pg -e POSTGRES_HOST_AUTH_METHOD=trust -v "$PWD":/app:ro postgres:16
#   docker exec -u postgres -w /app qos-pg bash tests/sql/correr.sh
node tests/e2e/flujo.js [carpeta] # interfaz con Supabase simulado; carpeta = capturas
node tests/e2e/primer-uso.js      # cuenta nueva, invitación y bienvenida
node tests/e2e/demo.js            # modo demo sin pedidos a Supabase
node tests/e2e/plantillas.js      # armar una plantilla propia y usarla en un lote
node tests/e2e/nc.js [carpeta]    # no conformidades: desde el lote, cierre, sin señal, importar, imprimir
node tests/e2e/productos.js       # catálogo: lote desde producto, guardar como producto, ⚙ Productos
```

## Guía y demo
- `docs/GUIA.md` es la guía para usuarios, con capturas de `docs/img/`.
- Si cambia algo visible, regenerar capturas y GIF con `node tools/demo.js` y el video con
  `node tools/video.js` (datos ficticios, Supabase simulado), y revisar que la guía siga
  diciendo lo que la app hace.
- La bienvenida de primera vez está en `pantallas.bienvenida` (js/app.js): si cambia el flujo,
  actualizar sus pasos y la guía juntos.
