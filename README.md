<div align="center">

<img src="icons/icon.svg" alt="" width="88">

# QualityOS · Control de lotes

**Del lote al dictamen, unidad por unidad, desde la tablet y aunque no haya señal.**

[Abrir la app](https://roca-byte.github.io/qualityos/) · [Video (2:20)](docs/video/qualityos-demo.mp4) · [Guía de uso](docs/GUIA.md) · [Cómo se usa](#cómo-se-usa) · [Licencia](#licencia)

<img src="docs/img/demo.gif" alt="Recorrido: crear un lote, controlarlo y dictaminarlo" width="280">

</div>

---

QualityOS es una app para el **control de calidad de lotes en planta**:
alimentos, bebidas, químicos y agroquímicos, cosmética, envases o lo que se fabrique. **Qué se
controla lo define cada empresa** con plantillas de control (mediciones con tolerancia, OK/NOK,
datos y fechas), con ejemplos por rubro para empezar. El inspector crea el lote, lo controla en la línea y en producto final, y lo
**dictamina**: Aprobado, Aprobado parcial o Retenido. Al final sale el registro del lote listo
para imprimir o guardar en PDF.

Se usa desde la tablet, el celular o la compu, se instala como una app y **funciona sin señal**:
sube todo cuando vuelve la conexión. Varias empresas pueden usarla a la vez, y cada una ve
solo sus datos.

> **Probala sin cuenta:** abrí la app y tocá **“Probar sin cuenta (demo)”**. Entrás a una empresa de
> ejemplo con lotes cargados; lo que hagas queda solo en tu navegador y no toca ninguna base real.

## Qué resuelve

| En papel o Excel | Con QualityOS |
|---|---|
| Planillas que se completan a mano y se pasan en limpio | Se carga una vez, en la línea, desde la tablet |
| El peso fuera de rango o la inducción floja se ven tarde | Cada pico fuera de rango y la inducción fuera de tolerancia se marcan al instante (semáforo) |
| Cuentas de unidades y cantidades aprobadas/retenidas a mano | La app las calcula y **sugiere el dictamen** |
| No queda claro quién dictaminó ni cuándo | Queda registrado: persona, rol, fecha y hora |
| Sin señal en planta, no se puede cargar | Funciona sin conexión y sube todo cuando vuelve la señal |
| Cada planta tiene su copia de la planilla | Varias empresas en una sola instalación, con datos separados |

## Cómo se usa

0. **Plantillas de control** (una vez, en ⚙). La empresa define qué se controla: por ejemplo
   *Envasado de líquidos* (peso por pico, inducción, QR, paletizado…) o *Envasado de alimentos*
   (peso neto, temperatura, detector de metales, alérgenos…). Hay ejemplos para agroquímicos,
   alimentos, bebidas y cosmética, y se pueden armar desde cero. Cada ítem es:
   - **Medición**: número con unidad, una o varias lecturas y tolerancia (fija, o que se carga
     en cada lote), con semáforo si se quiere.
   - **OK / NOK**, con opción de marcarlo como **reprocesado** si se corrigió en el momento.
   - **Texto** (lote del envase, código…) o **fecha** (producción, vencimiento…).

   Cada plantilla es un registro con su **codificación** (código, versión, vigencia, elaboró y
   aprobó) y su **historial de versiones**: si cambia qué se controla, la app ofrece la versión
   nueva, y cada lote conserva la versión con la que se hizo.
1. **Nuevo lote.** Producto, n° de lote, cliente, línea, fecha, la plantilla y los rangos que
   esa plantilla pide para este lote.
2. **Control en línea**, unidad por unidad (pallet, caja, muestra…): lo que pide la plantilla.
   Lo que sale de tolerancia se marca solo; los datos escritos se copian de la unidad anterior.
3. **Control final**, unidad por unidad, con un botón **"Todo OK"** para las que no tienen
   novedad. La app suma unidades y cantidades (litros, kg…) aprobadas y retenidas.
4. **Dictamen.** La app sugiere uno según el control final; la persona decide. Si faltan
   unidades por controlar, solo **Coordinación** puede dictaminar igual, y queda asentado.
5. **Registro.** "Imprimir / PDF" arma el registro del lote en A4, con el código, la versión y
   la vigencia de su plantilla. Los desvíos del lote se pueden copiar para pegarlos en el
   [registro de No Conformidades](https://github.com/roca-byte/calidad-no-conformidades).

Todo se ve en el **historial**, con búsqueda por lote, producto o cliente.

La primera vez, la app muestra una **bienvenida** con los pasos según el rol. La
[guía de uso](docs/GUIA.md) tiene el recorrido completo con capturas.

<p>
<img src="docs/img/05-control-en-linea.png" alt="Control en línea" width="220">
<img src="docs/img/08-dictamen.png" alt="Dictamen sugerido" width="220">
<img src="docs/img/11-historial.png" alt="Historial" width="220">
</p>
<p>
<img src="docs/img/15-plantillas.png" alt="Plantillas de control" width="220">
<img src="docs/img/16-editor-plantilla.png" alt="Editor de plantillas" width="220">
<img src="docs/img/17-lote-alimentos.png" alt="Lote de alimentos" width="220">
</p>

### Roles

| Rol | Qué puede hacer |
|---|---|
| **Inspector de Calidad** | Crear y controlar lotes. Dictaminar cuando el control final está completo |
| **Coordinación** | Lo anterior, más dictaminar con unidades pendientes, corregir o reabrir lotes dictaminados, borrar lotes y ver la auditoría |
| **Administración** | Todo lo anterior, más configurar la empresa (plantillas de control, líneas, datos del registro) e invitar personas |

Estos permisos los hace cumplir **la base de datos**, no solo la pantalla: esconder un botón
no alcanza para saltearlos.

### Acceso

QualityOS funciona **por invitación**. Cualquiera puede abrir el link y crear una cuenta, pero
para entrar a una empresa la tiene que invitar su administrador (con el mismo email). Las
empresas nuevas las da de alta el administrador de la plataforma.

## Tus datos y la seguridad

- **Sin señal, sin problema.** Todo se carga en el equipo y se sube solo cuando vuelve la
  conexión.
- **Nada se pisa.** Si dos personas cambian el mismo lote a la vez, la app avisa y deja
  elegir cuál versión queda.
- **Cada empresa ve solo lo suyo**, y los permisos de cada rol los controla el servidor, no
  solo la pantalla: esconder un botón no alcanza para saltearlos.
- **Todo queda registrado.** Cada versión de cada lote se guarda con quién la hizo y cuándo.
- **Borrar no es perder.** Un lote borrado queda marcado y no vuelve a aparecer por error.

## Licencia

© 2026 Maximiliano Roca. [PolyForm Noncommercial 1.0.0](LICENSE).

El código está a la vista: lo podés leer, estudiar, probar y modificar para **uso no
comercial** (personal, educativo, de investigación o en organizaciones sin fines de lucro).
**Usarla en una empresa u ofrecerla como servicio requiere permiso del autor**: si te interesa,
[escribime](mailto:maxyroca7@gmail.com). Este resumen es orientativo; vale el texto de
[`LICENSE`](LICENSE).

Las versiones publicadas hasta el commit `4d632f5` inclusive siguen bajo licencia MIT para
quien las haya obtenido en ese momento.

---

<div align="center">

Parte de la suite **QualityOS** · [Más proyectos](https://github.com/roca-byte) · Información técnica: [DESARROLLO.md](DESARROLLO.md)

</div>
