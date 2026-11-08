# CONTEXTO.md — Hoja de ruta de QualityOS

Indicaciones del usuario para próximas sesiones, en orden de prioridad. Leer junto con
`CLAUDE.md` y `docs/DISENO.md`. Actualizar este archivo cuando algo se termine o cambie.

## En curso / hecho

- **Etapa 1 · Plantillas de control** (pedida el 08/11/2026). Que la app sirva para cualquier
  tipo de fabricación (alimentos, bebidas, químicos, agro, cosmética, envases…), no solo
  agroquímicos: el administrador define en ⚙ qué ítems se controlan en línea y en el control
  final (medición con tolerancia, OK/NOK, texto, fecha), con ejemplos por rubro para empezar.
  Cada lote guarda una copia de la plantilla con la que se creó.

## Próximo

1. **Codificación del registro editable, por plantilla.** La exige la norma (control de
   documentos, ISO 9001 7.5). Hoy el código y la versión del registro se editan en ⚙ pero son
   uno solo para toda la empresa. Con plantillas, cada plantilla es un registro distinto y debería
   tener su propia codificación: código, versión, fecha de vigencia, quién elaboró y aprobó. Que
   el PDF use la de la plantilla del lote y, si se cambia la versión, los lotes viejos conserven
   la que tenían (ya guardan una copia de la plantilla).
2. **Etapa 2 · Productos y control por horario.** Catálogo de productos con su plantilla y sus
   rangos por defecto (que al crear el lote se complete solo). Control por horario ("cada 2 h")
   además de por unidad. Campos extra de cabecera definidos por la plantilla (por ejemplo, el
   equipo o la inductora usada, que antes se elegía en el lote).

## Más adelante

3. **Firma.** Averiguar qué exige la norma para firmar registros (ISO 9001: identificar quién
   aprueba y cuándo; en farma/alimentos con requisitos más fuertes, firma electrónica con
   validación, tipo 21 CFR Part 11 / ANMAT) y qué se puede hacer: hoy queda registrado quién
   dictaminó, con qué rol y cuándo, más la auditoría de cada versión del lote. Evaluar:
   reingresar la clave al dictaminar, firma dibujada, "firma" con sello de tiempo e
   inalterabilidad (hash) en el PDF.

## Mucho más adelante (opcional, más grande)

4. **Otros sectores.** Que otras áreas usen los mismos lotes:
   - Que **Producción** (y no solo Calidad) pueda crear el lote, y después Calidad lo controle.
   - Que **Logística** tome los lotes dictaminados (por ejemplo, para el despacho).
   Implica nuevos roles y permisos por sector, y estados del lote más allá del dictamen.
   Siempre opcional por empresa.
