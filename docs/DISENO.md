# Decisiones de diseño

Por qué la app está armada como está. Sirve para quien la mantenga (y para no repetir
los problemas de la versión anterior).

## Origen

La QualityOS original era un conjunto de páginas HTML grandes (la planilla del lote tenía
más de 3.000 líneas) que hablaban directo con Firebase. Una revisión del 16/10/2026 encontró
estos problemas, que esta reconstrucción resuelve desde el diseño:

| Problema en la versión Firebase | Cómo se resuelve acá |
|---|---|
| No existía el concepto de empresa: una segunda empresa vería los lotes de la primera | Cada fila lleva `empresa_id` y la base (RLS) filtra por empresa |
| La seguridad dependía de esconder botones | Las reglas se validan en la base: `guardar_lote()` y políticas RLS (probadas en `tests/sql/`) |
| La "clave de coordinadora" era pública y por defecto `1234` | No hay clave compartida: se usa el rol del usuario logueado |
| Una tablet sin señal podía pisar al volver una aprobación más nueva | Control de versión por lote: si cambió en el servidor, hay conflicto y nada se pisa |
| Un lote borrado "revivía" si otra tablet lo tenía | Borrado con lápida (`borrado = true`) |
| Los conflictos los decidía el reloj de cada tablet | Hora del servidor (`modificado = now()`) |
| Dictaminar "Aprobado parcial" y cerrar dejaba el lote como "cerrado" | El estado sale del dictamen y se conserva el parcial |
| Texto del usuario insertado como HTML sin limpiar | Todo pasa por `esc()` antes de ir al HTML, también en el PDF |
| Reglas duplicadas en varias pantallas que ya daban resultados distintos | Una sola copia en `js/reglas.js`, con pruebas |
| Fechas en UTC (a la noche daban el día siguiente) | Fechas locales (`Reglas.hoy()`) |
| Usuarios creados desde el navegador del admin | Cada persona crea su cuenta; el admin solo la invita por email |
| Sin historial de cambios | `lotes_historial` guarda cada versión con usuario y hora |

Los datos de Firebase **no se migraron** (decisión del 16/10/2026): Supabase arranca de cero.

## Cómo se guarda un lote

Un lote es un documento JSON (`datos`) con la cabecera, **una copia de su plantilla de
control**, el control en línea, el control final y las observaciones (formato 2):

```
cab        producto, lote, cliente, línea, fecha, inspector y rangos del lote por ítem
plantilla  copia: unidad ("Pallet"), cantidad ("L"), ítems de línea y de control final
linea[]    una unidad por elemento: n, hora, v{itemId: valor}, r{itemId: reprocesado}, obs
final      cantPorUnidad, unidades[] (igual que linea + cant), dictamen y quién lo firmó
```

## Plantillas de control

Qué se controla no está fijo en el código: lo define la plantilla, para que la app sirva en
cualquier rubro (alimentos, bebidas, químicos, cosmética…). Un ítem es de uno de 4 tipos:
medición (número con unidad, N lecturas y tolerancia fija, por lote o ninguna), OK/NOK, texto o
fecha. Una medición fuera de tolerancia cuenta como NOK; los OK/NOK y las mediciones pueden
marcarse como reprocesados si la plantilla lo permite.

- **Datos del lote** (`p.cabecera`, Etapa 2): campos propios de la cabecera (equipo,
  inductora, turno…) de tipo texto, lista, número o fecha, obligatorios o no. El lote guarda
  los valores en `cab.extra[id]`. Cambiarlos cuenta como cambio de contenido (pide versión).
  Reemplazan a la "inductora" fija del formato anterior: `migrarLote` la pasa a
  `cab.extra.inductora`. El servidor no los valida (son datos de la cabecera, no del dictamen).
- Las plantillas viven en la configuración de la empresa (`empresas.config.plantillas`) y se
  editan en ⚙ (`js/editor.js`). Hay ejemplos por rubro en `Reglas.EJEMPLOS`.
- **Cada lote guarda una copia** de su plantilla: editar o borrar una plantilla no cambia los
  lotes ya hechos ni sus PDF.
- Las reglas (`js/reglas.js`) y el servidor (`pallets_faltantes()`, migración 0004) leen los
  ítems de esa copia. Para dictaminar tienen que estar completos los ítems **obligatorios** del
  control final.
- **Codificación del registro** (ISO 9001, 7.5): cada plantilla lleva `doc` = código, versión,
  vigencia, elaboró, aprobó e historial de versiones. Si cambia el contenido (ítems, unidad o
  cantidad) sin cambiar la versión, la app ofrece la siguiente (`Reglas.siguienteVersion`) y la
  anota en el historial. El PDF usa la `doc` de la copia que guardó el lote, así que un lote viejo
  conserva su versión. Las plantillas sin `doc` heredan la codificación única que antes tenía
  la empresa (`config.docCodigo`…), que ya no se edita en ⚙ (`Reglas.docDe`).
- **Formato anterior** (campos fijos de agroquímicos e "inductoras"): `Reglas.migrarLote` lo
  convierte a una plantilla equivalente. La conversión se hace en cada equipo sin subir nada;
  el lote se sube en el formato nuevo la próxima vez que alguien con permiso lo edita. El
  servidor entiende los dos formatos.

En la base, además del JSON, se copian columnas para buscar y filtrar (número, producto,
cliente, línea, fecha, estado, dictamen). Así se puede consultar con SQL o Power BI sin
abrir el JSON.

Se eligió un documento por lote (y no una tabla por unidad) porque simplifica mucho el
trabajo sin señal: un lote se edita entero en la tablet y se sube entero. Si más adelante
hace falta analizar unidad por unidad, se puede armar una vista SQL sobre el JSON.

## Trabajo sin señal

```
el inspector toca algo
  → Store.cambiar(): cambia la copia local y marca el lote "pendiente"
  → a los 3 s (o al volver la señal, o cada minuto) Nube.sincronizar():
      1. sube cada pendiente con guardar_lote(id, versión_base, datos)
         · si el servidor tiene esa misma versión → acepta y devuelve la nueva
         · si alguien lo cambió antes → conflicto: la tablet guarda su versión aparte,
           se queda con la del servidor y el usuario elige en "Conflictos"
      2. baja lo que cambiaron otros equipos desde la última vez
```

La sesión de Supabase y el perfil (empresa, rol, configuración) quedan guardados en la
tablet: si se abre la app sin señal, se sigue trabajando con lo último que se bajó.

## Modo demo

"Probar sin cuenta" deja recorrer la app con datos de ejemplo sin registrarse. `js/nube.js`
manda todos los pedidos a `js/demo.js`, un servidor de mentira que guarda en el navegador
(`localStorage['qualityos.demo']`), así que la demo **nunca toca la base real**
(`tests/e2e/demo.js` lo comprueba interceptando cualquier pedido a Supabase). Cada vez que se
entra a la demo se recargan los datos de ejemplo. Las pruebas de la interfaz usan ese mismo
servidor de mentira.

## No conformidades

Estaban en la versión vieja y volvieron el 09/11/2026 (migración 0005). Se cargan **todos los
días** y se entregan **por mes**. Hay además una app individual sin cuenta
(`calidad-no-conformidades`, MIT) con **código distinto**: lo único que comparten es que QualityOS
importa su respaldo (`Reglas.desdeRegistroIndividual`).

- **Mismo esquema que los lotes**: tabla `no_conformidades` (+ `no_conformidades_historial`), id
  generado por la tablet, `guardar_nc()` con versión base y conflictos, lápida al borrar.
  En la tablet viven en `Store` junto a los lotes (`empresas[id].ncs`) y suben por la misma
  bandeja de salida (primero los lotes).
- **Número** `NC-AAAA-NNN` por empresa y año de la fecha de detección: lo asigna el servidor la
  primera vez que recibe la NC (bloqueando la fila de la empresa para no repetir), porque dos
  tablets sin señal no pueden saber cuál sigue. Hasta subir, la NC dice "NC nueva".
- **Permisos**: cualquiera de Calidad (todos los roles) crea, edita, cierra, anula y verifica la
  eficacia (pedido del usuario: "cualquiera de Calidad cierra"). Borrar del todo es de
  coordinación o admin; lo normal es **anular**, que deja la NC en el registro sin contar en los
  indicadores.
- **Desde un lote** (`Reglas.ncsDesdeLote`): una NC por lote · etapa · control · (abierto o
  reprocesado), con las unidades listadas. Lo reprocesado entra cerrado. Cada NC guarda su
  `origen` para no crearla dos veces.
- **Configuración** (`empresas.config`): `tiposNc` (tipo + gravedad sugerida), `ncPlazoDias`
  (días hábiles), `ncCodigo` y `ncVersion` (encabezado del registro impreso).
- Reglas en `js/reglas.js` (validarNc es la misma validación que hace `guardar_nc`), pruebas en
  `tests/nc.test.js`, `tests/sql/pruebas.sql` y `tests/e2e/nc.js`.

## Qué quedó afuera (por ahora)

Estaba en la versión vieja y no entró en esta primera reconstrucción:

- **Escaneo de QR con la cámara** (validaba la URL del código).
- **Exportar a Excel.**
- **Panel de coordinación** separado: acá coordinación usa la misma pantalla con más permisos.

Antes de agregar algo de esto, conviene confirmar que se sigue usando.
