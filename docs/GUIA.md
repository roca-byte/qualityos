# Guía de uso · QualityOS

Paso a paso para quien usa QualityOS por primera vez. Las capturas son de una empresa de
ejemplo ("Planta Demo") con datos inventados.

<p align="center"><img src="img/demo.gif" alt="Recorrido: crear un lote, controlarlo y dictaminarlo" width="300"></p>

> **¿Querés verla antes de tener cuenta?** Abrí la app y tocá **“Probar sin cuenta (demo)”**: entrás a
> una empresa de ejemplo con lotes cargados. Todo lo que hagas queda solo en tu navegador y cada vez
> que entrás a la demo arranca de cero. También hay un [video de 2 minutos](video/qualityos-demo.mp4).

**Contenido**

1. [Entrar por primera vez](#1-entrar-por-primera-vez)
2. [Crear un lote](#2-crear-un-lote)
3. [Control en línea](#3-control-en-línea)
4. [Control final](#4-control-final)
5. [Dictamen y registro](#5-dictamen-y-registro)
6. [Historial](#6-historial)
7. [Si administrás la empresa](#7-si-administrás-la-empresa)
8. [Sin señal](#8-sin-señal)
9. [Preguntas frecuentes](#9-preguntas-frecuentes)

---

## 1. Entrar por primera vez

QualityOS funciona **por invitación**: primero el administrador de tu empresa te invita con tu
email y tu rol. Después:

1. Abrí la app: <https://roca-byte.github.io/qualityos/>
2. Escribí **el mismo email de la invitación** y una clave (mínimo 6 caracteres) y tocá
   **Crear cuenta nueva**.
3. Te llega un mail para confirmar la cuenta. Tocá el link del mail.
4. Volvé a la app e **Ingresá** con tu email y tu clave.

<img src="img/01-acceso.png" alt="Pantalla de acceso" width="300">

La primera vez aparece la **bienvenida**: escribí tu nombre (sale en la firma de cada dictamen)
y mirá los pasos según tu rol. Tocá **Empezar**. La bienvenida se puede volver a ver desde
**⚙ → Ver la guía de bienvenida**.

<img src="img/02-bienvenida.png" alt="Bienvenida para Inspector de Calidad" width="300">

> 💡 **Instalala en el celular o la tablet:** en Chrome, menú ⋮ → *Agregar a la pantalla de
> inicio* (o *Instalar app*). Queda con su ícono y abre aunque no haya señal.

## 2. Crear un lote

En la pantalla principal ves los lotes **En control** y el **Historial**. Tocá **+ Nuevo lote**.

<img src="img/03-inicio.png" alt="Lotes en control" width="300"> <img src="img/04-nuevo-lote.png" alt="Formulario de nuevo lote" width="300">

- **Plantilla de control**: qué vas a controlar (si tu empresa tiene más de una, elegí la del
  producto o la línea).
- **Producto** y **N° de lote** son obligatorios.
- **Rangos de este lote**: las mediciones que dependen del producto (por ejemplo el peso por
  pico) piden acá su mínimo y máximo. Con eso la app marca lo que sale de rango.
- **Cantidad del control final**: cuántas unidades (pallets, cajas, muestras…) vas a revisar al
  final. Se pueden agregar o quitar después.

## 3. Control en línea

Unidad por unidad (pallet, caja, muestra…, según la plantilla), mientras la línea produce. Lo que
aparece depende de la plantilla; en el ejemplo de envasado de líquidos:

- **Hora**: el botón **Ahora** la completa.
- **Mediciones** (como el peso por pico, con 4 lecturas): la app calcula el promedio y avisa
  **fuera de rango** si alguna lectura sale de la tolerancia. Si la medición tiene **semáforo**,
  el círculo se pinta verde (dentro), amarillo (cerca) o rojo (lejos).
- **Datos y fechas** (lote del envase, código, producción, vencimiento): al agregar una unidad se
  copian de la anterior, así no tipeás lo mismo.
- **OK / NOK** (QR, packaging, paletizado…).

<img src="img/05-control-en-linea.png" alt="Pallet con un pico fuera de rango" width="300"> <img src="img/06-reproceso.png" alt="Pallet con packaging reprocesado" width="300">

Si encontraste un NOK y **lo corregiste en el momento**, tocá **↻ Reprocesado**: queda
registrado como desvío corregido (la unidad se pinta en naranja en vez de rojo). Lo mismo
para una medición fuera de rango que se corrigió, si la plantilla lo permite.

En otra plantilla los controles son otros. Por ejemplo, en una de alimentos:

<img src="img/17-lote-alimentos.png" alt="Muestra de un lote de alimentos" width="300">

> Tocar otra vez un OK o NOK ya marcado lo deja sin marcar.

## 4. Control final

Antes del despacho, revisá cada unidad con lo que pida la plantilla. **✓ Todo OK** marca
todos los OK/NOK de un toque. Si la plantilla lleva cantidad, cargá la **cantidad por unidad**
una vez (por ejemplo 1000 L por pallet); si una tiene otra, ponela en *Cantidad (si difiere)*.

<img src="img/07-control-final.png" alt="Control final" width="300">

## 5. Dictamen y registro

Abajo de todo está el **Dictamen**: la app suma unidades y cantidades aprobadas y retenidas y
**sugiere** un resultado. Vos decidís:

- **Aprobado**: todo el lote está conforme.
- **Aprobado parcial**: una parte se aprueba y otra queda retenida.
- **Retenido**: el lote no se libera.

<img src="img/08-dictamen.png" alt="Dictamen sugerido" width="300"> <img src="img/09-dictaminado.png" alt="Lote dictaminado" width="300">

Si quedan unidades sin completar lo obligatorio, solo **Coordinación** puede dictaminar igual (y queda
asentado quién lo autorizó). Una vez dictaminado, el lote queda cerrado para el Inspector de
Calidad; Coordinación puede reabrirlo.

En **Desvíos detectados** ves la lista de NOK del lote; **Copiar para el registro de NC** los
deja listos para pegar en el
[registro de No Conformidades](https://github.com/roca-byte/calidad-no-conformidades).

**Imprimir / PDF** arma el registro del lote en una hoja A4. En el diálogo de impresión elegí
*Guardar como PDF*.

<img src="img/10-registro-pdf.png" alt="Registro del lote para imprimir" width="100%">

## 6. Historial

En **Historial** están los lotes dictaminados que tiene el equipo. **Buscar en todo el
historial** busca por lote, producto o cliente en el servidor (hace falta señal).

<img src="img/11-historial.png" alt="Historial de lotes" width="300">

## 7. Si administrás la empresa

Tu bienvenida tiene otros pasos: configurar y armar el equipo.

<img src="img/12-bienvenida-admin.png" alt="Bienvenida para Administración" width="300">

En **⚙**:

- **Empresa**: nombre y líneas.
- **Plantillas de control**: qué se controla en cada lote (ver abajo).
- **Personas**: invitá por email con su rol, cambiá roles o desactivá a alguien que ya no
  trabaja. La persona invitada crea su cuenta con ese email (paso 1) y queda adentro.

<img src="img/13-configuracion.png" alt="Configuración de la empresa" width="300"> <img src="img/14-personas.png" alt="Personas e invitaciones" width="300">

### Plantillas de control

Cada plantilla dice **qué se controla** en un tipo de lote. Podés tener varias (por producto o
por línea); al crear el lote se elige cuál usar. **+ Nueva plantilla** arranca desde un ejemplo
de tu rubro (agroquímicos, alimentos, bebidas, cosmética) o en blanco.

<img src="img/15-plantillas.png" alt="Lista de plantillas" width="300"> <img src="img/16-editor-plantilla.png" alt="Editor de plantillas" width="300">

En el editor:

- **Qué se controla**: el nombre de la unidad (Pallet, Caja, Muestra…) en singular y plural, y
  si lleva **cantidad** (L, kg, unid.) para sumar lo aprobado y lo retenido.
- **Ítems del control en línea y del control final**, cada uno de un tipo:
  - **OK / NOK**, y si permite marcarlo como *reprocesado*.
  - **Medición**: unidad, cuántas lecturas por unidad y la **tolerancia**: fija (mínimo y máximo
    en la plantilla), *se carga en cada lote* (para lo que depende del producto, como el peso) o
    sin tolerancia (solo se registra). Opcional: semáforo.
  - **Texto** o **fecha**.
- En el control final, si cada ítem es **obligatorio para dictaminar**.
- ↑ ↓ cambian el orden y ✕ quita el ítem.

Los lotes ya creados **no cambian** si editás o borrás una plantilla: cada lote guarda una copia
de la plantilla con la que se hizo.

#### Codificación del registro

Cada plantilla es un **registro del sistema de gestión** y lleva su codificación, como pide la
norma (ISO 9001, 7.5): **código** (por ejemplo REG-01, obligatorio y sin repetir), **versión**,
**vigente desde**, quién **elaboró** y quién **aprobó**. Sale en el encabezado y el pie del PDF.

- Si cambiás **qué se controla** (agregás, sacás o modificás un ítem) y no subiste la versión, la
  app te ofrece guardar como versión nueva (03 → 04) con la fecha de hoy. Si fue solo una
  corrección menor, como un texto mal escrito, podés guardar sin cambiar la versión.
- En **Qué cambió en esta versión** anotá el motivo: queda en el **Historial de versiones** con
  la fecha y quién lo hizo.
- Cada lote conserva la codificación con la que se hizo: el PDF de un lote viejo sale con su
  versión aunque la plantilla ya vaya por otra.
- **Duplicar** una plantilla crea otro registro: arranca sin código, en versión 00.

| Rol | Puede |
|---|---|
| **Inspector de Calidad** | Crear y controlar lotes. Dictaminar con el control final completo |
| **Coordinación** | Además: dictaminar con unidades pendientes, reabrir o corregir lotes dictaminados, borrar lotes |
| **Administración** | Además: configurar la empresa y las plantillas e invitar personas |

## 8. Sin señal

QualityOS está hecha para la planta: **todo se guarda primero en el equipo** y se sube solo
cuando hay conexión. Arriba a la derecha ves el estado:

| Indicador | Qué significa |
|---|---|
| ☁ **Al día** | Todo lo cargado ya está en el servidor |
| ⏳ **N por subir** | Hay cambios guardados en el equipo esperando subir |
| ✈ **Sin señal** | Seguí trabajando normal: se sube cuando vuelva la conexión |
| ⚠ **Conflicto** | Otro equipo cambió el mismo lote. Tocalo y elegí qué versión queda: nada se pierde |

## 9. Preguntas frecuentes

**Creé la cuenta pero dice que no pertenezco a ninguna empresa.**
Pedile al administrador que te invite con **el mismo email** con el que creaste la cuenta.
Después tocá **Buscar invitaciones**.

**No me llegó el mail de confirmación.**
Revisá spam o correo no deseado. Si no aparece, pedí ayuda al administrador.

**Me equivoqué en un dato del lote.**
Mientras está en control, **Editar datos** corrige la cabecera y cualquier campo se cambia
tocándolo. Si ya está dictaminado, pedile a Coordinación que lo reabra.

**¿Puedo usarla en más de un equipo?**
Sí. Con la misma cuenta, en el celular y en la tablet: lo que cargás en uno aparece en el otro
cuando ambos tienen señal.

**Cerré sesión con cambios sin subir.**
Quedan guardados en ese equipo y se suben la próxima vez que entre alguien de tu empresa en él.
