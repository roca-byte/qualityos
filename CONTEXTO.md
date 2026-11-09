# CONTEXTO.md — Hoja de ruta de QualityOS

Indicaciones del usuario para próximas sesiones, en orden de prioridad. Leer junto con
`CLAUDE.md` y `docs/DISENO.md`. Actualizar este archivo cuando algo se termine o cambie.

## Hecho

- **Etapa 1 · Plantillas de control** (08/11/2026) — terminada. Que la app sirva para cualquier
  tipo de fabricación (alimentos, bebidas, químicos, agro, cosmética, envases…), no solo
  agroquímicos: el administrador define en ⚙ qué ítems se controlan en línea y en el control
  final (medición con tolerancia, OK/NOK, texto, fecha), con ejemplos por rubro para empezar.
  Cada lote guarda una copia de la plantilla con la que se creó. Ver "Plantillas de control"
  en `docs/DISENO.md`. Prueba de punta a punta: `tests/e2e/plantillas.js`.

- **Codificación del registro por plantilla** (08/11/2026) — terminada. Cada plantilla tiene
  código (obligatorio, sin repetir), versión, vigencia, elaboró, aprobó e historial de versiones;
  al cambiar el contenido la app ofrece la versión siguiente; el PDF usa la codificación que guardó
  el lote. Ver `docs/DISENO.md` y `tests/e2e/plantillas.js`.

- **No conformidades** (09/11/2026) — terminada. Pestaña NC con vista por mes y de abiertas,
  indicadores, NC creadas desde los desvíos del lote (una por control), ficha con cierre y
  verificación de eficacia, número por empresa y año asignado por el servidor, tipos de desvío
  en ⚙, registro mensual para imprimir e importación del respaldo de la app individual.
  Cualquiera de Calidad cierra (pedido del usuario). Ver "No conformidades" en `docs/DISENO.md`.
  La app individual `calidad-no-conformidades` sigue aparte, con código propio.
  Publicada el 09/11/2026: migración 0005 aplicada en Supabase y app en GitHub Pages (sw v14).

- **Etapa 2 · Productos y control por horario** (09/11/2026) — terminada, en tres partes publicadas
  por separado (PR 4, 5 y 6). No necesita migración: todo va en `empresas.config` y en los
  datos del lote.
  - **Parte 1 · Datos del lote por plantilla** — hecha (09/11/2026). `p.cabecera` (texto,
    lista, número o fecha; obligatorio o no) → `cab.extra`. Ver "Plantillas de control" en
    `docs/DISENO.md`.
  - **Parte 2 · Catálogo de productos** — hecha (09/11/2026). Ver "Catálogo de productos" en
    `docs/DISENO.md`. (⚙, **solo Administración**): nombre, código, plantilla,
    rangos por defecto, cantidad por unidad, unidades del control final y valores por defecto
    de los datos del lote. Al crear el lote, elegir el producto completa todo (editable). Es
    optativo: un producto que no está se escribe a mano. "Guardar como producto" al crear un
    lote nuevo. Cada lote guarda copia (corregir el catálogo no cambia lotes viejos).
  - **Parte 3 · Control en línea por horario** — hecha (09/11/2026). Ver "Control en línea por
    horario" en `docs/DISENO.md`. La plantilla elige **por unidad** (como hoy) **o**
    **por horario** (uno u otro, no los dos), "cada X horas **desde el último control**".
    "Próximo control: 12:10" y "⏰ Control atrasado" en el lote y su tarjeta. Sin notificaciones
    con la app cerrada (eso queda para después, si se pide).

- **Firma electrónica** (09/11/2026) — terminada. Se firma el dictamen del lote y el cierre de la
  NC, con la clave en cada firma; sin señal queda "pendiente de firma". Migración 0006. Ver
  "Firma electrónica" en `docs/DISENO.md`. Firma digital con certificado: fuera de alcance.

## Próximo

1. **Conexión con ERPs (ISIS, SAP)** — investigada el 09/11/2026, **el usuario pidió no hacer nada
   todavía**. Resumen: ISIS tiene API REST (X-Api-Key; artículos, clientes, stock, remitos con
   trazabilidad de lote, y `ISIS_ProcesarStock` para mover un lote a un depósito de retenidos);
   SAP Business One por Service Layer (estado del lote: liberado / bloqueado); S/4HANA con su
   propio QM (API_INSPECTIONLOT_SRV). Siempre desde un servidor (Edge Function o agente en la
   planta), nunca desde la tablet. Etapas propuestas: A webhook + exportar, B leer artículos y
   clientes, C dictamen → bloquear/liberar en el ERP, D trazabilidad del lote en reclamos.

## Mucho más adelante (opcional, más grande)

2. **Otros sectores.** Que otras áreas usen los mismos lotes:
   - Que **Producción** (y no solo Calidad) pueda crear el lote, y después Calidad lo controle.
   - Que **Logística** tome los lotes dictaminados (por ejemplo, para el despacho).
   Implica nuevos roles y permisos por sector, y estados del lote más allá del dictamen.
   Siempre opcional por empresa.
