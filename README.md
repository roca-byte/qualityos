# QualityOS

PWA para el **checker de calidad** de una planta de envasado. Crea un lote, lo controla
pallet por pallet (peso por pico, identificación y trazabilidad, inducción, QR, packaging,
paletizado), hace el control final y lo **dictamina** (Aprobado, Aprobado parcial o Retenido).
Saca el registro del lote listo para imprimir o guardar en PDF.

Es la reconstrucción de la QualityOS original, que usaba Firebase. Esta versión usa
**Supabase** (Postgres) y está pensada para que la usen **varias empresas** con la misma
instalación, cada una viendo solo sus datos.

## Qué hace

- **Lotes**: producto, n° de lote, cliente, línea, fecha, inductora y rango de peso por pico.
- **Control en línea**: por pallet, 4 pesos por pico (marca los que salen del rango), lote,
  código, fechas de producción y vencimiento, inducción OK/NOK con valor y **semáforo** según
  la tolerancia de la inductora, QR, packaging y paletizado. Cada NOK puede marcarse como
  **reprocesado** en el momento.
- **Control final**: por pallet, ID, trazabilidad/QR, estado del pallet e inducción, con
  botón "Todo OK". Calcula pallets y litros aprobados y retenidos.
- **Dictamen**: la app sugiere uno según el control final. Queda registrado quién dictaminó,
  con qué rol y cuándo. Si faltan pallets por controlar, solo **coordinación** puede
  dictaminar igual (y queda asentado).
- **Funciona sin señal**: todo se guarda primero en la tablet y se sube solo cuando vuelve
  la conexión. Si dos equipos cambian el mismo lote, no se pisa nada: la app avisa y deja
  elegir qué versión queda.
- **Historial** con búsqueda por lote, producto o cliente.
- **Desvíos** del lote listos para copiar al registro de No Conformidades.
- **Configuración por empresa**: inductoras y tolerancias, líneas, código y versión del
  registro, quién elaboró y aprobó. **Personas**: invitar por email y asignar rol
  (Checker, Coordinación, Administración).

## Tecnologías

HTML, CSS y JavaScript puro, sin build ni npm. Única librería:
[supabase-js](https://github.com/supabase/supabase-js) (`vendor/supabase.js`, licencia MIT),
incluida en el repo para que la app abra sin internet.

```
index.html                      Estructura: barra superior + <main id="vista">
css/styles.css                  Estilos (mobile first, botones de 48 px) + impresión A4
js/config.js                    URL y clave pública de Supabase  ← completar
js/reglas.js                    Reglas de negocio puras (semáforo, peso, litros, dictamen)
js/store.js                     Datos en la tablet + bandeja de salida
js/nube.js                      Todo lo que habla con Supabase
js/imprimir.js                  Registro del lote para imprimir / PDF
js/app.js                       Pantallas y eventos
sw.js                           Service worker (red primero, copia sin señal)
supabase/migrations/            Esquema de la base, seguridad (RLS) y funciones
tests/                          Pruebas (reglas, base de datos e interfaz)
docs/                           Guía de Supabase y decisiones de diseño
```

## Ponerla en marcha

1. Crear el proyecto en Supabase y cargar el esquema: ver [`docs/SUPABASE.md`](docs/SUPABASE.md).
2. Completar `js/config.js` con la URL y la clave **publishable** del proyecto.
3. Publicar la carpeta en cualquier hosting estático (GitHub Pages, Cloudflare Pages…).
   Todas las rutas son relativas, así que funciona también en un subdirectorio.
4. Entrar, crear la cuenta, crear la empresa e invitar al resto desde ⚙.

Para probarla en la compu (con `file://` el service worker no anda):

```bash
python3 -m http.server 8000     # y abrir http://localhost:8000
```

## Pruebas

```bash
node --test 'tests/*.test.js'   # reglas de negocio (sin instalar nada)
tests/sql/correr.sh             # esquema y seguridad contra un Postgres local
node tests/e2e/flujo.js         # interfaz de punta a punta (Playwright, Supabase simulado)
```

## Licencia

© 2026 Maximiliano Roca. Publicada con la licencia
[PolyForm Noncommercial 1.0.0](LICENSE).

En criollo: el código está a la vista y lo podés leer, estudiar, probar y modificar para
**uso no comercial** (personal, educativo, de investigación o en organizaciones sin fines de
lucro). **No se puede usar con fines comerciales**, por ejemplo usarla en una empresa u
ofrecerla como servicio, sin un permiso del autor. Para uso comercial, escribime.
El texto que vale es el de [`LICENSE`](LICENSE); este resumen es solo orientativo.

Las versiones publicadas hasta el commit `4d632f5` inclusive siguen bajo licencia MIT para
quien las haya obtenido en ese momento.

`vendor/supabase.js` es de [supabase-js](https://github.com/supabase/supabase-js) y mantiene
su propia licencia MIT (`vendor/supabase-LICENSE`).
