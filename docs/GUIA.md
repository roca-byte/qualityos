# Guía de uso · QualityOS

Paso a paso para quien usa QualityOS por primera vez. Las capturas son de una empresa de
ejemplo ("Planta Demo") con datos inventados.

<p align="center"><img src="img/demo.gif" alt="Recorrido: crear un lote, controlarlo y dictaminarlo" width="300"></p>

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

- **Producto** y **N° de lote** son obligatorios.
- **Inductora**: de ella salen las tolerancias del semáforo de inducción.
- **Peso mín./máx. por pico**: con esto la app marca cada pico fuera de rango.
- **Pallets del control final**: cuántos pallets vas a revisar al final (se pueden agregar o
  quitar después).

## 3. Control en línea

Pallet por pallet, mientras la línea produce:

- **Hora**: el botón **Ahora** la completa.
- **Peso por pico** (P1 a P4): la app calcula el promedio y avisa **⚖ fuera de rango** si
  algún pico se pasa del rango del lote.
- **Identificación**: lote, código, fecha de producción y de vencimiento. Al agregar un pallet
  se copian del anterior, así no tipeás lo mismo.
- **Inducción**: OK/NOK y el valor medido. El círculo es el **semáforo** (verde dentro de
  tolerancia, amarillo cerca, rojo lejos).
- **QR, packaging y paletizado**: OK/NOK.

<img src="img/05-control-en-linea.png" alt="Pallet con un pico fuera de rango" width="300"> <img src="img/06-reproceso.png" alt="Pallet con packaging reprocesado" width="300">

Si encontraste un NOK y **lo corregiste en el momento**, tocá **↻ Reprocesado**: queda
registrado como desvío corregido (el pallet se pinta en naranja en vez de rojo).

> Tocar otra vez un OK o NOK ya marcado lo deja sin marcar.

## 4. Control final

Antes del despacho, revisá cada pallet: ID, trazabilidad/QR, estado del pallet e inducción.
**✓ Todo OK** completa los cuatro de un toque. Cargá los **litros por pallet** una vez; si un
pallet tiene otra cantidad, ponela en *Litros (si difiere)*.

<img src="img/07-control-final.png" alt="Control final" width="300">

## 5. Dictamen y registro

Abajo de todo está el **Dictamen**: la app suma pallets y litros aprobados y retenidos y
**sugiere** un resultado. Vos decidís:

- **Aprobado**: todo el lote está conforme.
- **Aprobado parcial**: una parte se aprueba y otra queda retenida.
- **Retenido**: el lote no se libera.

<img src="img/08-dictamen.png" alt="Dictamen sugerido" width="300"> <img src="img/09-dictaminado.png" alt="Lote dictaminado" width="300">

Si quedan pallets sin controlar, solo **Coordinación** puede dictaminar igual (y queda
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

- **Empresa**: nombre, código y versión del registro, quién elaboró y aprobó (salen en el PDF),
  líneas e **inductoras** con su tolerancia mínima y máxima.
- **Personas**: invitá por email con su rol, cambiá roles o desactivá a alguien que ya no
  trabaja. La persona invitada crea su cuenta con ese email (paso 1) y queda adentro.

<img src="img/13-configuracion.png" alt="Configuración de la empresa" width="300"> <img src="img/14-personas.png" alt="Personas e invitaciones" width="300">

| Rol | Puede |
|---|---|
| **Inspector de Calidad** | Crear y controlar lotes. Dictaminar con el control final completo |
| **Coordinación** | Además: dictaminar con pallets pendientes, reabrir o corregir lotes dictaminados, borrar lotes |
| **Administración** | Además: configurar la empresa e invitar personas |

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
