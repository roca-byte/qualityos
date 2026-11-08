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

Un lote es un documento JSON (`datos`) con la cabecera, el control en línea, el control
final y las observaciones. Los nombres de campo (`p1..p4`, `indOK`, `qrRepro`…) son los de
la planilla original para que quien la conoce se ubique.

En la base, además del JSON, se copian columnas para buscar y filtrar (número, producto,
cliente, línea, fecha, estado, dictamen). Así se puede consultar con SQL o Power BI sin
abrir el JSON.

Se eligió un documento por lote (y no una tabla por pallet) porque simplifica mucho el
trabajo sin señal: un lote se edita entero en la tablet y se sube entero. Si más adelante
hace falta analizar pallet por pallet, se puede armar una vista SQL sobre el JSON.

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

## Qué quedó afuera (por ahora)

Estaba en la versión vieja y no entró en esta primera reconstrucción:

- **Registro de No Conformidades** con KPIs: existe como app aparte
  (`calidad-no-conformidades`). Desde el lote se pueden copiar los desvíos para pegarlos ahí.
- **Escaneo de QR con la cámara** (validaba la URL del código).
- **Exportar a Excel.**
- **Panel de coordinación** separado: acá coordinación usa la misma pantalla con más permisos.

Antes de agregar algo de esto, conviene confirmar que se sigue usando.
